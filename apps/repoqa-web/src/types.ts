// Frontend domain types — mirror packages/contracts/src/repoqa.ts semantics.

export type RepoStatus = 'idle' | 'indexing' | 'cloning' | 'parsing' | 'ready' | 'error';

export interface Repo {
  id: string;
  name: string;
  repoUrl?: string;
  localPath: string;
  branch: string;
  status: RepoStatus;
  fileCount: number;
  symbolCount: number;
  /** Live AST parsing progress while status is `indexing`. */
  indexParsed?: number;
  indexTotal?: number;
  createdAt: string;
  updatedAt: string;
  /** Set when indexing failed; the backend answers every 4xx with it too. */
  error?: string;
  /** v0.5.1 (D1): importable root-level dirs offered after an over-limit reject. */
  suggestedSubdirs?: string[];
}

export type SymbolKind =
  | 'class'
  | 'interface'
  | 'method'
  | 'field'
  | 'route'
  | 'service'
  | 'repository'
  | 'advice'
  | 'mapper'
  | 'sql'
  | 'config'
  | 'dependency';

export interface RepoSymbol {
  id: number;
  repoId: string;
  kind: SymbolKind;
  name: string;
  filePath: string;
  lineStart: number | null;
  lineEnd: number | null;
  signature: string | null;
  calls: string | null;
  /** Bug-09: URL path for routing symbols, e.g. `/api/owners/{id}`. */
  displayPath?: string;
  /** Issue 21/24: enclosing type for members, or simple mapper interface name. */
  parentType?: string;
  /** Raw declaration annotations, e.g. `@GetMapping("/owners")` or `router.get`. */
  annotations?: string[];
  /** v0.7 — physical module scope (multi-module repos only). */
  moduleName?: string;
  /** v0.7 — `<module>::[Parent.]Name`, shown on same-name collisions. */
  qualifiedName?: string;
}

export type QueryMode = 'architecture' | 'call-chain' | 'environment' | 'incident';

/** Top-level workbench tabs rendered by the TopBar segmented control. */
export type WorkbenchTab = 'topo' | 'metrics' | 'gate' | 'delta' | 'incident';

/** v0.6.0 — staged indexing pipeline phases broadcast over WebSocket. */
export type IndexingPhase =
  | 'DISCOVERY'
  | 'AST_EXTRACTION'
  | 'CROSS_LANG_BRIDGE'
  | 'FINALIZING';

export interface IndexingProgress {
  repoId: string;
  phase: IndexingPhase;
  phaseLabel?: string;
  currentFile?: string;
  processedFiles?: number;
  totalFiles?: number;
  percent?: number;
}

/** v0.6.0 — Architecture Delta payload returned by the HTTP endpoint. */
export interface ArchitectureDeltaSymbol {
  name: string;
  file: string;
  lineStart: number;
  lineEnd: number;
  kind: string;
  parentType?: string;
  displayPath?: string;
}

export interface ArchitectureDeltaEdge {
  from: { file: string; method: string; line: number };
  to: { file: string; method: string; line: number };
}

export interface ArchitectureDeltaImpactedApi {
  routeSymbol: ArchitectureDeltaSymbol;
  affectedBySymbols: string[];
  riskLevel: 'HIGH' | 'MEDIUM' | 'LOW';
}

export interface ArchitectureDeltaReport {
  schemaVersion: number;
  base: string;
  head: string;
  baseSha?: string;
  headSha?: string;
  addedRoutes: ArchitectureDeltaSymbol[];
  removedRoutes: ArchitectureDeltaSymbol[];
  brokenEdges: ArchitectureDeltaEdge[];
  impactedApis: ArchitectureDeltaImpactedApi[];
  mermaid?: string;
}

/**
 * Explicit trace start (Top API click): the clicked symbol's exact name
 * and file. Sent as startName/startFile to the backend so a call-chain
 * trace never resolves to a same-name symbol in another file (e.g. a
 * production method vs a test helper).
 */
export interface QueryStart {
  name: string;
  file: string;
}

export interface Anchor {
  file: string;
  line: number;
  symbol: string;
  /** Issue 23 / ADR-0010 — physical commit the anchor is pinned to. */
  commit?: string;
  /** Issue 23 — lineEnd for a range anchor (physical anchor quad). */
  lineEnd?: number;
}

/* ------------------------------------------------------------------ */
/* Issue 23 — Architecture & Incident Copilot evidence plane           */
/* ------------------------------------------------------------------ */

/** Zero-Hallucination Contract evidence status for one assertion. */
export type EvidenceStatus = 'VERIFIED' | 'BREAK' | 'SUSPECT';

/** One grounded assertion rendered as an EvidenceCard row. */
export interface EvidenceItem {
  status: EvidenceStatus;
  /** Assertion text, e.g. the symbol name or the raw unresolvable frame. */
  label: string;
  /** Full physical path asserted (may be the frame's claimed path on BREAK). */
  file: string;
  /** Physical line (0 when the frame claims no parseable location). */
  line: number;
  /** Display form, e.g. `DemoService.java:4`. */
  location: string;
  /** Commit short hash chip when the anchor carries the physical commit. */
  commit?: string;
}

/** v0.10 — one hop of a resolved trace, consumed from the SSE done payload. */
export interface TraceStep {
  file: string;
  line: number;
  lineEnd?: number;
  symbol: string;
  /** BROKEN for a static-analysis break hop, otherwise VERIFIED. */
  status: 'BROKEN' | 'VERIFIED';
  /** v0.7 — hop entered via a goroutine dispatch. */
  async?: boolean;
  /** v0.10 — browser HTTP bridge method (GET/POST) when the hop is bridged. */
  httpMethod?: string;
}

