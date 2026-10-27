/**
 * v1.8 票 01 — chat 流式「静默时间线」探针（只读观测，不改产品代码）。
 *
 * 目标：量出一次 chat 轮次里 SSE 帧的真实分布——首帧延迟、首 delta 延迟、
 * 工具阶段最大静默 gap、各类事件计数。修前基线用：预期 progress/hint/heartbeat 全 0。
 *
 * 用法：
 *   node scripts/smoke/chat-progress-probe.mjs --scenario slow|tool|fast [--json]
 *   node scripts/smoke/chat-progress-probe.mjs --scenario repl   （CLI REPL 静默观测）
 *
 * 依赖：已构建的 dist/cli.js、本机 chromium 不需要；LLM 用本地 stub（零外网零 token）。
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import { startStubLlm } from './stub-llm.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const CLI = path.join(ROOT, 'services', 'control-plane', 'dist', 'cli.js');
const JAVA_CONTROLLER = 'package com.demo;\n' +
  'import org.springframework.web.bind.annotation.*;\n' +
  '@RestController\n@RequestMapping("/api/owners")\npublic class OwnerController {\n' +
  '  private final OwnerService ownerService = new OwnerService();\n' +
  '  @GetMapping\n  public String listOwners() { return ownerService.findOwners(); }\n}\n';
const JAVA_SERVICE = 'package com.demo;\nimport org.springframework.stereotype.Service;\n' +
  '@Service\npublic class OwnerService {\n' +
  '  private final OwnerRepository ownerRepository = new OwnerRepository();\n' +
  '  public String findOwners() { return ownerRepository.findAll(); }\n}\n';
const JAVA_REPOSITORY = 'package com.demo;\n' +
  'import org.apache.ibatis.annotations.Mapper;\nimport org.apache.ibatis.annotations.Select;\n' +
  '@Mapper\npublic interface OwnerRepository {\n' +
  '  @Select("SELECT * FROM owners")\n  String findAll();\n}\n';

const SCENARIOS = {
  fast: { stub: {}, label: '默认 stub（fast）' },
  slow: { stub: { delayMs: 300, firstTokenDelayMs: 20000 }, label: '慢首字 20s' },
  tool: {
    stub: { delayMs: 300, firstTokenDelayMs: 2000, script: 'tool-then-text' },
    label: '一次工具调用 + 2s 二轮模型'
  }
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const port = srv.address().port;
      srv.close(() => resolve(port));
    });
  });
}

function makeDemoRepo(dir) {
  const files = {
    'src/main/java/com/demo/OwnerController.java': JAVA_CONTROLLER,
    'src/main/java/com/demo/OwnerService.java': JAVA_SERVICE,
    'src/main/java/com/demo/OwnerRepository.java': JAVA_REPOSITORY,
    'web/package.json': JSON.stringify({ name: 'demo-web', dependencies: { axios: '^1.6.0' } }, null, 2)
  };
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content, 'utf8');
  }
}

async function getJson(url, init) {
  const res = await fetch(url, init);
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return { status: res.status, body };
}

async function waitFor(label, fn, timeoutMs) {
  const started = Date.now();
  for (;;) {
    try {
      const value = await fn();
      if (value) return value;
    } catch {
      /* retry */
    }
    if (Date.now() - started > timeoutMs) throw new Error('timeout waiting for ' + label + ' after ' + timeoutMs + 'ms');
    await sleep(250);
  }
}

function parseFrames(buffer, onFrame) {
  let rest = buffer;
  for (;;) {
    const sep = rest.indexOf('\n\n');
    if (sep < 0) return rest;
    const frame = rest.slice(0, sep);
    rest = rest.slice(sep + 2);
    let event = 'message';
    const dataLines = [];
    for (const line of frame.split(/\r?\n/)) {
      if (line.startsWith('event:')) event = line.slice(6).trim();
      else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
    }
    if (!dataLines.length) continue;
    let payload = null;
    try {
      payload = JSON.parse(dataLines.join('\n'));
    } catch {
      payload = null;
    }
    onFrame({ event, payload });
  }
}

function frameBytes(event, payload) {
  return Buffer.byteLength('event: ' + event + '\ndata: ' + JSON.stringify(payload) + '\n\n');
}

