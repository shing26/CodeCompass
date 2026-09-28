import fs from 'node:fs';
import path from 'node:path';

export interface SessionEvent {
  ts: string;
  type: string;
  [key: string]: unknown;
}

/**
 * JSONL session log (grill Q4): one line per event, replayable — this is the
 * M3 dogfooding forensic substrate (issue 04/06 evidence lives here).
 */
export class SessionLogger {
  private stream: fs.WriteStream | undefined;
  private file = '';

  constructor(private readonly sessionsDir: string) {}

  start(): string {
    fs.mkdirSync(this.sessionsDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    this.file = path.join(this.sessionsDir, `session-${stamp}.jsonl`);
    this.stream = fs.createWriteStream(this.file, { flags: 'a' });
    return this.file;
  }

  write(type: string, fields: Record<string, unknown> = {}): void {
    if (!this.stream) return;
    const event: SessionEvent = { ts: new Date().toISOString(), type, ...fields };
    this.stream.write(JSON.stringify(event) + '\n');
  }

  stop(): void {
    this.stream?.end();
    this.stream = undefined;
  }

  get currentFile(): string {
    return this.file;
  }
}

export interface TurnAudit {
  turnId: string;
  /** tool_result rows carrying this turnId. */
  records: number;
  /** Expected count (the turn's citations / done payload count). */
  citations: number;
  /** tool_result rows in the provided window that carry no turnId at all —
   * the "broken link" a writer regression would produce. */
  missingTurnId: number;
  consistent: boolean;
}

/**
 * Ticket 08 (v1.1) — turn-level consistency check over parsed session rows:
 * the tool_result records linked by one turnId must be exactly as many as the
 * turn's citations, and no row in the window may silently lack the key. Rows
 * predating ticket 08 have no turnId; the caller scopes the window so legacy
 * rows don't false-positive (the missingTurnId count is only meaningful for
 * rows this-side of the upgrade).
 */
export function auditTurnRecords(
  rows: SessionEvent[],
  turnId: string,
  expectedCitations: number,
): TurnAudit {
  const records = rows.filter((r) => r.type === 'tool_result' && r.turnId === turnId).length;
  const missingTurnId = rows.filter((r) => r.type === 'tool_result' && !r.turnId).length;
  return {
    turnId,
    records,
    citations: expectedCitations,
    missingTurnId,
    consistent: records === expectedCitations && missingTurnId === 0,
  };
}
