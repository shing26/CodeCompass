import type { HarnessStatus, Task } from '../../contracts/src/index';
import type { AdapterContext, BridgeAdapter } from './types';

export class CodingAdapter implements BridgeAdapter {
  readonly type = 'coding' as const;
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
    const input = (task.input ?? {}) as { prompt?: string; delayMs?: number };
    const delayMs = input.delayMs ?? 300;
    const prompt = input.prompt ?? 'unspecified request';

    ctx.onLog('system', `coding harness: planning for "${prompt.slice(0, 80)}"`);
    if (await sleepCancellable(delayMs, () => this.cancelled.has(task.id))) return;
    ctx.onLog('stdout', 'coding harness: draft produced (stub)');
    if (await sleepCancellable(delayMs / 2, () => this.cancelled.has(task.id))) return;
    ctx.onToken(240, 120);
    ctx.onDone({ mode: 'stub', prompt });
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
