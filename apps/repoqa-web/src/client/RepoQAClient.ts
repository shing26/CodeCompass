import type {
  Anchor,
  ArchitectureDeltaReport,
  DomainRadarResult,
  EvolveEvent,
  GateRunPolicyOptions,
  GateRunRow,
  ImportRepoInput,
  QueryEvent,
  QueryMode,
  QueryStart,
  Repo,
  RepoDashboard,
  RepoPreview,
  RepoSymbol,
  RepoTour,
  ReverseDepsResult,
  RuntimeInfo,
  SubgraphContextResult,
  SymbolKind,
  WorkbenchCardRow
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
  /** chat-merge (v0.24.0): 对话式智能体子客户端 */
  readonly chat: ChatMergeClient;

  constructor(baseUrl: string, fetcher: typeof fetch = fetch) {
    this.baseUrl = baseUrl;
    // Wrap fetch in a closure: calling it as `this.fetcher(...)` binds `this`
    // to this class instance, which browsers reject ("Illegal invocation" —
    // fetch expects the Window as receiver). The closure keeps the real
    // function's receiver scope so `await this.fetcher(url)` is safe.
    this.fetcher = (...args) => fetcher(...args);
    // chat-merge: 对话式智能体子客户端（编排层在 control-plane src/chat/）
    this.chat = new ChatMergeClient(baseUrl, this.fetcher);
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
  async cloneRepo(url: string, branch?: string): Promise<Repo> {    const res = await this.fetcher(`${this.baseUrl}/api/repos/clone`, {
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

  /** v0.25.0 批次 1（#08 域迁移）：原生目录选择器——Windows 拉起系统对话框回传
   * 绝对路径；非 Windows 返回 supported:false，前端降级手输。方法归仓库导入域（与
   * previewRepo/cloneRepo 同层），契约与端点 GET /api/dialog/folder 不变。 */
  async pickFolder(): Promise<{ supported: boolean; canceled?: boolean; path?: string }> {
    const res = await this.fetcher(`${this.baseUrl}/api/dialog/folder`);
    return (await res.json()) as { supported: boolean; canceled?: boolean; path?: string };
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

  /**
   * v0.6 closeout: static reverse dependencies ("who calls this symbol"),
   * HTTP twin of the MCP `codecompass_reverse_deps` tool. The backend answers
   * 400 with `{ error }` when the symbol cannot be resolved at all.
   */
  async listReverseDeps(repoId: string, symbolName: string): Promise<ReverseDepsResult> {
    const params = `?symbolName=${encodeURIComponent(symbolName)}`;
    const res = await this.fetcher(
      `${this.baseUrl}/api/repos/${encodeURIComponent(repoId)}/reverse-deps${params}`
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
      throw new Error(`listReverseDeps failed: ${res.status}${detail}`);
    }
    return (await res.json()) as ReverseDepsResult;
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

  /**
   * Issue 25 / Ticket 03 — hydrate replay of one (repoId, commit) artifact
   * stream in delivery order. No commit param = the repo's current physical
   * stream (the backend resolves repo.commit ?? 'unversioned'). 404 (unknown
   * repo) answers null like getDashboard; the hook treats it as an empty
   * replay and keeps its in-memory bucket.
   */
  async getWorkbenchCards(repoId: string, commit?: string): Promise<WorkbenchCardRow[] | null> {
    const params = commit ? `?commit=${encodeURIComponent(commit)}` : '';
    const res = await this.fetcher(
      `${this.baseUrl}/api/repos/${encodeURIComponent(repoId)}/workbench-cards${params}`
    );
    if (!res.ok) {
      if (res.status === 404) return null;
      throw new Error(`getWorkbenchCards failed: ${res.status}`);
    }
    const body = (await res.json()) as { cards?: WorkbenchCardRow[] };
    return body.cards ?? [];
  }

  /** v0.11 — Cmd+K symbol radar: deterministic domain-radar anchors. */
  async radar(repoId: string, query: string): Promise<DomainRadarResult> {
    const res = await this.fetcher(
      `${this.baseUrl}/api/repos/${encodeURIComponent(repoId)}/radar?query=${encodeURIComponent(query)}`
    );
    if (!res.ok) {
      throw new Error(`radar failed: ${res.status}`);
    }
    const body = (await res.json()) as { radar?: DomainRadarResult };
    if (!body.radar) throw new Error('radar failed: missing radar in response');
    return body.radar;
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
      let message = `getArchitectureDelta failed: ${res.status}`;
      let rawDetail: string | undefined;
      try {
        const body = (await res.json()) as { error?: unknown; detail?: unknown };
        if (typeof body.error === 'string' && body.error !== '') {
          // R3-Bug-02 — the backend already reduced the git failure to one
          // line; the raw git output rides along as `detail`.
          message = body.error;
        }
        if (typeof body.detail === 'string' && body.detail !== '') {
          rawDetail = body.detail;
        }
      } catch {
        // non-JSON body — keep the status-only message
      }
      const err = new Error(message) as Error & { detail?: string };
      if (rawDetail !== undefined) err.detail = rawDetail;
      throw err;
    }
    const body = (await res.json()) as { delta?: ArchitectureDeltaReport };
    if (!body.delta) {
      throw new Error('getArchitectureDelta failed: missing delta in response');
    }
    return body.delta;
  }

  /** v0.26-B ticket 01 — 服务器端门禁：跑 analyzeDiff + evaluateDiffPolicy 并
   * 落库（ADR-0017「门禁运行史」数据面）。成功 201 回显落库行；git/引擎失败走
   * 票 14 契约 400 `{error: 人话首行, detail: 原始输出}`——错误面与
   * getArchitectureDelta 同构，UI 可复用折叠 detail。 */
  async runGate(
    repoId: string,
    base: string,
    head: string,
    options?: GateRunPolicyOptions
  ): Promise<GateRunRow> {
    const res = await this.fetcher(`${this.baseUrl}/api/repos/${encodeURIComponent(repoId)}/gate/run`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ base, head, ...(options ?? {}) })
    });
    if (!res.ok) {
      let message = `runGate failed: ${res.status}`;
      let rawDetail: string | undefined;
      try {
        const body = (await res.json()) as { error?: unknown; detail?: unknown };
        if (typeof body.error === 'string' && body.error !== '') {
          message = body.error;
        }
        if (typeof body.detail === 'string' && body.detail !== '') {
          rawDetail = body.detail;
        }
      } catch {
        // non-JSON body — keep the status-only message
      }
      const err = new Error(message) as Error & { detail?: string };
      if (rawDetail !== undefined) err.detail = rawDetail;
      throw err;
    }
    const body = (await res.json()) as { run?: GateRunRow | null };
    if (!body.run) throw new Error('runGate failed: missing run in response');
    return body.run;
  }

  /** v0.26-B ticket 01 — newest-first 回放（`{runs, total}` 契约照抄 /api/events
   * 先例；非法分页参数服务端容错）。commit 参数切物理流（hash/hash+dirty/unversioned）。 */
  async listGateRuns(
    repoId: string,
    params?: { limit?: number; offset?: number; commit?: string }
  ): Promise<{ runs: GateRunRow[]; total: number }> {
    const search = new URLSearchParams();
    if (params?.limit !== undefined) search.set('limit', String(params.limit));
    if (params?.offset !== undefined) search.set('offset', String(params.offset));
    if (params?.commit) search.set('commit', params.commit);
    const qs = search.toString();
    const res = await this.fetcher(
      `${this.baseUrl}/api/repos/${encodeURIComponent(repoId)}/gate-runs${qs ? `?${qs}` : ''}`
    );
    if (!res.ok) throw new Error(`listGateRuns failed: ${res.status}`);
    const body = (await res.json()) as { runs?: GateRunRow[]; total?: number };
    return { runs: body.runs ?? [], total: body.total ?? 0 };
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
   * `stack` (Issue 23) is the pasted stack trace for incident mode, sent as
   * `stack` and forwarded by the backend into the deterministic stack parser.
   */
  /**
   * Issue 24 / Ticket 04 — open the evolution workbench stream.
   *
   * The evolve endpoint is POST + JSON body, which the browser EventSource
   * cannot issue; the stream is therefore consumed via fetch + ReadableStream
   * with the same SSE framing the query stream uses. Emits parsed
   * EvolveEvents;  fires after the stream closes (done or error).
   */
  evolveStream(repoId: string, intent: string, target?: string): EvolveStreamLike {
    return new EvolveStream(this.baseUrl, repoId, intent, target);
  }

  queryRepo(
    repoId: string,
    question: string,
    mode?: QueryMode,
    start?: QueryStart,
    stack?: string
  ): QueryStreamLike {
    return new QueryStream(this.baseUrl, repoId, question, mode, start, stack);
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
    /** Issue 23 — pasted stack trace for incident mode, sent as `stack`. */
    private readonly stack?: string,
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
    if (this.stack) params.set('stack', this.stack);
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
        // Issue 25 / Ticket 03 — the error payload carries the persisted
        // card id/seq; forward both so the hook can adopt the server id.
        const payload = JSON.parse(this.data(e)) as {
          error?: string;
          cardId?: string;
          cardSeq?: number;
        };
        this.emit({
          type: 'error',
          error: payload.error ?? 'query failed',
          ...(payload.cardId !== undefined ? { cardId: payload.cardId } : {}),
          ...(payload.cardSeq !== undefined ? { cardSeq: payload.cardSeq } : {})
        });
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

type EvolveListener = (event: EvolveEvent) => void;

/** Minimal surface EvolutionView consumes; EvolveStream satisfies it. */
export interface EvolveStreamLike {
  onEvent(fn: (event: EvolveEvent) => void): () => void;
  onError(fn: (err: unknown) => void): () => void;
  onDone(fn: () => void): () => void;
  /** POST the intent and start consuming the SSE frames. */
  connect(): void;
  close(): void;
}

/**
 * Ticket 04 — POST /api/repos/:id/evolve SSE consumer over fetch.
 *
 * Frames arrive as `event: <name>` + `data: <json>`, separated by blank lines;
 * blank lines and maps the three evolve event names to EvolveEvent. No
 * auto-reconnect: an evolve run is a one-shot server-side computation, and a
 * reconnect would re-run the pipeline.
 */
export class EvolveStream implements EvolveStreamLike {
  private listeners = new Set<EvolveListener>();
  private errorListeners = new Set<(err: unknown) => void>();
  private doneListeners = new Set<() => void>();
  private controller: AbortController | null = null;
  private finished = false;

  constructor(
    private readonly baseUrl: string,
    private readonly repoId: string,
    private readonly intent: string,
    private readonly target?: string
  ) {}

  private emit(event: EvolveEvent) {
    this.listeners.forEach((fn) => fn(event));
  }

  private finish() {
    if (this.finished) return;
    this.finished = true;
    this.doneListeners.forEach((fn) => fn());
  }

  async connect(): Promise<void> {
    if (this.controller) return;
    this.controller = new AbortController();
    try {
      const res = await this.fetcher();
      if (!res.ok || !res.body) {
        let detail = '';
        try {
          const body = (await res.json()) as { error?: unknown };
          if (typeof body.error === 'string') detail = `: ${body.error}`;
        } catch {
          // non-JSON body — status only
        }
        throw new Error(`evolveStream failed: ${res.status}${detail}`);
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        // Frames are separated by a blank line; CRLF is defensive.
        const frames = buffer.split(/\r?\n\r?\n/);
        buffer = frames.pop() ?? '';
        for (const frame of frames) this.consumeFrame(frame);
      }
      const rest = buffer.trim();
      if (rest) this.consumeFrame(rest);
    } catch (err) {
      if (!this.finished) {
        this.errorListeners.forEach((fn) => fn(err));
      }
    } finally {
      this.finish();
    }
  }

  private fetcher(): Promise<Response> {
    return fetch(`${this.baseUrl}/api/repos/${encodeURIComponent(this.repoId)}/evolve`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        intent: this.intent,
        ...(this.target ? { target: this.target } : {})
      }),
      signal: this.controller?.signal
    });
  }

  private consumeFrame(frame: string) {
    let event = 'message';
    const dataLines: string[] = [];
    for (const line of frame.split(/\r?\n/)) {
      if (line.startsWith('event:')) event = line.slice(6).trim();
      else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
    }
    if (dataLines.length === 0) return;
    let payload: Record<string, unknown> = {};
    try {
      payload = JSON.parse(dataLines.join('\n')) as Record<string, unknown>;
    } catch {
      return;
    }
    if (event === 'repoqa.evolve.stage' && payload.stage) {
      this.emit({ type: 'stage', payload: payload as unknown as EvolveEvent extends { type: 'stage'; payload: infer P } ? P : never });
    } else if (event === 'repoqa.evolve.done') {
      this.emit({ type: 'done', payload: payload as never });
    } else if (event === 'repoqa.evolve.error') {
      this.emit({ type: 'error', payload: payload as never });
    }
  }

  onEvent(fn: EvolveListener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  onError(fn: (err: unknown) => void): () => void {
    this.errorListeners.add(fn);
    return () => this.errorListeners.delete(fn);
  }

  onDone(fn: () => void): () => void {
    this.doneListeners.add(fn);
    return () => this.doneListeners.delete(fn);
  }

  close(): void {
    this.finished = true;
    this.controller?.abort();
    this.controller = null;
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

// ---------------------------------------------------------------------------
// chat-merge (v0.24.0): 对话式智能体（编排层在 control-plane src/chat/）
// ---------------------------------------------------------------------------

export interface ChatSessionInfo {
  id: string;
  repoId: string;
  title: string;
  createdAt: string;
}

export interface ChatMessageInfo {
  id: number;
  sessionId: string;
  role: 'user' | 'assistant';
  content: string;
  citations: string | null;
}

export interface ChatCitation {
  n: number;
  tool: string;
  args: Record<string, unknown>;
  ms: number;
}

/** CM-04 卡片化 v2：DEPRECATE 拆除清单结构化卡片（引擎载荷直供，非模型散文）。 */
export interface ChatPlanItem {
  category: string;
  action: string;
  filePath: string;
  description: string;
}

export interface ChatPlanCard {
  intentType: string;
  target: string;
  riskLevel?: string;
  items: ChatPlanItem[];
}

export interface ChatTurnResult {
  answer: string;
  citations: ChatCitation[];
  planCards?: ChatPlanCard[];
  steps: number;
  fallback: boolean;
}

export interface ChatSendHandlers {
  onDelta: (text: string) => void;
  onRegenerate?: () => void;
  onPlan?: (cards: ChatPlanCard[]) => void;
}

export class ChatMergeClient {
  constructor(private readonly baseUrl: string, private readonly fetcher: typeof fetch = fetch) {}

  async listSessions(): Promise<ChatSessionInfo[]> {
    const res = await this.fetcher(`${this.baseUrl}/api/chat/sessions`);
    const body = (await res.json()) as { sessions?: ChatSessionInfo[] };
    return body.sessions ?? [];
  }

  async createSession(repoId: string): Promise<ChatSessionInfo> {
    const res = await this.fetcher(`${this.baseUrl}/api/chat/sessions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ repoId })
    });
    const body = (await res.json()) as { session?: ChatSessionInfo; error?: string };
    if (!res.ok || !body.session) throw new Error(body.error ?? `HTTP ${res.status}`);
    return body.session;
  }

  async messages(sessionId: string): Promise<ChatMessageInfo[]> {
    const res = await this.fetcher(
      `${this.baseUrl}/api/chat/sessions/${encodeURIComponent(sessionId)}/messages`
    );
    const body = (await res.json()) as { messages?: ChatMessageInfo[] };
    return body.messages ?? [];
  }

  async switchModel(name: string): Promise<void> {
    const res = await this.fetcher(`${this.baseUrl}/api/chat/model`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name })
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(body.error ?? `HTTP ${res.status}`);
    }
  }

  async modelInfo(): Promise<{ profiles: string[]; active: string; configured: boolean }> {
    const res = await this.fetcher(`${this.baseUrl}/api/chat/model`);
    return (await res.json()) as { profiles: string[]; active: string; configured: boolean };
  }

  /**
   * SSE chat stream (POST — EventSource cannot send a body; same fetch+
   * ReadableStream pattern as the evolve stream). Resolves with the sanitized
   * final turn from the `done` event.
   */
  async chatSend(
    sessionId: string,
    message: string,
    handlers: ChatSendHandlers
  ): Promise<ChatTurnResult> {
    const res = await this.fetcher(
      `${this.baseUrl}/api/chat/sessions/${encodeURIComponent(sessionId)}/messages`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ message })
      }
    );
    if (!res.ok || !res.body) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(body.error ?? `HTTP ${res.status}`);
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let done: ChatTurnResult = { answer: '', citations: [], steps: 0, fallback: false };
    for (;;) {
      const { value, done: streamDone } = await reader.read();
      if (streamDone) break;
      buffer += decoder.decode(value, { stream: true });
      let sep: number;
      while ((sep = buffer.indexOf('\n\n')) >= 0) {
        const frame = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);
        let event = 'message';
        const dataLines: string[] = [];
        for (const line of frame.split(/\r?\n/)) {
          if (line.startsWith('event:')) event = line.slice(6).trim();
          else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
        }
        if (dataLines.length === 0) continue;
        let payload: Record<string, unknown>;
        try {
          payload = JSON.parse(dataLines.join('\n')) as Record<string, unknown>;
        } catch {
          continue;
        }
        if (event === 'delta' && payload.text !== undefined) {
          handlers.onDelta(String(payload.text));
        } else if (event === 'regenerate' && handlers.onRegenerate) {
          handlers.onRegenerate();
        } else if (event === 'plan' && handlers.onPlan) {
          handlers.onPlan((payload.planCards as ChatPlanCard[]) ?? []);
        } else if (event === 'done') {
          done = {
            answer: String(payload.answer ?? ''),
            citations: (payload.citations as ChatCitation[]) ?? [],
            planCards: (payload.planCards as ChatPlanCard[]) ?? [],
            steps: Number(payload.steps ?? 0),
            fallback: Boolean(payload.fallback)
          };
        }
      }
    }
    return done;
  }
}
