// v1 Core Contracts (working draft)
// These types are shared between Electron UI and Control Plane.

import type {
  IndexingPhase
} from './src/repoqa';

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
  phase: 'cloning' | 'parsing' | 'ready' | 'error' | IndexingPhase;
  detail?: string;
  parsedCount?: number;
  totalFiles?: number;
  /** v0.6.0 — staged pipeline fields broadcast during indexing. */
  phaseLabel?: string;
  currentFile?: string;
  processedFiles?: number;
  percent?: number;
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
  /** ADR-0010 — definition end line (file:line-range anchor). */
  lineEnd?: number;
  /** ADR-0010 — repo commit the anchor was minted against (`hash` or `hash+dirty`). */
  commit?: string;
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
  /** v0.7 — hop entered via a `go fn(...)` Goroutine dispatch. */
  async?: true;
  /** v0.10 — browser HTTP bridge evidence for the hop (method + URL). */
  http?: {
    method: string;
    url?: string;
  };
}

export interface RepoQaQueryDone {
  answer: string;
  suggestedAction?: string;
  mermaid?: string;
  anchors?: RepoQaAnchor[];
  trace?: RepoQaTraceHop[];
  confidence?: number;
  lowConfidence: boolean;
  provenance: 'static' | 'llm';
  usage: RepoQaTokenUsage;
  /** ADR-0010 — commit the answer's anchors were minted against. */
  commit?: string;
  /** Issue 25 / Ticket 03 — persisted incident-card id/seq. */
  cardId?: string;
  cardSeq?: number;
}

export interface RepoQaTokenUsage {
  input: number;
  output: number;
  total: number;
  source: 'provider' | 'estimate';
}

export interface RepoQaQueryError {
  error: string;
}

export interface RepoUpdated {
  repoId: string;
  files: string[];
  action: 'update' | 'remove';
  ts: number;
}

// Issue 24 / Ticket 04 — single source of truth lives in src/repoqa.ts;
// the ServerEvent union below references these, so import then re-export.
import type {
  EvolutionStageId,
  EvolutionIntentEcho,
  RepoQaEvolveStage,
  RepoQaEvolveDone,
  RepoQaEvolveError
} from './src/repoqa';
export type {
  EvolutionStageId,
  EvolutionIntentEcho,
  RepoQaEvolveStage,
  RepoQaEvolveDone,
  RepoQaEvolveError
};

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
  | { type: 'repoqa.query.error'; payload: RepoQaQueryError }
  | { type: 'repoqa.evolve.stage'; payload: RepoQaEvolveStage }
  | { type: 'repoqa.evolve.done'; payload: RepoQaEvolveDone }
  | { type: 'repoqa.evolve.error'; payload: RepoQaEvolveError }
  | { type: 'repo_updated'; payload: RepoUpdated };
