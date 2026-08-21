import type {
  HarnessStatus,
  HarnessType,
  LogStream,
  Task
} from '../../contracts/src/index';

export interface AdapterContext {
  onLog(stream: LogStream, text: string): void;
  onToken(input: number, output: number): void;
  onDone(output: Record<string, unknown>): void;
  onFailed(error: string): void;
}

export interface BridgeAdapter {
  readonly type: HarnessType;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  submit(task: Task, ctx: AdapterContext): Promise<void>;
  cancel(taskId: string): Promise<void>;
  status(): HarnessStatus;
}
