/**
 * v0.27-B R7 — 本地假 LLM endpoint（OpenAI-compatible SSE）。
 * Release 冒烟门专用：零外网、零 token、零真实凭据（key 只是占位串，
 * stub 不校验 authorization）。返回 { server, url, port, close() }。
 * 应答内容含 SMOKE-STUB-ANSWER 哨兵（可带 \n\n 双段——顺带钉 SSE 分帧解析）。
 *
 * v1.8 票 01 — 新增 scripted 模式（只增，默认行为逐字节不变）：
 *   options.delayMs            每个 content delta 前的延迟（默认 300ms）
 *   options.firstTokenDelayMs  首个 content delta 前的额外延迟（默认 0；慢模型探针用）
 *   options.script             'text' | 'tool-then-text'（默认 'text'）
 *   options.toolName / toolArguments   script 模式第一次请求回的 tool_call
 *   env 兜底：STUB_LLM_DELAY_MS / STUB_LLM_FIRST_TOKEN_DELAY_MS / STUB_LLM_SCRIPT /
 *             STUB_LLM_TOOL_NAME / STUB_LLM_TOOL_ARGUMENTS
 * 注意：默认仍「从不发 tool_calls」——冒烟测的是流式到达并渲染，不是 ReAct 编排；
 * script 模式只给探针/e2e 用，必须显式开启。
 */
import http from 'node:http';

export const STUB_SENTINEL = 'SMOKE-STUB-ANSWER';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function makeLongAnswer(totalChars) {
  const unit = 'SMOKE-STUB-ANSWER: 确定性证据链片段（本段用于模拟真实长度答案，不参与语义断言）。';
  let text = '';
  while (text.length < totalChars) text += unit;
  text = text.slice(0, totalChars);
  const parts = [];
  const size = Math.ceil(text.length / 4);
  for (let i = 0; i < text.length; i += size) parts.push(text.slice(i, i + size));
  return parts;
}

function envNumber(name) {
  const raw = Number(process.env[name]);
  return Number.isFinite(raw) && raw >= 0 ? raw : undefined;
}

export function startStubLlm(options = {}) {
  const chunks = [
    `SMOKE-STUB-`,
    `ANSWER: 这是一段来自本地 stub 的冒烟回答。\n\n第二段落——用于钉住 SSE 跨帧重组。`
  ];
  const delayMs = options.delayMs ?? envNumber('STUB_LLM_DELAY_MS') ?? 300;
  const firstTokenDelayMs = options.firstTokenDelayMs ?? envNumber('STUB_LLM_FIRST_TOKEN_DELAY_MS') ?? 0;
  const script = options.script ?? process.env.STUB_LLM_SCRIPT ?? 'text';
  const toolName = options.toolName ?? process.env.STUB_LLM_TOOL_NAME ?? 'codecompass_get_dashboard';
  const toolArguments = options.toolArguments ?? process.env.STUB_LLM_TOOL_ARGUMENTS ?? '{}';
  // v1.8 — 可造一个「接近真实长度」的答案（wire 开销占比用）；默认 0 = 旧行为。
  const answerChars = options.answerChars ?? envNumber('STUB_LLM_ANSWER_CHARS') ?? 0;
  let calls = 0;

  const server = http.createServer((req, res) => {
    // R7 review P2-8：只服务该端点，404 一切其他路径——把「冒烟专用」钉进行为。
    if (req.method !== 'POST' || !req.url?.endsWith('/v1/chat/completions')) {
      res.writeHead(404).end();
      return;
    }
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', async () => {
      calls += 1;
      res.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        connection: 'keep-alive'
      });
      const send = (obj) => res.write('data: ' + JSON.stringify(obj) + '\n\n');
      send({ choices: [{ index: 0, delta: { role: 'assistant' } }] });

      // scripted 工具回合：第一次请求回一个 tool_call，后续请求回文本。
      if (script === 'tool-then-text' && calls === 1) {
        await sleep(delayMs);
        send({
          choices: [{
            index: 0,
            delta: {
              tool_calls: [{
                index: 0,
                id: 'call_stub_1',
                type: 'function',
                function: { name: toolName, arguments: toolArguments }
              }]
            },
            finish_reason: null
          }]
        });
        send({ choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] });
        res.end('data: [DONE]\n\n');
        void body;
        return;
      }

      if (firstTokenDelayMs > 0) await sleep(firstTokenDelayMs);
      const parts = answerChars > 0 ? makeLongAnswer(answerChars) : chunks;
      for (const text of parts) {
        // 300ms ≫ 服务端 40ms 批帧窗（R2-02）——浏览器侧必见 ≥2 个 delta 帧，
        // 让「流式渲染 vs done 兜底」可被两段式观测区分（R7 review P2-1）。
        await sleep(delayMs);
        send({ choices: [{ index: 0, delta: { content: text } }] });
      }
      send({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] });
      res.end('data: [DONE]\n\n');
      void body;
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      resolve({
        server,
        port,
        url: 'http://127.0.0.1:' + port + '/v1/chat/completions',
        close: () => new Promise((r) => server.close(() => r()))
      });
    });
  });
}
