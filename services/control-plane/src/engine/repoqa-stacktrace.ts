/**
 * Issue 23 — Deterministic stack-trace parsing (zero LLM).
 *
 * Parses pasted Java / TS-JS stack traces into physical frames and resolves
 * them against the indexed symbol table. This is the physical entry point of
 * the Incident Copilot: everything downstream (diagnose chain, blast radius)
 * is anchored to symbols that actually exist in the Repo Index, so the
 * Zero-Hallucination Contract holds from the first step.
 *
 * v1 scope: Java (`at com.foo.Bar.baz(Bar.java:123)`, incl. `Caused by:` and
 * `Native Method` frames) and TS/JS (`at fn (src/foo.ts:12:34)`). Anything
 * else stays unmatched — callers must surface that as BREAK, never guess.
 */

export interface ParsedStackFrame {
  /** Enclosing class simple name (`OrderService`) or '' for bare TS functions. */
  className: string;
  /** Method / function name. */
  method: string;
  /** File as written in the trace (`OrderService.java`, `src/foo.ts`). */
  file?: string;
  line?: number;
  /** The original line, verbatim, for display and audit. */
  raw: string;
}

export interface FrameResolution<T> {
  frame: ParsedStackFrame;
  /** Matched symbol, or undefined when the frame has no physical counterpart. */
  symbol?: T;
}

export interface StackResolution<T> {
  matches: Array<FrameResolution<T> & { symbol: T }>;
  unmatched: ParsedStackFrame[];
}

/** `at com.acme.shop.OrderService.cancel(OrderService.java:42)` */
const JAVA_FRAME =
  /^\s*at\s+([\w$]+(?:\.[\w$]+)+)\.([\w$<>]+)\(\s*(?:(?:[\w./$-]*\/)?([\w$.-]+\.java)(?::(\d+))?|Native Method|Unknown Source)\s*\)/;

/**
 * TS/JS V8 style: `at fn (src/a.ts:12:34)`, `at Object.fn (C:\x\a.ts:1:2)`,
 * `at /abs/path/a.ts:12:34`, `at fn (webpack-internal:///./a.ts:12:34)`.
 */
const TS_FRAME =
  /^\s*at\s+(?:(.+?)\s+\()?\s*((?:[A-Za-z]:)?[\w./\\$-]+\.(?:tsx?|jsx?|mjs|cjs)|[\w-]+:\/\/\/[\w./$-]+\.(?:tsx?|jsx?|mjs|cjs)):(\d+):\d+\s*\)?/;

/**
 * Generic fallback for traces pasted without the `at` prefix, e.g.
 * `com.acme.OrderService.cancel(OrderService.java:42)` buried in a log line.
 * Conservative: requires a dotted receiver, a call-style paren and an
 * extension-carrying file with a line number.
 */
const GENERIC_FRAME =
  /([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)+)\.([A-Za-z_$][\w$]*)\(\s*([A-Za-z]:?[\w./\\$-]+\.[A-Za-z]{1,5})\s*:\s*(\d+)\s*\)/;

/** Lines that never start a frame, however much they look like one. */
const NOISE =
  /^\s*(?:Caused by:|\.\.\.\s*\d+\s*(?:more|common frames omitted)|Suppressed:|Exception in thread|at\s+(?:java\.base\/|jdk\.internal|sun\.reflect|java\.lang\.reflect))/i;

/**
 * Bare TS location pasted without `at` or a function, e.g. `orderService.ts:42:15`.
 */
const BARE_TS_LOCATION =
  /((?:[A-Za-z]:)?[\w./\\$-]+\.(?:tsx?|jsx?|mjs|cjs)):(\d+):\d+/;

/** Parse a pasted stack trace / log excerpt into ordered frames. */
export function parseStackTrace(text: string): ParsedStackFrame[] {
  const frames: ParsedStackFrame[] = [];
  for (const rawLine of (text ?? '').split(/\r?\n/)) {
    if (!rawLine.trim() || NOISE.test(rawLine)) continue;
    const frame = parseFrameLine(rawLine);
    if (frame) frames.push(frame);
  }
  return frames;
}

