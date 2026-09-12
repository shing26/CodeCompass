/**
 * v0.27-B R7 — UI 冒烟进 Release 门（销 V27-13）。
 *
 * 立项动机：chatGuardSend P0 存活两天、330 条单测全绿零拦——mock 不校验参数
 * 语义、e2e gate 绕开浏览器层。本脚本用真 chromium 走真实前端，作为发布门：
 *   ① 选库 → canvas + 路由列表
 *   ② AskDock 预填 → chat →（consent）→ stub LLM 流式回答到达（零 token 零外网）
 *   ③ 变更审计真跑 gate（HEAD~1→HEAD fixture）→ 历史行出现
 *   ④ 韧性：杀掉后端重启 → 不刷新页面，WS 重连收到索引进度（锁 R2）
 *
 * 环境接缝：
 *   SMOKE_PW_MODULE      playwright 模块说明符（默认 'playwright'→'playwright-core' 兜底）
 *   SMOKE_CHROMIUM_PATH  浏览器可执行文件（CI 用 npx playwright install 的默认位；本地可指 ms-playwright 缓存）
 *   SMOKE_SERVER_NODE    起服务用的 node（默认 process.execPath）
 * 退出码：0=全绿；非 0=存在 FAIL（CI 直接红）。
 */
import { spawn } from 'node:child_process';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import { startStubLlm, STUB_SENTINEL } from './stub-llm.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const CLI = path.join(ROOT, 'services', 'control-plane', 'dist', 'cli.js');
const fails = [];
const step = (name, ok, extra) => {
  console.log(`${ok ? '  ✓' : '  ✗ FAIL'} ${name}${extra ? ' :: ' + extra : ''}`);
  if (!ok) fails.push(name + (extra ? ' :: ' + extra : ''));
};

async function loadChromium() {
  const spec = process.env.SMOKE_PW_MODULE;
  const candidates = spec ? [spec] : ['playwright', 'playwright-core'];
  for (const c of candidates) {
    try {
      const mod = await import(c);
      if (mod.chromium) return mod.chromium;
    } catch {
      /* try next */
    }
  }
  throw new Error('playwright not resolvable (set SMOKE_PW_MODULE / npm i -D playwright)');
}

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

function buildFixtureRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-smoke-repo-'));
  const java = path.join(dir, 'src', 'main', 'java', 'com', 'smoke');
  fs.mkdirSync(java, { recursive: true });
  fs.writeFileSync(
    path.join(java, 'HealthController.java'),
    'package com.smoke;\nimport org.springframework.web.bind.annotation.*;\n@RestController\n@RequestMapping("/api/health")\npublic class HealthController {\n  private final HealthService svc = new HealthService();\n  @GetMapping\n  public String get() { return svc.ping(); }\n}\n'
  );
  fs.writeFileSync(
    path.join(java, 'HealthService.java'),
    'package com.smoke;\npublic class HealthService {\n  private final HealthRepo repo = new HealthRepo();\n  public String ping() { return repo.select(); }\n}\n'
  );
  fs.writeFileSync(
    path.join(java, 'HealthRepo.java'),
    'package com.smoke;\npublic class HealthRepo {\n  public String select() { return "ok"; }\n}\n'
  );
  // 填充 ~40 个小类：让索引跑 1s+，韧性段的 WS 进度帧有可观察窗口
  for (let i = 0; i < 40; i++) {
    fs.writeFileSync(
      path.join(java, `Bean${i}.java`),
      `package com.smoke;\npublic class Bean${i} {\n  public String read${i}() { return "b${i}"; }\n}\n`
    );
  }
  const git = (...args) =>
    execFileSync(
      'git',
      // R7 review P2-6：隔全局 gpgsign/hooksPath，防异机 CI 的 git 配置炸 fixture
      ['-C', dir, '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=', ...args],
      { stdio: 'pipe', encoding: 'utf8' }
    );
  git('init', '-b', 'main');
  git('-c', 'user.email=smoke@ci.invalid', '-c', 'user.name=smoke', 'add', '-A');
  git('-c', 'user.email=smoke@ci.invalid', '-c', 'user.name=smoke', 'commit', '-m', 'c1: base');
  // head commit 追加新路由 → gate 的 diff 有真实影响面
  fs.writeFileSync(
    path.join(java, 'OrdersController.java'),
    'package com.smoke;\nimport org.springframework.web.bind.annotation.*;\n@RestController\n@RequestMapping("/api/orders")\npublic class OrdersController {\n  @GetMapping\n  public String list() { return "[]"; }\n}\n'
  );
  git('-c', 'user.email=smoke@ci.invalid', '-c', 'user.name=smoke', 'add', '-A');
  git('-c', 'user.email=smoke@ci.invalid', '-c', 'user.name=smoke', 'commit', '-m', 'c2: add orders route');
  return dir;
}

