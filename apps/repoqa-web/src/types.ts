// Frontend domain types. V27-29 (B2) single-source surgery:
//  - contract-shared types are no longer hand-mirrored — they are re-exported
//    from packages/contracts (src/repoqa.ts + v1.ts via its index). `import type`
//    is erased at build time and contracts is a pure-types package, so the web
//    bundle gains zero bytes while tsc now catches every drift at compile time
//    (contract-mirror.test.ts guards the remaining hand-written block).
//  - web-only types below still mirror control-plane HTTP/SSE payloads
//    (services/control-plane/src/ingest/repoqa-repos.ts et al.) — not contracts.
// Two documented aliases keep consumer imports stable:
//  ArchitectureDeltaSymbol/Edge = contracts ExtractedSymbol/CallEdge (same
//  fields, delta-flavored names kept for view readability); TokenUsage =
//  contracts RepoQaTokenUsage — contracts' own `TokenUsage` is the harness
//  'token.usage' WS event ({taskId,input,output}), a different concept.
import type {
  ArchitectureDeltaReport,
  CallEdge,
  ConventionAnchor,
  ConventionConflictDetail,
  DomainRadarAnchor,
  DomainRadarResult,
  EvolutionIntentEcho,
  EvolutionPlacement,
  EvolutionPlacementFile,
  EvolutionRisk,
  EvolutionStageId,
  ExtractedSymbol,
  IndexingPhase,
  ModuleEvolutionResult,
  RepoQaEvolveDone,
  RepoQaEvolveError,
  RepoQaEvolveStage,
  RepoQaTokenUsage
} from '../../../packages/contracts/src/index';

export type {
  ArchitectureDeltaReport,
  ConventionAnchor,
  ConventionConflictDetail,
  DomainRadarAnchor,
  DomainRadarResult,
  EvolutionIntentEcho,
  EvolutionPlacement,
  EvolutionPlacementFile,
  EvolutionRisk,
  EvolutionStageId,
  IndexingPhase,
  ModuleEvolutionResult,
  RepoQaEvolveDone,
  RepoQaEvolveError,
  RepoQaEvolveStage
};
export type { ExtractedSymbol as ArchitectureDeltaSymbol, CallEdge as ArchitectureDeltaEdge };
/** Derived so the element shape can never drift from the report it feeds. */
export type ArchitectureDeltaImpactedApi = ArchitectureDeltaReport['impactedApis'][number];
export type TokenUsage = RepoQaTokenUsage;

export type RepoStatus = 'idle' | 'indexing' | 'cloning' | 'parsing' | 'ready' | 'error';

export interface Repo {
  id: string;
  name: string;
  repoUrl?: string;
  localPath: string;
  branch: string;
  /**
   * R3-Bug-02 — working tree's default branch as served by GET /api/repos
   * (resolved from HEAD / origin/HEAD). `branch` keeps the stale catalog
   * value; the delta/CI views default their base ref to this one.
   */
  defaultBranch?: string;
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
  /** Issue 23 / ADR-0010 - physical commit of the indexed tree: `hash`,
   *  `hash+dirty` when uncommitted changes exist, `unversioned` otherwise.
   *  Ticket 24.5: stream-isolation key component (repoId, commit). */
  commit?: string;
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
export type WorkbenchTab = 'topo' | 'metrics' | 'gate' | 'delta' | 'incident' | 'evolve' | 'chat';

// IndexingPhase is re-exported from contracts above (V27-29 single source).
export interface IndexingProgress {
  repoId: string;
  phase: IndexingPhase;
  phaseLabel?: string;
  currentFile?: string;
  processedFiles?: number;
  totalFiles?: number;
  percent?: number;
}

/* ------------------------------------------------------------------ */
/* Issue 23 / v0.6 — Architecture Delta types are re-exported from     */
/* contracts above (V27-29); ArchitectureDeltaSymbol/Edge/ImpactedApi  */
/* keep their historical names via alias/derivation.                   */
/* ------------------------------------------------------------------ */

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

// TokenUsage is re-exported from contracts as RepoQaTokenUsage (see top).
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
  | { type: 'error'; error: string; cardId?: string; cardSeq?: number };

/** Issue 25 / Ticket 03 — one persisted workbench card replayed by the
 * hydrate endpoint (GET /api/repos/:id/workbench-cards). */
export interface WorkbenchCardRow {
  id: string;
  seq: number;
  kind: 'evolve' | 'incident';
  intent: string | null;
  target?: string;
  status: 'done' | 'error';
  /** evolve: the intent-echo object; incident: the raw pasted stack text. */
  echo?: unknown;
  /** evolve: ModuleEvolutionResult; incident: { answer, anchors, usage, ... }. */
  result?: unknown;
  mermaid: string | null;
  conflict?: unknown;
  error: string | null;
  createdAt: string;
}

/** v0.26-B ticket 01 / ADR-0017 — policy knobs snapshot stored with a gate
 * run (server mirrors this shape; verdict replays never re-read live config). */
export interface GateRunPolicyOptions {
  maxAffectedRoutes?: number;
  failOnBreak?: boolean;
  failOnAuthImpact?: boolean;
}

/** v0.26-B ticket 01 — one persisted server-side gate run, as replayed by
 * GET /api/repos/:id/gate-runs and echoed by POST .../gate/run. `error`
 * non-null marks a run that broke (ticket-14 semantics, first human line;
 * raw output in `detail`, folded in the UI). `commit` carries the physical
 * stream tag: hash / hash+dirty / unversioned (dirty runs isolate per Q12). */
export interface GateRunRow {
  id: string;
  commit: string;
  base: string;
  head: string;
  options: GateRunPolicyOptions;
  status: 'PASS' | 'FAIL';
  violationsCount: number;
  routesCount: number;
  error: string | null;
  detail: string | null;
  durationMs: number | null;
  source: string;
  createdAt: string;
  payload?: unknown;
}

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
/* v0.11: Cmd+K domain-radar types are re-exported from contracts      */
/* above (V27-29 single source).                                       */
/* ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ */
/* Issue 24 / Ticket 04 — Evolution workbench types (stage/echo/       */
/* placement/risk/conflict/result/evolve frames) are re-exported from  */
/* contracts above (V27-29 single source).                             */
/* ------------------------------------------------------------------ */

/** Client-side mirror of one parsed evolve SSE frame. */
export type EvolveEvent =
  | { type: 'stage'; payload: RepoQaEvolveStage }
  | { type: 'done'; payload: RepoQaEvolveDone }
  | { type: 'error'; payload: RepoQaEvolveError };