/** v0.6 closeout: one static caller of a target symbol (reverse-deps). */
export interface ReverseCaller {
  file: string;
  method: string;
  line: number;
  callLine: number | null;
}

/** Shape of `GET /api/repos/:id/reverse-deps?symbolName=...`. */
export interface ReverseDepsResult {
  repoId: string;
  target: { name: string; file: string; line: number };
  callers: ReverseCaller[];
  count: number;
  fallback: boolean;
}

export interface TokenUsage {
  input: number;
  output: number;
  total: number;
  source: 'provider' | 'estimate';
}

export type LlmRuntimeMode = 'none' | 'local' | 'remote';

export interface RuntimeInfo {
  llm: {
    mode: LlmRuntimeMode;
    host?: string;
  };
}

export type QueryEvent =
  | { type: 'token'; text: string }
  | { type: 'mermaid'; code: string }
  | { type: 'anchors'; anchors: Anchor[] }
  | { type: 'done'; payload?: Record<string, unknown> }
  | { type: 'error'; error: string };

export interface ImportRepoInput {
  name: string;
  localPath: string;
}

export interface RepoPreview {
  path: string;
  fileCount: number;
  javaFileCount: number;
  xmlFileCount: number;
  skippedDirCount: number;
  skippedDirs: string[];
}

/* ------------------------------------------------------------------ */
/* Issue 12/13: zero-prompt dashboard + guided tours                    */
/* ------------------------------------------------------------------ */

export type TechCategory =
  | 'framework'
  | 'security'
  | 'database'
  | 'orm'
  | 'cache'
  | 'observability'
  | 'test'
  | 'http'
  | 'other';

export type ConfigGroup = 'server' | 'datasource' | 'profile' | 'other';

export interface TechStackItem {
  name: string;
  category: TechCategory;
  filePath: string;
  lineStart?: number;
}

export interface ConfigTopologyItem {
  key: string;
  filePath: string;
  lineStart?: number;
  group: ConfigGroup;
  /** True when the key is a credential key — its value is never indexed nor shown. */
  sensitive: boolean;
}

export interface TopApiEntry {
  name: string;
  controller: string;
  filePath: string;
  lineStart: number;
  /** Number of statically resolved hops (including the entry method itself). */
  depth: number;
  /** Method names along the resolved chain, e.g. ['listOrders', 'findOrders', 'findAll']. */
  hops: string[];
}

export interface RepoDashboard {
  repoId: string;
  repoName?: string;
  techStack: {
    /** One entry per detected category, in canonical category order. */
    summary: Array<{
      category: TechCategory;
      label: string;
      count: number;
      items: TechStackItem[];
    }>;
    /** Canonical framework labels, e.g. ['Spring Boot', 'Spring Security']. */
    highlights: string[];
  };
  config: {
    topology: ConfigTopologyItem[];
    /** Values are never indexed by design (issue 06), so nothing sensitive is present. */
    maskedValues: true;
  };
  scale: {
    routes: number;
    services: number;
    repositories: number;
    advices: number;
    plainClasses: number;
    interfaces: number;
    methods: number;
    fields: number;
    configKeys: number;
    /** Distinct file paths that contributed symbols. */
    files: number;
  };
  topApis: TopApiEntry[];
}

export type RepoTourId = 'auth-chain' | 'main-flow' | 'error-handling';

export interface RepoTourStep {
  /** Human-readable step name, e.g. `1. AuthFilter.doFilter（认证过滤器）`. */
  step: string;
  filePath: string;
  lineNumber: number;
  /** Symbol name the step jumps to (method or class). */
  symbol: string;
  kind: SymbolKind;
  /** Optional contextual note, e.g. a static-analysis break reason. */
  note?: string;
}

export interface RepoTour {
  id: RepoTourId;
  title: string;
  description: string;
  /** Ordered steps, each with an exact source location. */
  steps: RepoTourStep[];
  /** Mermaid flowchart; every locatable node carries a code:// click binding. */
  mermaid: string;
}

/* ------------------------------------------------------------------ */
/* Issue 28: AST Graph RAG subgraph context                            */
/* ------------------------------------------------------------------ */

export type SubgraphDirection = 'start' | 'caller' | 'callee';

export interface SubgraphContextNode {
  name: string;
  file: string;
  line: number;
  distance: number;
  direction: SubgraphDirection;
  tokens: number;
}

export interface SubgraphContextResult {
  start: { name: string; file: string; line: number };
  nodes: SubgraphContextNode[];
  tokenCount: number;
  truncated: boolean;
  prunedCount: number;
  /** Agent-ready Markdown with masked source slices and class skeletons. */
  text: string;
}

/* ------------------------------------------------------------------ */
/* v0.11: Cmd+K domain-radar symbols                                   */
/* ------------------------------------------------------------------ */

export interface DomainRadarAnchor {
  symbol: string;
  type: 'CONTROLLER' | 'SERVICE' | 'ENTITY';
  /** 0..100 deterministic score. */
  relevanceScore: number;
  filePath: string;
  line: number;
  /** v0.18 — provenance: identifier fuzzy hit, doc-chunk bridge or graph rank. */
  matchedBy: 'identifier' | 'doc-chunk' | 'graph-rank';
  /** Incoming call count from the static symbol graph. */
  inDegree: number;
  /** Outgoing call count from the static symbol graph. */
  outDegree: number;
}

export interface DomainRadarResult {
  schemaVersion: number;
  repoId: string;
  matchedAnchors: DomainRadarAnchor[];
  hubNodes: Array<{
    symbol: string;
    inDegree: number;
    outDegree: number;
    pagerank: number;
    role: string;
  }>;
  topApis: string[];
  persistenceEntities: string[];
}
