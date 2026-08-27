import type {
  Anchor,
  ArchitectureDeltaReport,
  ImportRepoInput,
  QueryEvent,
  QueryMode,
  QueryStart,
  Repo,
  RepoDashboard,
  RepoPreview,
  RepoSymbol,
  RepoTour,
  RuntimeInfo,
  SubgraphContextResult,
  SymbolKind
} from '../types';

/**
 * RepoQAClient — thin typed wrapper over the Control Plane RepoQA API.
 *
 * The constructor takes a base URL so tests can inject a mock; the class is the
 * single place where fetch/EventSource live. Components consume it via
 * dependency injection and never touch fetch directly.
 */
export class RepoQAClient {
  readonly baseUrl: string;
  private readonly fetcher: typeof fetch;

  constructor(baseUrl: string, fetcher: typeof fetch = fetch) {
    this.baseUrl = baseUrl;
    // Wrap fetch in a closure: calling it as `this.fetcher(...)` binds `this`
    // to this class instance, which browsers reject ("Illegal invocation" —
    // fetch expects the Window as receiver). The closure keeps the real
    // function's receiver scope so `await this.fetcher(url)` is safe.
    this.fetcher = (...args) => fetcher(...args);
  }

  async listRepos(): Promise<Repo[]> {
    const res = await this.fetcher(`${this.baseUrl}/api/repos`);
    if (!res.ok) throw new Error(`listRepos failed: ${res.status}`);
    const body = (await res.json()) as { repos?: Repo[] };
    return body.repos ?? [];
  }

  async getRuntime(): Promise<RuntimeInfo> {
    const res = await this.fetcher(`${this.baseUrl}/api/runtime`);
    if (!res.ok) throw new Error(`getRuntime failed: ${res.status}`);
    return (await res.json()) as RuntimeInfo;
  }

  async getRepo(id: string): Promise<Repo | null> {
    const res = await this.fetcher(`${this.baseUrl}/api/repos/${encodeURIComponent(id)}`);
    if (!res.ok) {
      if (res.status === 404) return null;
      throw new Error(`getRepo failed: ${res.status}`);
    }
    const body = (await res.json()) as { repo?: Repo };
    return body.repo ?? null;
  }