function summarize(scenario, frames, startedAt, endAt) {
  const counts = {};
  for (const f of frames) counts[f.event] = (counts[f.event] || 0) + 1;
  const firstFrameMs = frames.length ? frames[0].t - startedAt : null;
  const firstDelta = frames.find((f) => f.event === 'delta');
  const firstDeltaMs = firstDelta ? firstDelta.t - startedAt : null;
  let maxGapMs = 0;
  let maxGapWindow = null;
  let prev = { event: '(start)', t: startedAt };
  for (const f of frames) {
    const gap = f.t - prev.t;
    if (gap > maxGapMs) {
      maxGapMs = gap;
      maxGapWindow = prev.event + ' -> ' + f.event;
    }
    prev = f;
  }
  const perEventBytes = {};
  let totalBytes = 0;
  for (const f of frames) {
    totalBytes += f.bytes || 0;
    perEventBytes[f.event] = (perEventBytes[f.event] || 0) + (f.bytes || 0);
  }
  const overheadBytes = (perEventBytes.progress || 0) + (perEventBytes.hint || 0) + (perEventBytes.heartbeat || 0);
  const overheadPercent = totalBytes ? Math.round((overheadBytes / totalBytes) * 1000) / 10 : 0;
  const tailGap = endAt - prev.t;
  if (tailGap > maxGapMs) {
    maxGapMs = tailGap;
    maxGapWindow = prev.event + ' -> (stream end)';
  }
  return {
    scenario,
    counts,
    frames: frames.length,
    firstFrameMs,
    firstDeltaMs,
    maxGapMs,
    maxGapWindow,
    progress: counts.progress || 0,
    hint: counts.hint || 0,
    heartbeat: counts.heartbeat || 0,
    totalMs: endAt - startedAt,
    perEventBytes,
    overheadBytes,
    overheadPercent,
    timeline: frames.map((f) => ({
      atMs: f.t - startedAt,
      event: f.event,
      ...(f.payload && typeof f.payload === 'object' ? { payload: f.payload } : {})
    }))
  };
}

