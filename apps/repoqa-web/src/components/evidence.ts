import type { Anchor, EvidenceItem, EvidenceStatus } from '../types';

/**
 * Issue 23 — Zero-Hallucination Contract evidence plane (frontend half).
 *
 * The incident backend composes its answer from deterministic tool returns;
 * every physically-grounded assertion carries an explicit status marker:
 *
 *   - `com.demo.DemoService.greet -> greet @ src/DemoService.java:4 [VERIFIED]`
 *   - `at com.acme.thirdparty.Missing.run(Missing.java:99) -> BREAK (reason)`
 *   - `- [VERIFIED] SERVICE greet @ src/DemoService.java:4`
 *   - `- [SUSPECT] SERVICE collect @ src/MetricsCollector.java:8` (dead-end)
 *   - `- server.port @ src/main/resources/application.yml:3` (config key)
 *
 * parseEvidenceFromAnswer restructures those lines into EvidenceItem rows for
 * the EvidenceCard component. It is a deterministic text parse — it never
 * invents an assertion: lines without a grounded file:line are ignored, so
 * the narrative summary stays unstructured (and unbadged) by design.
 */

/** Diagnose chain line: `- [STATUS] LAYER symbol @ file:line`. */
const CHAIN_LINE_RE = /^-\s*\[(VERIFIED|BROKEN|SUSPECT)\]\s+(\S+)\s+(.+?)\s+@\s+(.+):(\d+)\s*$/;

/** Matched frame line: `- frame -> symbol @ file:line [STATUS]`. */
const FRAME_LINE_RE = /^-\s*(.+?)\s*->\s*(.+?)\s+@\s+(.+):(\d+)\s*\[(VERIFIED|BREAK|SUSPECT)\]\s*$/;

/** Unresolved frame line: `- raw frame -> BREAK (reason)`. */
const BREAK_LINE_RE = /^-\s*(.+?)\s*->\s*BREAK\b\s*(?:\((.*)\))?\s*$/;

/** Config-evidence line: `- key @ file:line` (no badge, still grounded). */
const PLAIN_LOCATION_RE = /^-\s*([^\s@]+)\s+@\s+(.+):(\d+)\s*$/;

/** A `file.ext:line` (or `path/file.ext:line`) claimed inside a raw frame. */
const CLAIMED_LOCATION_RE = /([A-Za-z0-9_$./\\-]+\.[A-Za-z]+):(\d+)/;

/** Normalize the backend status vocabulary to the badge vocabulary. */
function normalizeStatus(raw: string): EvidenceStatus {
  // The diagnose engine spells an unbindable hop `BROKEN`; the stack parser
  // spells an unresolvable frame `BREAK` — same zero-hallucination semantics.
  if (raw === 'BROKEN') return 'BREAK';
  return raw as EvidenceStatus;
}

function shortFile(file: string): string {
  return file.split(/[\\/]/).pop() ?? file;
}

function locationLabel(file: string, line: number): string {
  const base = shortFile(file);
  return line > 0 ? `${base}:${line}` : base;
}

function draft(
  status: EvidenceStatus,
  label: string,
  file: string,
  line: number
): EvidenceItem {
  return { status, label, file, line, location: locationLabel(file, line) };
}

/**
 * Parse the incident answer into evidence rows, then merge the validated
 * anchors in: a row matching an anchor (same file:line + symbol) inherits the
 * anchor's commit chip (ADR-0010 quad); anchors the text did not surface
 * (LLM-path extras) are appended as VERIFIED rows so every validated anchor
 * stays visible. Merge precedence keeps the anchor's commit for duplicates.
 */
export function parseEvidenceFromAnswer(answer: string, anchors: Anchor[]): EvidenceItem[] {
  const items: EvidenceItem[] = [];

  for (const line of (answer ?? '').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('- ')) continue;

    const chain = CHAIN_LINE_RE.exec(trimmed);
    if (chain) {
      items.push(draft(normalizeStatus(chain[1]), chain[3], chain[4], Number(chain[5])));
      continue;
    }

    const frame = FRAME_LINE_RE.exec(trimmed);
    if (frame) {
      items.push(draft(normalizeStatus(frame[5]), frame[2], frame[3], Number(frame[4])));
      continue;
    }

    const brk = BREAK_LINE_RE.exec(trimmed);
    if (brk) {
      // The raw frame is the assertion; its claimed file:line is displayed in
      // the location slot but the BREAK badge makes clear the index has no
      // physical counterpart there.
      const claimed = CLAIMED_LOCATION_RE.exec(brk[1]);
      items.push(
        draft(
          'BREAK',
          brk[1],
          claimed ? claimed[1] : '',
          claimed ? Number(claimed[2]) : 0
        )
      );
      continue;
    }

    const plain = PLAIN_LOCATION_RE.exec(trimmed);
    if (plain && plain[2].includes('.')) {
      items.push(draft('VERIFIED', plain[1], plain[2], Number(plain[3])));
    }
  }

  // Anchor merge pass: commit chips + extra verified anchors, deduped by
  // status|label|file:line. First occurrence wins, later ones only top up
  // a missing commit (an anchor always beats a text-only row).
  const byKey = new Map<string, EvidenceItem>();
  const commitByKey = new Map<string, string>();
  const keyOf = (row: Pick<EvidenceItem, 'status' | 'label' | 'file' | 'line'>) =>
    `${row.status}|${row.label}|${row.file}|${row.line}`;

  for (const row of items) byKey.set(keyOf(row), row);
  for (const anchor of anchors) {
    if (!anchor?.file || !anchor.symbol) continue;
    const row = draft('VERIFIED', anchor.symbol, anchor.file, anchor.line);
    const key = keyOf(row);
    if (anchor.commit) commitByKey.set(key, anchor.commit);
    if (!byKey.has(key)) byKey.set(key, row);
  }

  return [...byKey.values()].map((row) => {
    const commit = commitByKey.get(keyOf(row));
    return commit ? { ...row, commit } : row;
  });
}