  async importRepo(input: ImportRepoInput): Promise<Repo> {
    const res = await this.fetcher(`${this.baseUrl}/api/repos`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input)
    });
    if (!res.ok) {
      // Bug-05: surface the backend's real error (e.g. an invalid local path)
      // instead of a status-only message. The backend always answers 4xx/5xx
      // with { error } but guard against non-JSON bodies defensively.
      let detail = '';
      try {
        const body = (await res.json()) as { error?: unknown };
        if (typeof body.error === 'string' && body.error !== '') {
          detail = `: ${body.error}`;
        }
      } catch {
        // non-JSON body — fall back to the status-only message below
      }
      throw new Error(`importRepo failed: ${res.status}${detail}`);
    }
    const body = (await res.json()) as { repo?: Repo };
    if (!body.repo) throw new Error('importRepo failed: missing repo in response');
    return body.repo;
  }

  /** Round 2 B4: read-only pre-import preview of file/dir counts. */
  async previewRepo(localPath: string): Promise<RepoPreview> {
    const res = await this.fetcher(`${this.baseUrl}/api/repos/preview`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ localPath })
    });
    if (!res.ok) {
      let detail = '';
      try {
        const body = (await res.json()) as { error?: unknown };
        if (typeof body.error === 'string' && body.error !== '') {
          detail = `: ${body.error}`;
        }
      } catch {
        // non-JSON body — fall back to the status-only message below
      }
      throw new Error(`previewRepo failed: ${res.status}${detail}`);
    }
    const body = (await res.json()) as { preview?: RepoPreview };
    if (!body.preview) throw new Error('previewRepo failed: missing preview in response');
    return body.preview;
  }

  /** Personal-use lifecycle: remove a repo index (source files stay on disk). */
  async deleteRepo(repoId: string): Promise<void> {
    const res = await this.fetcher(
      `${this.baseUrl}/api/repos/${encodeURIComponent(repoId)}`,
      { method: 'DELETE' }
    );
    if (!res.ok) {
      let detail = '';
      try {
        const body = (await res.json()) as { error?: unknown };
        if (typeof body.error === 'string' && body.error !== '') {
          detail = `: ${body.error}`;
        }
      } catch {
        // non-JSON body — fall back to the status-only message below
      }
      throw new Error(`deleteRepo failed: ${res.status}${detail}`);
    }
  }

  /** Personal-use lifecycle: rebuild the stored repo's index in the background. */
  async reindexRepo(repoId: string): Promise<Repo> {
    const res = await this.fetcher(
      `${this.baseUrl}/api/repos/${encodeURIComponent(repoId)}/reindex`,
      { method: 'POST' }
    );
    if (!res.ok) {
      let detail = '';
      try {
        const body = (await res.json()) as { error?: unknown };
        if (typeof body.error === 'string' && body.error !== '') {
          detail = `: ${body.error}`;
        }
      } catch {
        // non-JSON body — fall back to the status-only message below
      }
      throw new Error(`reindexRepo failed: ${res.status}${detail}`);
    }
    const body = (await res.json()) as { repo?: Repo };
    if (!body.repo) throw new Error('reindexRepo failed: missing repo in response');
    return body.repo;
  }

  /**
   * Issue 19: clone a remote repo on the server (safe shallow clone) and kick
   * off async indexing. Resolves as soon as the clone lands (202), while the
   * repo status remains `indexing` until the catalog poll sees `ready`.
   */
  async cloneRepo(url: string, branch?: string): Promise<Repo> {
    const res = await this.fetcher(`${this.baseUrl}/api/repos/clone`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url, ...(branch ? { branch } : {}) })
    });
    if (!res.ok) {
      let detail = '';
      try {
        const body = (await res.json()) as { error?: unknown };
        if (typeof body.error === 'string' && body.error !== '') {
          detail = `: ${body.error}`;
        }
      } catch {
        // non-JSON body — fall back to the status-only message below
      }
      throw new Error(`cloneRepo failed: ${res.status}${detail}`);
    }
    const body = (await res.json()) as { repo?: Repo };
    if (!body.repo) throw new Error('cloneRepo failed: missing repo in response');
    return body.repo;
  }

  async listSymbols(repoId: string, kind?: SymbolKind): Promise<RepoSymbol[]> {
    const params = kind ? `?kind=${encodeURIComponent(kind)}` : '';
    const res = await this.fetcher(
      `${this.baseUrl}/api/repos/${encodeURIComponent(repoId)}/symbols${params}`
    );
    if (!res.ok) throw new Error(`listSymbols failed: ${res.status}`);
    const body = (await res.json()) as { symbols?: RepoSymbol[] };
    return body.symbols ?? [];
  }

  async getFileRaw(repoId: string, path: string): Promise<string> {
    const res = await this.fetcher(
      `${this.baseUrl}/api/repos/${encodeURIComponent(repoId)}/file/raw?path=${encodeURIComponent(path)}`
    );
    if (!res.ok) throw new Error(`getFileRaw failed: ${res.status}`);
    return await res.text();
  }

  /** Issue 12/13: zero-prompt dashboard aggregation (values never leak). */
  async getDashboard(repoId: string): Promise<RepoDashboard | null> {
    const res = await this.fetcher(
      `${this.baseUrl}/api/repos/${encodeURIComponent(repoId)}/dashboard`
    );
    if (!res.ok) {
      if (res.status === 404) return null;
      throw new Error(`getDashboard failed: ${res.status}`);
    }
    const body = (await res.json()) as { dashboard?: RepoDashboard };
    return body.dashboard ?? null;
  }

  /** v0.6.0 — architecture delta between two git refs of a repo. */
  async getArchitectureDelta(
    repoId: string,
    base: string,
    head: string
  ): Promise<ArchitectureDeltaReport> {
    const res = await this.fetcher(
      `${this.baseUrl}/api/repos/${encodeURIComponent(repoId)}/architecture-delta`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ base, head })
      }
    );
    if (!res.ok) {
      let detail = '';
      try {
        const body = (await res.json()) as { error?: unknown };
        if (typeof body.error === 'string' && body.error !== '') {
          detail = `: ${body.error}`;
        }
      } catch {
        // non-JSON body — fall back to the status-only message below
      }
      throw new Error(`getArchitectureDelta failed: ${res.status}${detail}`);
    }
    const body = (await res.json()) as { delta?: ArchitectureDeltaReport };
    if (!body.delta) {
      throw new Error('getArchitectureDelta failed: missing delta in response');
    }
    return body.delta;
  }

  /** Issue 11/13: AST-heuristic onboarding tours, optionally filtered by type. */
  async getTours(repoId: string, type?: string): Promise<RepoTour[]> {
    const params = type ? `?type=${encodeURIComponent(type)}` : '';
    const res = await this.fetcher(
      `${this.baseUrl}/api/repos/${encodeURIComponent(repoId)}/tours${params}`
    );
    if (!res.ok) throw new Error(`getTours failed: ${res.status}`);
    const body = (await res.json()) as { tours?: RepoTour[] };
    return body.tours ?? [];
  }

  /** Issue 28: deterministic Graph RAG agent context for a start symbol. */
  async getSubgraphContext(
    repoId: string,
    query: string,
    maxTokens?: number
  ): Promise<SubgraphContextResult> {
    const params = new URLSearchParams({ query });
    if (maxTokens !== undefined) params.set('maxTokens', String(maxTokens));
    const res = await this.fetcher(
      `${this.baseUrl}/api/repos/${encodeURIComponent(repoId)}/subgraph-context?${params.toString()}`
    );
    if (!res.ok) throw new Error(`getSubgraphContext failed: ${res.status}`);
    const body = (await res.json()) as { context?: SubgraphContextResult };
    if (!body.context) throw new Error('getSubgraphContext failed: missing context in response');
    return body.context;
  }

  /** Issue 14: fetch the ONBOARDING.md handover document as plain text. */
  async exportOnboarding(repoId: string): Promise<string> {
    const res = await this.fetcher(
      `${this.baseUrl}/api/repos/${encodeURIComponent(repoId)}/export/onboarding`
    );
    if (!res.ok) throw new Error(`exportOnboarding failed: ${res.status}`);
    return await res.text();
  }

  /**
   * Open an SSE query stream. Returns an AsyncIterable of parsed QueryEvents.
   * The caller drives consumption; EventSource cleanup happens on loop exit.
   * `start` is the explicit trace start (Top API click): the exact symbol
   * name + file, sent as startName/startFile so the backend resolves the
   * call-chain start unambiguously.
   */
  queryRepo(
    repoId: string,
    question: string,
    mode?: QueryMode,
    start?: QueryStart
  ): QueryStreamLike {
    return new QueryStream(this.baseUrl, repoId, question, mode, start);
  }
}

