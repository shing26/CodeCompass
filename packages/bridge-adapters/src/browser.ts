import type { HarnessStatus, Task } from '../../contracts/src/index';
import type { AdapterContext, BridgeAdapter } from './types';

export class BrowserAdapter implements BridgeAdapter {
  readonly type = 'browser' as const;
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
    const input = (task.input ?? {}) as { url?: string; delayMs?: number };
    const url = input.url ?? 'about:blank';
    const delayMs = input.delayMs ?? 300;

    ctx.onLog('system', `browser harness: opening ${url}`);
    if (await sleepCancellable(delayMs, () => this.cancelled.has(task.id))) return;
    ctx.onLog('stdout', 'browser harness: page loaded');
    if (await sleepCancellable(delayMs / 2, () => this.cancelled.has(task.id))) return;
    ctx.onToken(60, 20);
    ctx.onDone({ url, mode: 'stub' });
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
