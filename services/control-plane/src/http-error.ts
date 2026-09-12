import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { maskSensitiveText } from './repoqa-masking';

/**
 * v0.27-B R1 — HTTP 错误底线。
 *
 * Express 4 不会自动捕获 async handler 的 rejection（请求直接悬挂），同步
 * throw 则落到默认 HTML 错误页（堆栈出库）。本模块补三件套：
 *  - `asyncHandler`：把 rejection 转交 `next(err)`；
 *  - `requestIdMiddleware`：每请求一个 id，响应头 `x-mhw-request-id`，
 *    供前端/日志关联（R5 的 sink 以同一 id 落行）；
 *  - `errorMiddleware`：终端兜底——未捕获错误一律 JSON 500
 *    `{error:'internal server error', code:'internal_error'}`，真实 message
 *    与堆栈只进服务端日志，永不上线（凭据红线：日志也不写 header/body，
 *    错误 message 可能内嵌连接串，同样不外发）。
 * 已发头（SSE/流式写半途炸）交给 Express 默认处理（销毁 socket），不双写。
 */

let requestSeq = 0;

/** 单调递增请求序号 + 进程启动时间戳，够本机单进程关联用（非安全 id）。 */
export function nextRequestId(): string {
  requestSeq += 1;
  return `req-${requestSeq.toString(36)}-${Date.now().toString(36)}`;
}

export function requestIdMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const requestId = nextRequestId();
  res.locals.requestId = requestId;
  res.setHeader('x-mhw-request-id', requestId);
  next();
}

type AsyncRequestHandler = (
  req: Request,
  res: Response,
  next: NextFunction
) => Promise<unknown>;

/** Express 4 没有 async 错误传播——不包这层，rejection = 悬挂请求。 */
export function asyncHandler(fn: AsyncRequestHandler): RequestHandler {
  return (req, res, next) => {
    fn(req, res, next).catch(next);
  };
}

/**
 * 服务端结构化错误行（stderr JSONL，R5 后迁文件 sink）。
 * 只写 message 与裁剪后的栈顶；不写请求头/请求体（凭据红线）。
 * message/stack 出库前过 maskSensitiveText——错误文本可能内嵌 DSN/Token
 * （pg、LLM provider 报错实测如此），SSE 出站掩码的同一把尺子量日志面。
 */
function logServerError(req: Request, res: Response, err: unknown): void {
  const e = err instanceof Error ? err : new Error(String(err));
  const line = {
    ts: new Date().toISOString(),
    level: 'error',
    scope: 'http',
    requestId: res.locals.requestId as string | undefined,
    method: req.method,
    path: req.path,
    error: maskSensitiveText(e.message),
    stack: e.stack
      ? maskSensitiveText(e.stack.split('\n').slice(0, 6).join('\n'))
      : undefined
  };
  process.stderr.write(JSON.stringify(line) + '\n');
}

/** 注册在 createHttpApp 最末位（static/SPA fallback 之后）的终端错误中间件。 */
export function errorMiddleware(
  err: unknown,
  req: Request,
  res: Response,
  next: NextFunction
): void {
  if (res.headersSent) {
    // 流已开（SSE/文件下载）：无法再改状态码，交 Express 默认销毁连接。
    next(err);
    return;
  }
  // body-parser 家族（entity.too.large 413、encoding.unsupported 415…）带
  // http-errors 的 status——4xx 是调用方错，不能一律压成 500 误导重试语义。
  const status =
    typeof (err as { status?: unknown })?.status === 'number' &&
    (err as { status: number }).status >= 400 &&
    (err as { status: number }).status < 500
      ? (err as { status: number }).status
      : 500;
  logServerError(req, res, err);
  res.status(status).json({
    error: status < 500 ? 'request error' : 'internal server error',
    code: status < 500 ? 'request_error' : 'internal_error'
  });
}