type StreamListener = (event: QueryEvent) => void;
type StreamErrorListener = (err: unknown) => void;
type StreamDoneListener = () => void;

/** Connection-level stream errors (distinct from backend `error` QueryEvents). */
export type StreamError =
  | { kind: 'transient'; attempt: number; maxAttempts: number }
  | { kind: 'permanent'; cause: Error };

/** Minimal surface useChat/tests depend on; QueryStream satisfies it. */
export interface QueryStreamLike {
  onEvent(fn: (event: QueryEvent) => void): () => void;
  onError(fn: (err: unknown) => void): () => void;
  onDone(fn: () => void): () => void;
  connect(): void;
  close(): void;
}

/** Thin EventSource wrapper exposing an AsyncIterable of QueryEvents. */
export class QueryStream implements QueryStreamLike {
  private source: EventSource | null = null;
  private listeners = new Set<StreamListener>();
  private errorListeners = new Set<StreamErrorListener>();
  private doneListeners = new Set<StreamDoneListener>();
  private finished = false;
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly baseUrl: string,
    private readonly repoId: string,
    private readonly question: string,
    private readonly mode?: QueryMode,
    /** Explicit trace start (Top API click), sent as startName/startFile. */
    private readonly start?: QueryStart,
    /** Ticket 07: backoff base for auto-reconnect (tests inject a tiny value). */
    private readonly reconnectBaseMs = 500,
    /** Ticket 07: at most this many automatic reopen attempts before giving up. */
    private readonly maxReconnectAttempts = 3
  ) {
    // Intentionally not opened until consume() is called.
  }

  private open(): EventSource {
    const params = new URLSearchParams({ question: this.question });
    if (this.mode) params.set('mode', this.mode);
    if (this.start?.name && this.start.file) {
      params.set('startName', this.start.name);
      params.set('startFile', this.start.file);
    }
    const url = `${this.baseUrl}/api/repos/${encodeURIComponent(this.repoId)}/query?${params}`;
    const source = new EventSource(url);
    // Backend event names carry the `repoqa.query.` namespace prefix; the
    // frontend must listen to the full names (bare names never fire).
    source.addEventListener('repoqa.query.token', (e) =>
      this.emit({ type: 'token', text: this.payloadString(e, 'token') })
    );
    source.addEventListener('repoqa.query.mermaid', (e) =>
      this.emit({ type: 'mermaid', code: this.payloadString(e, 'mermaid') })
    );
    source.addEventListener('repoqa.query.anchors', (e) =>
      this.emit({ type: 'anchors', anchors: this.parseAnchors(e) })
    );
    source.addEventListener('repoqa.query.done', (e) => {
      this.emitDone(e);
      // Backend ends the response after done; close before EventSource's own
      // auto-reconnect turns EOF into a spurious retry of the finished query.
      this.safeClose(source);
    });
    source.addEventListener('repoqa.query.error', (e) => {
      try {
        const payload = JSON.parse(this.data(e)) as { error?: string };
        this.emit({ type: 'error', error: payload.error ?? 'query failed' });
      } catch {
        this.emit({ type: 'error', error: this.data(e) });
      }
      this.finish();
      this.safeClose(source);
    });
    source.onerror = () => this.handleError(source);
    return source;
  }

  /** Ticket 07: own the retry loop; suppress EventSource's silent retry. */
  private handleError(source: EventSource) {
    if (this.finished) return;
    this.safeClose(source);
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      this.errorListeners.forEach((fn) =>
        fn({ kind: 'permanent', cause: new Error('SSE reconnect budget exhausted') })
      );
      this.finish();
      return;
    }
    this.reconnectAttempts++;
    const attempt = this.reconnectAttempts;
    this.errorListeners.forEach((fn) =>
      fn({ kind: 'transient', attempt, maxAttempts: this.maxReconnectAttempts })
    );
    const delay = this.reconnectBaseMs * 2 ** (attempt - 1);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.finished) return;
      this.source = this.open();
    }, delay);
  }

  private safeClose(source: EventSource) {
    if (this.source === source) this.source = null;
    source.close();
  }

  private data(e: MessageEvent): string {
    return typeof e.data === 'string' ? e.data : JSON.stringify(e.data);
  }

  /**
   * Every SSE frame carries `JSON.stringify(payload)` (for example a token
   * frame is `{"token":"..."}`); extract the named field, or fall back to the
   * raw data for non-JSON frames.
   */
  private payloadString(e: MessageEvent, key: string): string {
    try {
      const payload = JSON.parse(this.data(e)) as Record<string, unknown>;
      return typeof payload[key] === 'string' ? (payload[key] as string) : '';
    } catch {
      return this.data(e);
    }
  }

  private parseAnchors(e: MessageEvent): Anchor[] {
    try {
      const payload = JSON.parse(this.data(e)) as { anchors?: Anchor[] };
      return Array.isArray(payload.anchors) ? payload.anchors : [];
    } catch {
      return [];
    }
  }

  /** done 事件携带后端 payload（answer/mermaid/anchors/suggestedAction/trace）。 */
  private emitDone(e: MessageEvent) {
    try {
      const payload = JSON.parse(this.data(e)) as Record<string, unknown>;
      this.emit({ type: 'done', payload });
    } catch {
      this.emit({ type: 'done' });
    } finally {
      this.finish();
    }
  }

  private emit(event: QueryEvent) {
    this.listeners.forEach((fn) => fn(event));
  }

  private finish() {
    if (this.finished) return;
    this.finished = true;
    this.doneListeners.forEach((fn) => fn());
  }

  onEvent(fn: StreamListener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  onError(fn: StreamErrorListener): () => void {
    this.errorListeners.add(fn);
    return () => this.errorListeners.delete(fn);
  }

  onDone(fn: StreamDoneListener): () => void {
    this.doneListeners.add(fn);
    return () => this.doneListeners.delete(fn);
  }

  /** Open the SSE connection; call close() to abort. */
  connect(): void {
    if (this.source) return;
    this.source = this.open();
  }

  close(): void {
    this.finished = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (!this.source) return;
    this.source.close();
    this.source = null;
  }
}

/**
 * Resolve the API base URL. Defaults to same-origin (`''`) so the production
 * build works on any port in single-process mode; the dev server (different
 * origin) pins the API via VITE_REPOQA_API_BASE in apps/repoqa-web/.env.development.
 */
export function resolveBaseUrl(env: Record<string, string | undefined> = import.meta.env ?? {}): string {
  return (env.VITE_REPOQA_API_BASE ?? '').replace(/\/$/, '');
}
