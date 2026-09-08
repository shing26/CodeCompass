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
