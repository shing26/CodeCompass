/**
 * v0.27-B R7 — 本地假 LLM endpoint（OpenAI-compatible SSE）。
 * Release 冒烟门专用：零外网、零 token、零真实凭据（key 只是占位串，
 * stub 不校验 authorization）。返回 { server, url, port, close() }。
 * 应答内容含 SMOKE-STUB-ANSWER 哨兵（可带 \n\n 双段——顺带钉 SSE 分帧解析），
 * 从不发 tool_calls：冒烟测的是「流式到达并渲染」，不是 ReAct 编排。
 */
import http from 'node:http';

export const STUB_SENTINEL = 'SMOKE-STUB-ANSWER';

export function startStubLlm() {
  const chunks = [
    `SMOKE-STUB-`,
    `ANSWER: 这是一段来自本地 stub 的冒烟回答。\n\n第二段落——用于钉住 SSE 跨帧重组。`
  ];
  const server = http.createServer((req, res) => {
    // R7 review P2-8：只服务该端点，404 一切其他路径——把「冒烟专用」钉进行为。
    if (req.method !== 'POST' || !req.url?.endsWith('/v1/chat/completions')) {
      res.writeHead(404).end();
      return;
    }
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', async () => {
      res.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        connection: 'keep-alive'
      });
      const send = (obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`);
      send({ choices: [{ index: 0, delta: { role: 'assistant' } }] });
      for (const text of chunks) {
        // 300ms ≫ 服务端 40ms 批帧窗（R2-02）——浏览器侧必见 ≥2 个 delta 帧，
        // 让「流式渲染 vs done 兜底」可被两段式观测区分（R7 review P2-1）。
        await new Promise((r) => setTimeout(r, 300));
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
        url: `http://127.0.0.1:${port}/v1/chat/completions`,
        close: () => new Promise((r) => server.close(() => r()))
      });
    });
  });
}
