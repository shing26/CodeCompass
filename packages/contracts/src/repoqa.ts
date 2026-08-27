export type RepoQATaskType = 'repoqa.index' | 'repoqa.query';

/** v0.6.0 — staged indexing pipeline phases broadcast over SSE/WebSocket. */
export type IndexingPhase =
  | 'DISCOVERY'
  | 'AST_EXTRACTION'
  | 'CROSS_LANG_BRIDGE'
  | 'FINALIZING';

export interface IndexingProgressPayload {
  repoId: string;
  phase: IndexingPhase;
  phaseLabel: string;
  currentFile?: string;
  processedFiles: number;
  totalFiles: number;
  /** 0..100 — 100 only on FINALIZING completion. */
  percent: number;
}

/** v0.6.0 — Architecture Delta symbol/edge summary used by CLI/API/UI. */
export interface ExtractedSymbol {
  name: string;
  file: string;
  lineStart: number;
  lineEnd: number;
  kind: string;
  parentType?: string;
  displayPath?: string;
}

export interface CallEdge {
  from: { file: string; method: string; line: number };
  to: { file: string; method: string; line: number };
}

export interface ArchitectureDeltaReport {
  schemaVersion: number;
  base: string;
  head: string;
  baseSha?: string;
  headSha?: string;
  addedRoutes: ExtractedSymbol[];
  removedRoutes: ExtractedSymbol[];
  brokenEdges: CallEdge[];
  impactedApis: Array<{
    routeSymbol: ExtractedSymbol;
    affectedBySymbols: string[];
    riskLevel: 'HIGH' | 'MEDIUM' | 'LOW';
  }>;
  /** Reverse/delta Mermaid diagram; optional for small deltas. */
  mermaid?: string;
}

export interface IndexJobInput {
  repoUrl?: string;
  localPath: string;
  branch?: string;
  languages?: string[];
}

export interface IndexJobOutput {
  status: 'cloning' | 'parsing' | 'ready' | 'error';
  repoId: string;
  fileCount: number;
  symbolCount: number;
  error?: string;
}

export interface QueryJobInput {
  repoId: string;
  question: string;
  mode?: 'architecture' | 'call-chain' | 'environment';
}

export interface QueryJobOutput {
  answer: string;
  suggestedAction?: string;
  mermaid?: string;
  anchors?: Array<{
    file: string;
    line: number;
    symbol: string;
  }>;
  trace?: Array<{
    file: string;
    method: string;
    line: number;
  }>;
}