function parseFrameLine(raw: string): ParsedStackFrame | undefined {
  const java = JAVA_FRAME.exec(raw);
  if (java) {
    return {
      className: lastSegment(java[1]),
      method: java[2],
      file: java[3],
      line: java[4] !== undefined ? Number(java[4]) : undefined,
      raw: raw.trim()
    };
  }
  const ts = TS_FRAME.exec(raw);
  if (ts) {
    const fn = (ts[1] ?? '').trim();
    const dot = fn.lastIndexOf('.');
    return {
      // `Object.fn` → className `Object`; bare `fn` → className ''
      className: dot > 0 ? fn.slice(0, dot).split('.').pop() ?? '' : '',
      method: dot >= 0 ? fn.slice(dot + 1) : fn,
      file: ts[2],
      line: Number(ts[3]),
      raw: raw.trim()
    };
  }
  const generic = GENERIC_FRAME.exec(raw);
  if (generic) {
    return {
      className: lastSegment(generic[1]),
      method: generic[2],
      file: generic[3],
      line: Number(generic[4]),
      raw: raw.trim()
    };
  }
  const bare = BARE_TS_LOCATION.exec(raw);
  if (bare) {
    return {
      className: '',
      method: '',
      file: bare[1],
      line: Number(bare[2]),
      raw: raw.trim()
    };
  }
  return undefined;
}

function lastSegment(dotted: string): string {
  const parts = dotted.split('.');
  return parts[parts.length - 1];
}

/**
 * Resolve parsed frames against the symbol table. Frames arrive deepest-first
 * (the crash site is `frames[0]` for Java). A frame matches when the method
 * name equals the symbol name and — when the frame carries a class — the
 * symbol's parent type (or its own name for class-level symbols) equals it.
 * Same-file matches always outrank cross-file ones; ties keep symbol order.
 */
export function resolveFramesToSymbols<T>(
  frames: ParsedStackFrame[],
  symbols: T[],
  access: {
    name: (symbol: T) => string;
    parentType?: (symbol: T) => string | undefined;
    filePath: (symbol: T) => string;
  }
): StackResolution<T> {
  const matches: Array<FrameResolution<T> & { symbol: T }> = [];
  const unmatched: ParsedStackFrame[] = [];
  for (const frame of frames) {
    let best: T | undefined;
    let bestScore = -1;
    for (const symbol of symbols) {
      if (access.name(symbol) !== frame.method) continue;
      const parent = access.parentType?.(symbol);
      if (frame.className && parent && parent !== frame.className) continue;
      let score = 0;
      if (frame.className) score += parent === frame.className ? 2 : 0;
      if (frame.file && sameFile(access.filePath(symbol), frame.file)) score += 4;
      if (score > bestScore) {
        bestScore = score;
        best = symbol;
      }
    }
    if (best !== undefined && bestScore >= 0) {
      matches.push({ frame, symbol: best });
    } else {
      unmatched.push(frame);
    }
  }
  return { matches, unmatched };
}

function sameFile(symbolPath: string, frameFile: string): boolean {
  const a = symbolPath.replace(/\\/g, '/').split('/').pop() ?? '';
  const b = frameFile.replace(/\\/g, '/').split('/').pop() ?? '';
  return a.length > 0 && a === b;
}

/** Human/prompt summary used in context blocks and events. */
export function stackTraceSummary<T>(resolution: StackResolution<T>): string {
  const total = resolution.matches.length + resolution.unmatched.length;
  const crash =
    resolution.matches[0]?.frame ?? resolution.unmatched[0] ?? undefined;
  const parts = [
    `${total} frame(s) parsed, ${resolution.matches.length} resolved to indexed symbols.`
  ];
  if (crash) {
    parts.push(
      `Crash frame: ${crash.className ? `${crash.className}.` : ''}${crash.method}` +
        `${crash.file ? ` (${crash.file}:${crash.line ?? '?'})` : ''}`
    );
  }
  if (resolution.unmatched.length > 0) {
    parts.push(
      `${resolution.unmatched.length} frame(s) have no physical counterpart in the index (STATIC ANALYSIS BREAK — do not guess).`
    );
  }
  return parts.join(' ');
}
