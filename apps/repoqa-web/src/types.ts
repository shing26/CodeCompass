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
  | 'repository';

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