function startServer(port, dataDir, llmUrl) {
  const child = spawn(
    process.env.SMOKE_SERVER_NODE ?? process.execPath,
    [CLI, '--port', String(port), '--data-dir', dataDir, '--no-browser', '--no-watch'],
    {
      cwd: ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        MHW_CP_HOST: '127.0.0.1',
        REPOQA_LLM_URL: llmUrl,
        REPOQA_LLM_MODEL: 'smoke-stub',
        // 显式假值占位——非凭据、stub 不校验（R7 凭据红线：零真实凭据字面量）
        REPOQA_LLM_API_KEY: 'smoke-local-not-a-credential',
        COPILOT_ENV_FILE: path.join(dataDir, 'no-such-env-file')
      }
    }
  );
  const err = { lines: [] };
  child.stderr.on('data', (c) => err.lines.push(String(c)));
  child.stdout.on('data', () => {});
  return { child, stderr: err };
}

async function waitHealth(base, timeoutMs = 30000) {
  const t0 = Date.now();
  for (;;) {
    try {
      const r = await fetch(`${base}/health`, { signal: AbortSignal.timeout(2000) });
      if (r.ok) return true;
    } catch {
      /* retry */
    }
    if (Date.now() - t0 > timeoutMs) return false;
    await new Promise((r) => setTimeout(r, 300));
  }
}

async function waitHealthDown(base, timeoutMs = 10000) {
  const t0 = Date.now();
  for (;;) {
    try {
      const r = await fetch(`${base}/health`, { signal: AbortSignal.timeout(1000) });
      if (!r.ok) return true;
    } catch {
      return true;
    }
    if (Date.now() - t0 > timeoutMs) return false;
    await new Promise((r) => setTimeout(r, 200));
  }
}

