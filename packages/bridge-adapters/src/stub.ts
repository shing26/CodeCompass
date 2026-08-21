import type { HarnessStatus, Task } from '../../contracts/src/index';
import type { AdapterContext, BridgeAdapter } from './types';

const DEFAULT_LINES = ['stub harness started', 'processing simulated payload', 'stub harness finished'];

export class StubAdapter implements BridgeAdapter {
  readonly type = 'shell' as const;
  private state: HarnessStatus = 'disconnected';
  private cancelled = new Set<string>();

  async connect(): Promise<void> {
    this.state = 'ready';
  }

  async disconnect(): Promise<void> {
    this.state = 'disconnected';
  }

  status(): HarnessStatus {
    return this.state;
  }

  async cancel(taskId: string): Promise<void> {
    this.cancelled.add(taskId);
  }

  async submit(task: Task, ctx: AdapterContext): Promise<void> {
    const input = (task.input ?? {}) as { delayMs?: number; lines?: string[] };
    const delayMs = input.delayMs ?? 250;
    const lines = input.lines ?? DEFAULT_LINES;

    for (const line of lines) {
      if (await sleepCancellable(delayMs / lines.length, () => this.cancelled.has(task.id))) return;
      ctx.onLog('stdout', line);
    }
    if (this.cancelled.has(task.id)) return;
    ctx.onToken(120, 40);
    ctx.onDone({ mode: 'stub', lines });
  }
}

async function sleepCancellable(
  ms: number,
  shouldStop: () => boolean
): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < ms) {
    if (shouldStop()) return true;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return shouldStop();
}
