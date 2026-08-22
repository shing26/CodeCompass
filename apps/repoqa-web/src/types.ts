// Frontend domain types — mirror packages/contracts/src/repoqa.ts semantics.

export type RepoStatus = 'idle' | 'cloning' | 'parsing' | 'ready' | 'error';

export interface Repo {
  id: string;
  name: string;
  repo_url?: string;
  local_path: string;
  branch: string;
  status: RepoStatus;
  file_count: number;
  symbol_count: number;
  created_at: string;
  updated_at: string;
}

export type SymbolKind =
  | 'class'
  | 'interface'
  | 'method'
  | 'field'
  | 'route'
  | 'service'
  | 'repository'
  | 'advice';

export interface RepoSymbol {
  id: number;
  repo_id: string;
  kind: SymbolKind;
  name: string;
  file_path: string;
  line_start: number | null;
  line_end: number | null;
  signature: string | null;
  calls: string | null;
}

export type QueryMode = 'architecture' | 'call-chain' | 'environment';

export interface Anchor {
  file: string;
  line: number;
  symbol: string;
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
    classes: number;
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