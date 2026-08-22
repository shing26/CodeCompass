// v1 Core Contracts (working draft)
// These types are shared between Electron UI and Control Plane.

export type TaskType = 'coding' | 'shell' | 'browser';
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
export type HarnessType = 'coding' | 'shell' | 'browser' | 'external';
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
  tokenUsage?: { input: number; output: number };
  durationMs?: number;
}

export interface Harness {
  id: string;
  name: string;
  type: HarnessType;
  mode: HarnessMode;
  status: HarnessStatus;
  bridgeAdapter: string;
  config: Record<string, unknown>;
}

export type LogStream = 'stdout' | 'stderr' | 'system';

export interface LogChunk {
  taskId: string;
  stream: LogStream;
  text: string;
}

export interface TokenUsage {
  taskId: string;
  input: number;
  output: number;
}

export interface ApprovalRequested {
  taskId: string;
  reason: string;
}

export interface ApprovalResolved {
  taskId: string;
  approved: boolean;
}

export interface RepoQaIndexProgress {
  repoId: string;
  phase: 'cloning' | 'parsing' | 'ready' | 'error';
  detail?: string;
}

export interface RepoQaIndexDone {
  repoId: string;
  status: 'ready' | 'error';
  fileCount: number;
  symbolCount: number;
}

export interface RepoQaIndexError {
  error: string;
}

export interface RepoQaAnchor {
  file: string;
  line: number;
  symbol: string;
}

export interface RepoQaQueryToken {
  token: string;
}

export interface RepoQaQueryMermaid {
  mermaid: string;
}

export interface RepoQaQueryAnchors {
  anchors: RepoQaAnchor[];
}

export interface RepoQaTraceHop {
  file: string;
  method: string;
  /** Definition start line of the resolved target (or call-site line for a break hop). */
  line?: number;
  /** Definition end line of the resolved target (start/end range for one hop). */
  lineEnd?: number;
  /** Line in the caller where the call happens (0/undefined when unknown). */
  callLine?: number;
  break?: true;
  /** Human-readable break marker, e.g. '[Static Analysis Break: Dynamic/RPC Dispatch]'. */
  reason?: string;
}

export interface RepoQaQueryDone {
  answer: string;
  suggestedAction?: string;
  mermaid?: string;
  anchors?: RepoQaAnchor[];
  trace?: RepoQaTraceHop[];
}

export interface RepoQaQueryError {
  error: string;
}

// WebSocket event envelope
export type ServerEvent =
  | { type: 'task.created'; payload: Task }
  | { type: 'task.updated'; payload: Task }
  | { type: 'harness.connected'; payload: Harness }
  | { type: 'harness.disconnected'; payload: Harness }
  | { type: 'log.chunk'; payload: LogChunk }
  | { type: 'token.usage'; payload: TokenUsage }
  | { type: 'approval.requested'; payload: ApprovalRequested }
  | { type: 'approval.resolved'; payload: ApprovalResolved }
  | { type: 'repoqa.index.progress'; payload: RepoQaIndexProgress }
  | { type: 'repoqa.index.done'; payload: RepoQaIndexDone }
  | { type: 'repoqa.index.error'; payload: RepoQaIndexError }
  | { type: 'repoqa.query.token'; payload: RepoQaQueryToken }
  | { type: 'repoqa.query.mermaid'; payload: RepoQaQueryMermaid }
  | { type: 'repoqa.query.anchors'; payload: RepoQaQueryAnchors }
  | { type: 'repoqa.query.done'; payload: RepoQaQueryDone }
  | { type: 'repoqa.query.error'; payload: RepoQaQueryError };
