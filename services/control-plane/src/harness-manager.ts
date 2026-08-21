import type {
  Harness,
  HarnessStatus,
  Task,
  TaskType
} from '../../../packages/contracts/src/index';
import type {
  AdapterContext,
  BridgeAdapter
} from '../../../packages/bridge-adapters/src/index';
import {
  BrowserAdapter,
  CodingAdapter,
  ShellAdapter
} from '../../../packages/bridge-adapters/src/index';
import type { EventBus } from './events';
import type { Repos } from './repos';

interface HarnessRecord {
  harness: Harness;
  adapter: BridgeAdapter;
}

export interface HarnessManagerOptions {
  repos: Repos;
  eventBus: EventBus;
  adapters?: BridgeAdapter[];
}

export class HarnessManager {
  private records = new Map<string, HarnessRecord>();

  constructor(private options: HarnessManagerOptions) {}

  async init(): Promise<void> {
    const adapters =
      this.options.adapters ??
      [new ShellAdapter(), new BrowserAdapter(), new CodingAdapter()];
    for (const adapter of adapters) {
      const id = `builtin-${adapter.type}`;
      const now = new Date().toISOString();
      const harness: Harness = {
        id,
        name: `${adapter.type} harness`,
        type: adapter.type,
        mode: 'builtin',
        status: 'connecting',
        bridgeAdapter: 'bridge-v1',
        config: {}
      };
      this.records.set(id, { harness, adapter });
      await adapter.connect();
      harness.status = 'ready';
      this.options.repos.upsertHarness(harness);
      this.options.eventBus.emit({ type: 'harness.connected', payload: harness });
    }
  }

  acquire(taskType: TaskType): Harness | null {
    for (const record of this.records.values()) {
      if (record.harness.type === taskType && record.harness.status === 'ready') {
        this.setStatus(record.harness.id, 'busy');
        return record.harness;
      }
    }
    return null;
  }

  release(harnessId: string): void {
    this.setStatus(harnessId, 'ready');
  }

  async run(harnessId: string, task: Task, ctx: AdapterContext): Promise<void> {
    const record = this.records.get(harnessId);
    if (!record) throw new Error(`Unknown harness: ${harnessId}`);
    await record.adapter.submit(task, ctx);
  }

  async cancel(harnessId: string, taskId: string): Promise<void> {
    const record = this.records.get(harnessId);
    if (!record) return;
    await record.adapter.cancel(taskId);
  }

  async shutdown(): Promise<void> {
    for (const record of this.records.values()) {
      await record.adapter.disconnect();
      this.setStatus(record.harness.id, 'disconnected');
      this.options.eventBus.emit({
        type: 'harness.disconnected',
        payload: record.harness
      });
    }
  }

  private setStatus(harnessId: string, status: HarnessStatus): void {
    const record = this.records.get(harnessId);
    if (!record) return;
    record.harness.status = status;
    this.options.repos.updateHarnessStatus(harnessId, status);
  }
}
