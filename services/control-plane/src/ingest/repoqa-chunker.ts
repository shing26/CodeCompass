/**
 * Ticket 04 + 05 (v1.1) — declaration-level chunk extraction, split out of
 * RepoQAWorker so the rules are pure functions of (path, content): both the
 * full-index pass and the per-file hot-reload pass call the same code, so
 * their chunks are byte-identical by construction.
 *
 * Scope is deliberately narrow (spec §1.3): comments/docstrings only, never
 * function bodies — bodies would explode chunk count and noise together, and
 * ADR-0002's compensation tools are "exact retrieval, aliases, config keys",
 * i.e. intent lives in declarations. Go is explicitly NOT covered (the eval
 * fixtures contain zero `.go` files, so coverage there would be untestable —
 * see ticket 07 for the boundary wording and its trigger line).
 */
import { lineNumberAt } from './worker-helpers';

export const MAX_CHUNK_CHARS = 4000;

export interface CommentBlock {
  content: string;
  lineStart: number;
}

export interface MarkdownSection {
  content: string;
  lineStart: number;
}

/**
 * Comment/docstring blocks for one source file, in source order. Java keeps
 * its pre-v1.1 behavior byte-for-byte (Javadoc-style `/** … *​/` blocks only).
 * TS/TSX/JS add the same JSDoc blocks plus a file-header comment (a plain
 * `/* … *​/` at the first non-blank char, or a leading `//` run after an
 * optional shebang). Python adds module/def/class docstrings: a triple-quoted
 * string qualifies when nothing but whitespace precedes it (module) or the
 * last non-blank line before it ends with `:` (def/class header) — a
 * deterministic heuristic, not a Python parser.
 */
export function extractCommentBlocks(filePath: string, content: string): CommentBlock[] {
  const lower = filePath.toLowerCase();
  if (lower.endsWith('.java')) {
    return collect(content, [/\/\*\*[\s\S]*?\*\//g]);
  }
  if (/\.(ts|tsx|js)$/.test(lower)) {
    return tsLikeCommentBlocks(content);
  }
  if (lower.endsWith('.py')) {
    return pythonDocstringBlocks(content);
  }
  return [];
}

function collect(content: string, patterns: RegExp[]): CommentBlock[] {
  const found: Array<CommentBlock & { index: number }> = [];
  for (const pattern of patterns) {
    for (const m of content.matchAll(pattern)) {
      const at = m.index ?? 0;
      found.push({ content: m[0], lineStart: lineNumberAt(content, at), index: at });
    }
  }
  return found.sort((a, b) => a.index - b.index).map(({ index: _index, ...block }) => block);
}

function tsLikeCommentBlocks(content: string): CommentBlock[] {
  const found: Array<CommentBlock & { index: number }> = collect(content, [
    /\/\*\*[\s\S]*?\*\//g
  ]).map((block) => ({ ...block, index: content.indexOf(block.content) }));

  // File header as a plain block comment: `/* … */` but not `/**` (the latter
  // is already collected above) sitting at the first non-blank character.
  const head = content.search(/\S/);
  if (
    head >= 0 &&
    content[head] === '/' &&
    content[head + 1] === '*' &&
    content[head + 2] !== '*' &&
    content[head + 2] !== undefined
  ) {
    const end = content.indexOf('*/', head);
    if (end > 0) {
      found.push({ content: content.slice(head, end + 2), lineStart: lineNumberAt(content, head), index: head });
    }
  }

  // File header as a leading `//` run (optionally after a shebang line).
  const lines = content.split('\n');
  let start = 0;
  if (lines[0]?.startsWith('#!')) start = 1;
  const docLines: string[] = [];
  for (let i = start; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (trimmed.startsWith('//')) docLines.push(lines[i]);
    else break;
  }
  if (docLines.length > 0) {
    found.push({ content: docLines.join('\n'), lineStart: start + 1, index: 0 });
  }

  return found.sort((a, b) => a.index - b.index).map(({ index: _index, ...block }) => block);
}

function pythonDocstringBlocks(content: string): CommentBlock[] {
  const blocks: CommentBlock[] = [];
  const re = /"""[\s\S]*?"""|'''[\s\S]*?'''/g;
  for (const m of content.matchAll(re)) {
    const normalizedBefore = content.slice(0, m.index).replace(/\r/g, '');
    const trimmedBefore = normalizedBefore.trim();
    if (trimmedBefore === '') {
      blocks.push({ content: m[0], lineStart: lineNumberAt(content, m.index ?? 0) });
      continue;
    }
    const prevLine = trimmedBefore.slice(trimmedBefore.lastIndexOf('\n') + 1).trim();
    if (prevLine.endsWith(':')) {
      blocks.push({ content: m[0], lineStart: lineNumberAt(content, m.index ?? 0) });
    }
  }
  return blocks;
}

/**
 * Ticket 05 (v1.1) — markdown is no longer `slice(0, 4000)` (everything past
 * 4000 chars was unreachable by retrieval). Split at ATX headings; every
 * section carries a `h1 > h2` breadcrumb prefix so the section's place in the
 * document is searchable alongside its body. Fenced code blocks are not
 * heading territory (`# comment` inside ``` fences must not split). Sections
 * still longer than MAX_CHUNK_CHARS are split at line boundaries — same
 * breadcrumb, monotonically advancing lineStart.
 */
export function splitMarkdownSections(content: string): MarkdownSection[] {
  const pieces: MarkdownSection[] = [];
  const lines = content.split('\n');
  let lastH1 = '';
  let lastH2 = '';
  let current: { breadcrumb: string; startLine: number; lines: string[] } | null = null;
  let fenced = false;

  const emit = (sec: { breadcrumb: string; startLine: number; lines: string[] }): void => {
    if (!sec.lines.some((line) => line.trim())) return;
    let buf: string[] = [];
    let size = 0;
    let bufStart = sec.startLine;
    const flush = (): void => {
      if (buf.length === 0) return;
      const text = buf.join('\n');
      pieces.push({
        content: sec.breadcrumb ? `[${sec.breadcrumb}]\n${text}` : text,
        lineStart: bufStart
      });
      buf = [];
      size = 0;
    };
    for (let i = 0; i < sec.lines.length; i++) {
      const line = sec.lines[i];
      if (buf.length > 0 && size + line.length + 1 > MAX_CHUNK_CHARS) {
        flush();
        bufStart = sec.startLine + i;
      }
      buf.push(line);
      size += line.length + 1;
    }
    flush();
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*```/.test(line)) fenced = !fenced;
    const heading = fenced ? null : /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      if (current) emit(current);
      const text = heading[2].trim();
      if (heading[1].length === 1) {
        lastH1 = text;
        lastH2 = '';
      } else if (heading[1].length === 2) {
        lastH2 = text;
      }
      const breadcrumb = lastH2 ? `${lastH1} > ${lastH2}` : lastH1;
      current = { breadcrumb, startLine: i + 1, lines: [line] };
    } else {
      if (!current) {
        current = { breadcrumb: lastH2 ? `${lastH1} > ${lastH2}` : lastH1, startLine: i + 1, lines: [] };
      }
      current.lines.push(line);
    }
  }
  if (current) emit(current);
  return pieces;
}
