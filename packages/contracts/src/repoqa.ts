export type RepoQATaskType = 'repoqa.index' | 'repoqa.query';

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