async function runHttpScenario(scenario, answerChars = 0) {
  const cfg = SCENARIOS[scenario];
  if (!cfg) throw new Error('unknown scenario: ' + scenario);
  const root = path.join(os.tmpdir(), 'cc-chat-progress', scenario);
  fs.rmSync(root, { recursive: true, force: true });
  const repoDir = path.join(root, 'demo');
  const dataDir = path.join(root, 'data');
  fs.mkdirSync(repoDir, { recursive: true });
  fs.mkdirSync(dataDir, { recursive: true });
  makeDemoRepo(repoDir);

  const stub = await startStubLlm({ ...cfg.stub, ...(answerChars > 0 ? { answerChars } : {}) });
  const port = await freePort();
  const baseUrl = 'http://127.0.0.1:' + port;
  const child = spawn(process.execPath, [CLI, repoDir, '--port', String(port), '--no-browser', '--data-dir', dataDir], {
    cwd: ROOT,
    env: {
      ...process.env,
      REPOQA_LLM_URL: stub.url,
      REPOQA_LLM_MODEL: 'stub-model',
      REPOQA_LLM_API_KEY: 'stub-key',
      REPOQA_LLM_ACTIVE: 'default'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let serverLog = '';
  child.stdout.on('data', (c) => (serverLog += String(c)));
  child.stderr.on('data', (c) => (serverLog += String(c)));

  try {
    await waitFor('health', async () => {
      const r = await getJson(baseUrl + '/health');
      return r.status === 200;
    }, 60000);
    const repo = await waitFor('repo ready', async () => {
      const r = await getJson(baseUrl + '/api/repos');
      const list = (r.body && r.body.repos) || [];
      const ready = list.find((x) => x.status === 'ready');
      return ready || null;
    }, 90000);
    const session = await getJson(baseUrl + '/api/chat/sessions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ repoId: repo.id })
    });
    const sessionId = session.body.session.id;

    const frames = [];
    const startedAt = Date.now();
    const res = await fetch(baseUrl + '/api/chat/sessions/' + sessionId + '/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: '这个仓库的整体结构是什么？' })
    });
    if (!res.ok || !res.body) {
      const text = await res.text().catch(() => '');
      throw new Error('chat stream HTTP ' + res.status + ': ' + text.slice(0, 200));
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      buffer = parseFrames(buffer, (frame) => {
        frames.push({
          event: frame.event,
          payload: frame.payload,
          bytes: frameBytes(frame.event, frame.payload),
          t: Date.now()
        });
      });
    }
    const endAt = Date.now();
    return summarize(scenario, frames, startedAt, endAt);
  } finally {
    child.kill();
    await stub.close();
    void serverLog;
  }
}

async function runReplScenario() {
  const root = path.join(os.tmpdir(), 'cc-chat-progress', 'repl');
  fs.rmSync(root, { recursive: true, force: true });
  const repoDir = path.join(root, 'demo');
  const dataDir = path.join(root, 'data');
  fs.mkdirSync(repoDir, { recursive: true });
  fs.mkdirSync(dataDir, { recursive: true });
  makeDemoRepo(repoDir);
  const stub = await startStubLlm({ delayMs: 300, firstTokenDelayMs: 20000 });
  const child = spawn(process.execPath, [CLI, 'chat', repoDir, '--data-dir', dataDir], {
    cwd: ROOT,
    env: {
      ...process.env,
      REPOQA_LLM_URL: stub.url,
      REPOQA_LLM_MODEL: 'stub-model',
      REPOQA_LLM_API_KEY: 'stub-key',
      REPOQA_LLM_ACTIVE: 'default',
      // 探针没有 TTY：显式打开进度行，验证「TTY 路径」的文案与时机。
      REPOQA_CHAT_PROGRESS: '1'
    },
    stdio: ['pipe', 'pipe', 'pipe']
  });
  const chunks = [];
  child.stdout.on('data', (c) => chunks.push({ t: Date.now(), text: String(c) }));
  child.stderr.on('data', (c) => chunks.push({ t: Date.now(), text: String(c) }));
  try {
    await waitFor('repl ready', async () => chunks.some((c) => c.text.includes('tools ready')), 60000);
    const sentAt = Date.now();
    child.stdin.write('这个仓库的整体结构是什么？\n');
    await sleep(24000);
    const progressLike = chunks.filter((c) => c.t > sentAt && /progress|正在|思考|调用|tool/i.test(c.text));
    const firstAfter = chunks.filter((c) => c.t > sentAt).sort((a, b) => a.t - b.t)[0];
    return {
      scenario: 'repl',
      firstOutputAfterSendMs: firstAfter ? firstAfter.t - sentAt : null,
      progressLikeChunks: progressLike.length,
      sample: chunks.filter((c) => c.t > sentAt).slice(0, 5).map((c) => ({ atMs: c.t - sentAt, text: c.text.slice(0, 120) }))
    };
  } finally {
    child.kill();
    await stub.close();
  }
}

async function main(argv) {
  const args = { scenario: 'slow', json: false, answerChars: 0 };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--scenario') args.scenario = argv[++i];
    else if (argv[i] === '--json') args.json = true;
    else if (argv[i] === '--answer-chars') args.answerChars = Number(argv[++i]) || 0;
  }
  const result =
    args.scenario === 'repl' ? await runReplScenario() : await runHttpScenario(args.scenario, args.answerChars);
  if (args.json) console.log(JSON.stringify(result));
  else {
    console.log('scenario=' + result.scenario + ' frames=' + result.frames + ' totalMs=' + result.totalMs);
    console.log('firstFrameMs=' + result.firstFrameMs + ' firstDeltaMs=' + result.firstDeltaMs +
      ' maxGapMs=' + result.maxGapMs + ' window=' + result.maxGapWindow);
    console.log('progress=' + result.progress + ' hint=' + result.hint + ' heartbeat=' + result.heartbeat + ' counts=' + JSON.stringify(result.counts));
    for (const f of result.timeline || []) console.log('  +' + f.atMs + 'ms ' + f.event + (f.payload ? ' ' + JSON.stringify(f.payload).slice(0, 120) : ''));
    if (result.scenario === 'repl') {
      console.log('firstOutputAfterSendMs=' + result.firstOutputAfterSendMs + ' progressLikeChunks=' + result.progressLikeChunks);
    }
  }
}

main(process.argv.slice(2)).catch((err) => {
  console.error('chat-progress-probe: ' + (err instanceof Error ? err.message : String(err)));
  process.exit(1);
});
