/**
 * v0.27-B R2 — 传输层韧性：fetch 超时。
 *
 * 背景（评估差距 1-缺①）：RepoQAClient 从不传 signal——后端挂起（半死进程、
 * 卡住的 git/LLM 流）时前端永转圈，用户只能 F5。本模块给 fetch 加「响应头
 * 预算」：超时仅约束到**首字节到达**——流式端点在拿到响应头后由服务端续推，
 * body 再慢也不被误杀。
 *
 * 预算分层（R2 review P1 修正）：默认 15s 只保护「后端挂起」而不是「计算很
 * 慢」——gate/delta/subgraph 是同步重计算（误杀会造成前端报错、服务端已落库
 * 的假失败脑裂），dialog/folder 是人速端点（服务端预算 60s），importRepo 同
 * 步等整仓索引。
 * 已知缺口（票 Comments 记录）：evolve SSE（EvolveStream）走全局 fetch 不在
 * 此预算内；queryRepo 用 EventSource，自有重连语义。
 */

export const DEFAULT_FETCH_TIMEOUT_MS = 15_000;
/** 大仓全量索引（POST /api/repos 同步等 index）——放宽到 10 分钟。 */
export const IMPORT_FETCH_TIMEOUT_MS = 600_000;
/** 同步重计算（analyzeDiff×2、subgraph 图抽取）——5 分钟。 */
export const SYNC_ANALYZE_TIMEOUT_MS = 300_000;
/** 原生目录选择器：人速操作（服务端预算 60s，dialog.ts），客户端再宽一倍。 */
export const DIALOG_FETCH_TIMEOUT_MS = 120_000;

export class NetworkTimeoutError extends Error {
  readonly code = 'network_timeout';
  /** R2 review P2-6：URL 存字段不上 message——渲染层拿干净文案。 */
  readonly url: string;
  constructor(url: string, ms: number) {
    super(`request timed out after ${ms}ms`);
    this.name = 'NetworkTimeoutError';
    this.url = url;
  }
}

/** RequestInit plus the R2 per-call budget override (read before delegating). */
export type TimeoutRequestInit = RequestInit & { timeoutMs?: number };

export type TimedFetch = (
  input: RequestInfo | URL,
  init?: TimeoutRequestInit
) => Promise<Response>;

export function fetchWithTimeout(
  fetchImpl: typeof fetch,
  input: RequestInfo | URL,
  init: TimeoutRequestInit = {},
  defaultMs = DEFAULT_FETCH_TIMEOUT_MS
): Promise<Response> {
  const { timeoutMs, ...rest } = init;
  const ms = timeoutMs ?? defaultMs;
  if (!Number.isFinite(ms) || ms <= 0) {
    // R2 review P2-3：Infinity（或 0/负数）= 显式不限时，不建表不建控制器。
    return fetchImpl(input, rest);
  }
  const controller = new AbortController();
  // R2 review P2-2：调用方 signal 不被静默覆盖——能合并则合并；运行环境缺
  // AbortSignal.any 时保留调用方 signal（超时 reject 本就独立于 abort）。
  const anyFn = (
    AbortSignal as unknown as { any?: (signals: AbortSignal[]) => AbortSignal }
  ).any;
  const signal = rest.signal
    ? anyFn
      ? anyFn([controller.signal, rest.signal])
      : rest.signal
    : controller.signal;
  // Self-contained rejection: the timeout wins even against a fetch() that
  // never settles (a wedged keep-alive socket never rejects on abort). We
  // still abort the signal so the transport itself is released, but the
  // caller never waits longer than the budget.
  return new Promise<Response>((resolve, reject) => {
    const timer = setTimeout(() => {
      controller.abort();
      reject(new NetworkTimeoutError(String(input), ms));
    }, ms);
    const onOk = (res: Response) => {
      // Headers arrived — the server owns the rest of the stream now.
      clearTimeout(timer);
      resolve(res);
    };
    const onErr = (err: unknown) => {
      clearTimeout(timer);
      if (controller.signal.aborted) {
        reject(new NetworkTimeoutError(String(input), ms));
      } else {
        reject(err);
      }
    };
    try {
      fetchImpl(input, { ...rest, signal }).then(onOk, onErr);
    } catch (err) {
      // R2 review P2-4：同步 throw（DI mock/非法参数）也要清表。
      clearTimeout(timer);
      reject(err);
    }
  });
}
