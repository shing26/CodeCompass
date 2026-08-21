export type TaskType = 'coding' | 'shell' | 'browser' | 'repoqa.index' | 'repoqa.query';
export type TaskStatus =
  | 'pending'
  | 'assigned'
  | 'running'
  | 'paused'
  | 'waiting_approval'
  | 'retrying'
  | 'timeout'
  | 'done'
  | 'failed'
  | 'cancelled';
export type HarnessMode = 'builtin' | 'external';
export type HarnessStatus = 'disconnected' | 'connecting' | 'ready' | 'busy' | 'error';

export interface Task {
  id: string;
  workspaceId: string;
  type: TaskType;
  status: TaskStatus;
  input: Record<string, unknown>;
  output?: Record<string, unknown>;
  assignedHarnessId?: string;
  createdAt: string;
  updatedAt: string;
  requiresApproval?: boolean;
  tokenInput: number;
  tokenOutput: number;
  durationMs?: number;
}

export interface Harness {
  id: string;
  name: string;
  type: TaskType;
  mode: HarnessMode;
  status: HarnessStatus;
  bridgeAdapter: string;
  config: Record<string, unknown>;
}

export type ServerEvent =
  | { type: 'task.created'; payload: Task }
  | { type: 'task.updated'; payload: Task }
  | { type: 'harness.connected'; payload: Harness }
  | { type: 'harness.disconnected'; payload: Harness }
  | { type: 'log.chunk'; payload: { taskId: string; stream: string; text: string } }
  | { type: 'token.usage'; payload: { taskId: string; input: number; output: number } }
  | { type: 'approval.requested'; payload: { taskId: string; reason: string } }
  | { type: 'approval.resolved'; payload: { taskId: string; approved: boolean } }
  | { type: 'repoqa.index.progress'; payload: { repoId: string; phase: string; detail?: string } }
  | { type: 'repoqa.index.done'; payload: { repoId: string; status: string; fileCount: number; symbolCount: number } }
  | { type: 'repoqa.index.error'; payload: { error: string } }
  | { type: 'repoqa.query.done'; payload: Record<string, unknown> }
  | { type: 'repoqa.query.error'; payload: { error: string } };