async function main() {
  if (!fs.existsSync(CLI)) throw new Error(`dist/cli.js 缺失——先 npm run build（${CLI}）`);
  const stub = await startStubLlm();
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-smoke-data-'));
  const repoDir = buildFixtureRepo();
  let port = await freePort();
  let base = `http://127.0.0.1:${port}`;
  let srv = startServer(port, dataDir, stub.url);
  let browser = null;
  const dumpStderr = () =>
    console.log(srv.stderr.lines.join('').split('\n').slice(-30).join('\n'));
  try {
    console.log('--- 0. 服务与索引 ---');
    let healthy = await waitHealth(base);
    if (!healthy) {
      // R7 review P2-3/5：失败必带诊断；freePort 的 TOCTOU 抢占换 port 重试一次
      console.log('  · 首轮启动失败，stderr 尾 30 行：');
      dumpStderr();
      srv.child.kill();
      port = await freePort();
      base = `http://127.0.0.1:${port}`;
      srv = startServer(port, dataDir, stub.url);
      healthy = await waitHealth(base);
    }
    step('server healthy（loopback）', healthy);
    if (!healthy) throw new Error('后端两次起服均失败，中止');
    const imp = await (
      await fetch(`${base}/api/repos`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ localPath: repoDir, name: 'smoke-repo', branch: 'main' }),
        // P2-7：该端点同步等全量索引（V27-20 在册）——5 分钟硬上限防永悬吃满 job
        signal: AbortSignal.timeout(300_000)
      })
    ).json();
    const repoId = imp.repo?.id;
    step('fixture 导入并 ready', Boolean(repoId) && imp.repo.status === 'ready', `status=${imp.repo?.status}`);

    console.log('--- 1. 选库 → 工作台 ---');
    const chromium = await loadChromium();
    browser = await chromium.launch({
      headless: true,
      executablePath: process.env.SMOKE_CHROMIUM_PATH || undefined
    });
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    page.on('pageerror', (e) => fails.push('PAGEERROR :: ' + String(e).slice(0, 200)));
    await page.goto(`${base}/?repo=${repoId}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    // P2-7 修正：domcontentloaded 换掉了 networkidle 的隐式等待——所有断言改
    // waitForSelector 显式等待（sidebar/dock 是异步加载，一次可见性轮询会抢跑）。
    step('canvas 渲染', await page.waitForSelector('[data-testid="canvas"]', { state: 'visible', timeout: 15000 }).then(() => true).catch(() => false));
    step('侧栏路由项 ≥1', await page.waitForSelector('[data-testid="route-item"]', { timeout: 15000 }).then(() => true).catch(() => false));
    step('AskDock 常驻', await page.waitForSelector('[data-testid="ask-dock"]', { state: 'visible', timeout: 10000 }).then(() => true).catch(() => false));

    console.log('--- 2. AskDock → chat → stub 流式回答 ---');
    await page.waitForSelector('[data-testid="ask-dock-input"]', { state: 'visible', timeout: 10000 });
    await page.fill('[data-testid="ask-dock-input"]', '冒烟：这个仓库有什么？');
    // 走发送钮而非 Enter：键入→React state→提交处理器读取之间存在异步窗口。
    await page.click('[data-testid="ask-dock-send"]');
    await page.waitForSelector('[data-testid="chat-view"]', { timeout: 5000 });
    step('dock 预填进 composer', await page
      .waitForFunction(() => (document.querySelector('[data-testid="chat-question"]')?.value || '').includes('冒烟'), { timeout: 5000 })
      .then(() => true)
      .catch(() => false));
    await page.click('[data-testid="chat-send"]');
    if (await page.locator('[data-testid="consent-modal"]').count()) {
      await page.click('[data-testid="consent-confirm"]');
      await page.click('[data-testid="chat-send"]'); // consent 后输入保留，用户再发
    }
    const errBox = page.locator('[data-testid="chat-error"]');
    // R7 review P2-1：两段式观测——先见「只有前缀的中间态」（done 兜底是一次性
    // 全文，绝不会出现中间态），再见到全文。真钉「渲染流经 SSE delta 通路」。
    const sawPrefixOnly = await page
      .waitForFunction(
        () => {
          const msgs = document.querySelectorAll('[data-testid="chat-messages"] > div');
          const txt = Array.from(msgs).map((m) => m.textContent || '').join(' ');
          return txt.includes('SMOKE-STUB-') && !txt.includes('SMOKE-STUB-ANSWER');
        },
        { timeout: 20000 }
      )
      .then(() => true)
      .catch(() => false);
    step('流式中间态可见（前缀先于全文渲染，非 done 兜底）', sawPrefixOnly);
    const answered = await page
      .waitForFunction(
        (sentinel) => {
          const msgs = document.querySelectorAll('[data-testid="chat-messages"] > div');
          const txt = Array.from(msgs).map((m) => m.textContent || '').join(' ');
          return txt.includes(sentinel);
        },
        STUB_SENTINEL,
        { timeout: 30000 }
      )
      .then(() => true)
      .catch(() => false);
    step(
      'stub 流式回答到达（含跨帧重组）',
      answered,
      answered ? '' : `err=${answered ? '' : (await errBox.count()) ? await errBox.innerText() : 'timeout'}`
    );
    await page.click('[data-testid="chat-back"]');

    console.log('--- 3. 变更审计真跑 gate ---');
    await page.click('[data-testid="tab-gate"]');
    await page.waitForSelector('[data-testid="ci-gate"]', { timeout: 5000 });
    await page.fill('[data-testid="ci-base"]', 'HEAD~1');
    await page.fill('[data-testid="ci-head"]', 'HEAD');
    await page.click('[data-testid="gate-run"]');
    const rowAppeared = await page
      .waitForFunction(
        () =>
          document.querySelectorAll('[data-testid="gate-run-row"]').length >= 1 ||
          !!document.querySelector('[data-testid="gate-run-error"]'),
        { timeout: 60000 }
      )
      .then(() => true)
      .catch(() => false);
    step('gate 运行出结果（行或友好错误）', rowAppeared);
    if (await page.locator('[data-testid="gate-run-error"]').count()) {
      step('gate 未报错', false, await page.locator('[data-testid="gate-run-error"]').first().innerText());
    }

    console.log('--- 4. 韧性：重启后端 → 不刷新页面，WS 重连收进度帧 ---');
    srv.child.kill();
    step('后端确实下线', await waitHealthDown(base));
    srv = startServer(port, dataDir, stub.url);
    {
      const up = await waitHealth(base);
      if (!up) dumpStderr(); // P2-3：重启失败也要有诊断
      step('后端重启 healthy', up);
    }
    await new Promise((r) => setTimeout(r, 2500)); // 给 WS 退避重连（1s 起）留窗口
    await page.evaluate(() => {
      window.__smokeSeenProgress = false;
      new MutationObserver(() => {
        if (document.querySelector('[data-testid="status-progress"]')) {
          window.__smokeSeenProgress = true;
        }
      }).observe(document.body, { subtree: true, childList: true });
    });
    const re = await fetch(`${base}/api/repos/${repoId}/reindex`, { method: 'POST' });
    step('reindex 受理 202', re.status === 202, `status=${re.status}`);
    let seen = await page
      .waitForFunction(() => window.__smokeSeenProgress === true, { timeout: 20000 })
      .then(() => true)
      .catch(() => false);
    if (!seen) {
      // 单轮可能抢跑（索引快于重连）——再触发一次
      await fetch(`${base}/api/repos/${repoId}/reindex`, { method: 'POST' });
      seen = await page
        .waitForFunction(() => window.__smokeSeenProgress === true, { timeout: 20000 })
        .then(() => true)
        .catch(() => false);
    }
    step('页面未刷新而 WS 重连收到索引进度（R2 锁）', seen);
    // 落定信号走服务端状态（status-progress 在索引完成后不清空——已登 V27-23，
    // 属进度条残留缺陷而非冒烟逻辑）；页侧再给 1 轮 catalog 轮询的时间。
    {
      const t0 = Date.now();
      let ready = false;
      while (Date.now() - t0 < 60000) {
        const r = await (await fetch(`${base}/api/repos/${repoId}`)).json();
        if (r.repo && r.repo.status !== 'indexing') {
          ready = r.repo.status === 'ready';
          break;
        }
        await new Promise((res) => setTimeout(res, 500));
      }
      step('reindex 服务端落定 ready', ready);
    }
    // 步 3 把视图切到了审计面——canvas 属拓扑视图，先切回再验可交互。
    await page.click('[data-testid="tab-topo"]');
    const interactive = await page
      .waitForSelector('[data-testid="canvas"]', { state: 'visible', timeout: 15000 })
      .then(() => true)
      .catch(() => false);
    step('重启后工作台仍可交互（切回拓扑）', interactive);
  } catch (err) {
    step('冒烟脚本自身异常', false, String(err && err.stack ? err.stack.split('\n')[0] : err));
  } finally {
    if (browser) await browser.close().catch(() => {});
    // R7 review P2-2：信号退出的子进程 exitCode===null 且 'exit' 已发过——
    // 不加 signalCode 判定会在 finally 永久挂死，把 1 分钟红放大成 30 分钟红。
    if (srv?.child && srv.child.exitCode === null && srv.child.signalCode === null) {
      srv.child.kill();
      await new Promise((r) => srv.child.once('exit', r)).catch(() => {});
    }
    await stub.close();
    // Windows：SQLite/日志句柄释放有延迟——带重试删除，最终失败只警告不吞结果。
    for (const dir of [dataDir, repoDir]) {
      try {
        fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
      } catch {
        console.log(`  · 清理遗留（Windows 句柄延迟，tmp 目录可忽略）：${dir}`);
      }
    }
  }
  console.log(`=== UI SMOKE: ${fails.length === 0 ? 'PASS' : 'FAIL(' + fails.length + ')'} ===`);
  fails.forEach((f) => console.log('  ✗ ' + f));
  process.exit(fails.length === 0 ? 0 : 1);
}

main();
