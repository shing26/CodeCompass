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

/** v1.2 票 03 — POST /api/repos 转 202 后的就绪收口：轮询目录到 ready/error。 */
async function waitRepoReady(base, repoId, timeoutMs) {
  const t0 = Date.now();
  for (;;) {
    const r = await fetch(`${base}/api/repos/${repoId}`);
    if (r.ok) {
      const { repo } = await r.json();
      if (repo?.status === 'ready') return repo;
      if (repo?.status === 'error') return { ...repo, pollFailed: true };
    }
    if (Date.now() - t0 > timeoutMs) return null;
    await new Promise((r2) => setTimeout(r2, 500));
  }
}

/** 按名字在目录里找仓（关闭弹窗后的「列表出现」断言用）。 */
async function findRepoByName(base, name) {
  const list = await (await fetch(`${base}/api/repos`)).json();
  const repos = Array.isArray(list) ? list : (list.repos ?? []);
  return repos.find((r) => r.name === name) ?? null;
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
        // v1.2 票 03：POST 已转 202 秒回（旧同步长挂契约废弃）——超时预算回到常规。
        signal: AbortSignal.timeout(30_000)
      })
    ).json();
    step(
      '导入 202 快返（status=indexing + taskId）',
      imp.repo?.status === 'indexing' && String(imp.taskId ?? '').startsWith('index-'),
      `status=${imp.repo?.status} taskId=${imp.taskId}`
    );
    const repoId = imp.repo?.id;
    const readyRepo = repoId ? await waitRepoReady(base, repoId, 120_000) : null;
    step('fixture 索引落定 ready（目录轮询收口）', readyRepo?.status === 'ready', `status=${readyRepo?.status}`);

    console.log('--- 1. 选库 → 工作台 ---');
    const chromium = await loadChromium();
    browser = await chromium.launch({
      headless: true,
      executablePath: process.env.SMOKE_CHROMIUM_PATH || undefined
    });
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    page.on('pageerror', (e) => fails.push('PAGEERROR :: ' + String(e).slice(0, 200)));
    // V27-31 诊断网：renderer 崩溃与主框导航都要留痕——CI 首轮 __wsLog
    // 自 mark 起全空，三种世界（未连接/页被换/上下文死）必须先可区分。
    page.on('crash', () => fails.push('PAGE CRASHED'));
    page.on('framenavigated', (f) => {
      if (f === page.mainFrame()) console.log('  · nav → ' + f.url().slice(0, 120));
    });
    // CDP 级 WS 跟踪：不经页面 JS，reload/崩溃/探针被覆盖都骗不了它。
    // wsEvents 按时间收集，第 4 段用它与页内 __wsLog 交叉裁决。
    const wsEvents = [];
    page.on('websocket', (ws) => {
      if (!ws.url().includes('/ws')) return;
      wsEvents.push({ ev: 'connect', url: ws.url(), t: Date.now() });
      ws.on('close', () => wsEvents.push({ ev: 'close', url: ws.url(), t: Date.now() }));
      ws.on('framereceived', (frame) => {
        let type = '';
        try {
          type = JSON.parse(String(frame.payload))?.type || '';
        } catch {
          /* ignore */
        }
        wsEvents.push({ ev: 'frame', type, t: Date.now() });
      });
    });
    // V27-31: WS 探针（socket 层黑盒证据）。CI 首轮 Release 中本冒烟的「R2 锁」
    // 红而无诊断：断言依赖 status-progress DOM 的出现时机，重连时机、索引帧
    // 密度、React 提交三者赛跑，本地快机幸存、runner 上翻车。探针记录每个 /ws
    // socket 的 create/open/close 与 message 的 type——重连是否发生、帧是否
    // 到达在 socket 层可判，DOM 证据降级为附加信息；失败必 dump 探针时间线。
    await page.addInitScript(() => {
      window.__wsLog = [];
      window.__pageId = 'p' + Math.random().toString(36).slice(2, 8); // reload 即换——「页面未刷新」反证
      const Native = window.WebSocket;
      const log = (sock, ev, extra) => {
        (window.__wsLog ??= []).push({ ev, url: String(sock.url || ''), ...extra, t: Date.now() });
      };
      function Patched(url, protocols) {
        const s = protocols === undefined ? new Native(url) : new Native(url, protocols);
        if (String(url).includes('/ws')) {
          log(s, 'create');
          s.addEventListener('open', () => log(s, 'open'));
          s.addEventListener('close', (e) => log(s, 'close', { code: e.code }));
          s.addEventListener('message', (e) => {
            let type = '';
            try {
              type = JSON.parse(String(e.data))?.type || '';
            } catch {
              /* non-JSON frame */
            }
            log(s, 'message', { type });
          });
        }
        return s;
      }
      Patched.prototype = Native.prototype;
      for (const k of ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED']) Patched[k] = Native[k];
      window.WebSocket = Patched;
    });
    await page.goto(`${base}/?repo=${repoId}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    // P2-7 修正：domcontentloaded 换掉了 networkidle 的隐式等待——所有断言改
    // waitForSelector 显式等待（sidebar/dock 是异步加载，一次可见性轮询会抢跑）。
    step('canvas 渲染', await page.waitForSelector('[data-testid="canvas"]', { state: 'visible', timeout: 15000 }).then(() => true).catch(() => false));
    step('侧栏路由项 ≥1', await page.waitForSelector('[data-testid="route-item"]', { timeout: 15000 }).then(() => true).catch(() => false));
    step('AskDock 常驻', await page.waitForSelector('[data-testid="ask-dock"]', { state: 'visible', timeout: 10000 }).then(() => true).catch(() => false));

    // v1.2 票 08（R4-7）— 拓扑概览层进 Release 门：Round4 记「新手点进代码拓扑
    // 只看到一条来历不明的示例链路」，该症状只能靠真浏览器首屏断言拦住。
    console.log('--- 1a. 拓扑概览层（v1.2 票 08 / R4-7） ---');
    step(
      '概览层渲染（结构规模网格可见）',
      await page
        .waitForSelector('[data-testid="repo-overview"] [data-testid="scale-files"]', { state: 'visible', timeout: 30000 })
        .then(() => true)
        .catch(() => false)
    );
    step(
      '枢纽符号列表渲染（radar 空 query 全仓枢纽）',
      await page
        .waitForSelector('[data-testid="repo-overview"] [data-testid="hub-entry"]', { timeout: 30000 })
        .then(() => true)
        .catch(() => false)
    );
    // 自动示例链路必须自报家门（这是「来历不明」的修法本身）。
    step(
      '自动示例链路带来源标注',
      await page
        .waitForSelector('[data-testid="trace-origin"]', { timeout: 30000 })
        .then(() => true)
        .catch(() => false)
    );
    // Round5 红线 ①② 进浏览器门：修前概览层的「Top API 入口」五张卡片逐字相同
    // （AnswerBody → useState，深度恒 1），点枢纽还会弹出远程模型隐私授权模态。
    // 这两条只有真浏览器点得出来，单测覆盖不到「五张卡片是否真的五样」。
    const topApiTexts = await page
      .waitForSelector('[data-testid="api-entry"]', { timeout: 30000 })
      .then(() =>
        page.$$eval('[data-testid="api-entry"]', (els) =>
          els.map((el) => (el.textContent || '').trim())
        )
      )
      .catch(() => []);
    step(
      'Top API 入口卡片内容互不相同（红线①：修前五张逐字相同）',
      topApiTexts.length >= 2 && new Set(topApiTexts).size === topApiTexts.length,
      `cards=${topApiTexts.length} distinct=${new Set(topApiTexts).size}`
    );
    // 伪造的签名是「所有卡片的 hops 逐字相同」（修前五张都是 AnswerBody → useState）。
    // 单张卡出现「深度 1」是合法的（一跳链路本来就该是 1），所以这里断言的是
    // 「不存在被所有卡片共用的同一串 hops」，而不是禁止某个深度值。
    const hopLines = await page
      .$$eval('[data-testid="api-entry"]', (els) =>
        els.map((el) => {
          const line = el.querySelector('div + div');
          return (line?.textContent || '').trim();
        })
      )
      .catch(() => []);
    const sharedHop = hopLines.length >= 2 && new Set(hopLines).size < hopLines.length
      ? [...new Set(hopLines)].find((h) => hopLines.filter((x) => x === h).length === hopLines.length)
      : undefined;
    step(
      '没有卡片共用同一串 hops（伪造签名）',
      !sharedHop,
      sharedHop ? `shared="${sharedHop.slice(0, 50)}"` : `hops=${JSON.stringify(hopLines).slice(0, 80)}`
    );
    // 点枢纽：静态操作不得弹出远程模型隐私授权（红线②）。
    await page.click('[data-testid="hub-entry"]').catch(() => {});
    await page.waitForTimeout(1200);
    const consentShown = await page
      .$('[data-testid="consent-modal"]')
      .then((h) => Boolean(h))
      .catch(() => false);
    step('点枢纽不弹远程模型隐私确认（红线②）', !consentShown, `consent=${consentShown}`);
    if (consentShown) await page.keyboard.press('Escape').catch(() => {});

    console.log('--- 1b. 体检面（v1.2 票 02：scan REST + 五桶） ---');
    await page.goto(`${base}/?repo=${repoId}&mode=scan`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    step(
      '体检面五桶渲染（零静态调用者桶可见）',
      await page
        .waitForSelector('[data-testid="scan-bucket-orphanedPublic"]', { state: 'visible', timeout: 30000 })
        .then(() => true)
        .catch(() => false)
    );
    step(
      '体检面精度态势区渲染',
      await page
        .waitForSelector('[data-testid="scan-precision"]', { state: 'visible', timeout: 10000 })
        .then(() => true)
        .catch(() => false)
    );

    console.log('--- 1c. 导入流化（v1.2 票 03）：UI 关闭后台继续 + WS 进度序列 ---');
    // Node 24 原生 WebSocket 独立收帧（与页面无关）：断言阶段序列与终态恰一。
    const wsFrames = [];
    const wsProbe = new WebSocket(base.replace(/^http/, 'ws') + '/ws');
    await new Promise((resolve) => {
      wsProbe.addEventListener('open', resolve);
      wsProbe.addEventListener('error', resolve); // 探测口不可用也不阻断主断言
      setTimeout(resolve, 3000);
    });
    wsProbe.addEventListener('message', (e) => {
      try {
        const m = JSON.parse(String(e.data));
        if (m?.type === 'repoqa.index.progress' && m?.payload?.repoId) {
          wsFrames.push({ repoId: m.payload.repoId, phase: m.payload.phase, percent: m.payload.percent });
        }
      } catch {
        /* malformed frame */
      }
    });

    const secondDir = buildFixtureRepo();
    await page.goto(`${base}/?repo=${repoId}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForSelector('[data-testid="open-import"]', { state: 'visible', timeout: 10000 });
    await page.click('[data-testid="open-import"]');
    await page.fill('[data-testid="import-name"]', 'smoke-second');
    await page.fill('[data-testid="import-path"]', secondDir);
    const t0 = Date.now();
    await page.click('[data-testid="import-submit"]');
    const backgroundPhase = await page
      .waitForSelector('[data-testid="import-background-hint"]', { state: 'visible', timeout: 15000 })
      .then(() => true)
      .catch(() => false);
    step(
      '导入 202 后进入后台阶段（不阻塞等待全量索引）',
      backgroundPhase && Date.now() - t0 < 15000,
      `elapsed=${Date.now() - t0}ms`
    );

    // 关闭弹窗（后台继续）→ 索引照跑，完成后列表出现该仓 ready。
    await page.click('text=后台继续');
    const dialogClosed = await page
      .waitForSelector('[data-testid="import-dialog"]', { state: 'detached', timeout: 5000 })
      .then(() => true)
      .catch(() => false);
    step('弹窗关闭（后台继续出口可用）', dialogClosed);
    const secondRepoId = await (async () => {
      const t1 = Date.now();
      while (Date.now() - t1 < 90_000) {
        const found = await findRepoByName(base, 'smoke-second');
        if (found?.status === 'ready') return found.id;
        await new Promise((r) => setTimeout(r, 500));
      }
      return null;
    })();
    step('关闭后索引继续并落目录 ready', Boolean(secondRepoId));

    // WS 序列：阶段单调 + 终态（FINALIZING/100）恰一。
    await new Promise((r) => setTimeout(r, 800));
    try {
      wsProbe.close();
    } catch {
      /* already closed */
    }
    {
      const mine = wsFrames.filter((f) => f.repoId === secondRepoId);
      const order = { DISCOVERY: 0, PARSING: 1, FINALIZING: 2 };
      const seq = mine.filter((f) => f.phase in order).map((f) => order[f.phase]);
      const monotonic = seq.length > 0 && seq.every((v, i) => i === 0 || v >= seq[i - 1]);
      const completes = mine.filter((f) => f.phase === 'FINALIZING' && f.percent === 100).length;
      step(
        'WS 进度序列：阶段单调 + 终态恰一',
        monotonic && completes === 1,
        `phases=${JSON.stringify([...new Set(mine.map((f) => f.phase))])} completes=${completes} frames=${mine.length}`
      );
    }

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
    // v1.2.x（R5-05）流式可感知/可中断进 Release 门：修前整轮只有一个禁用的「…」，
    // 用户既看不出在跑还是坏了也叫不停（Round5 走查：68s 一轮无任何出口）。
    step('busy 时出现停止键（取代发送键）', await page
      .waitForSelector('[data-testid="chat-stop"]', { state: 'visible', timeout: 10000 })
      .then(() => true)
      .catch(() => false));
    step('等待期显示已用时 / 首字延迟', await page
      .waitForFunction(
        () => {
          const el = document.querySelector('[data-testid="chat-timing"]');
          return Boolean(el && /已用|首字/.test(el.textContent || ''));
        },
        { timeout: 10000 }
      )
      .then(() => true)
      .catch(() => false));
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
    const pageIdBefore = await page.evaluate(() => window.__pageId);
    await page.evaluate(() => {
      // DOM 证据降级为附加信息（进度条渲染时机是三方赛跑，见 V27-23）。
      window.__smokeSeenProgress = false;
      new MutationObserver(() => {
        if (document.querySelector('[data-testid="status-progress"]')) {
          window.__smokeSeenProgress = true;
        }
      }).observe(document.body, { subtree: true, childList: true });
    });
    srv.child.kill();
    // 时间戳判据（V27-31 第二轮）：数组下标 slice(mark) 在页内探针被 reload
    // 清零时会静默越界返回 []（CI 首跑的「全空」与此完全相容）。改为
    // 「t >= killTs 的事件」——reload 后新页面新事件同样落窗可判；pageId
    // 另立「页面未刷新」证据，与重连/帧到达三事各自可辨。
    const killTs = Date.now();
    step('后端确实下线', await waitHealthDown(base));
    srv = startServer(port, dataDir, stub.url);
    {
      const up = await waitHealth(base);
      if (!up) dumpStderr(); // P2-3：重启失败也要有诊断
      step('后端重启 healthy', up);
    }
    // ① 重连证据：kill 后出现新的 /ws 连接——页内探针或 CDP 任一源可证。
    const reconnected = await page
      .waitForFunction((ts) => (window.__wsLog || []).some((e) => e.ev === 'open' && e.t >= ts), killTs, {
        timeout: 30000,
        polling: 500
      })
      .then(() => true)
      .catch(() => wsEvents.some((e) => e.ev === 'connect' && e.t >= killTs));
    // ② 进度帧证据：确认重连后才触发 reindex（消灭旧脚本「202 早于重连即丢帧」
    // 的赛跑）；多轮触发防御索引快于观测窗的极端调度。
    let reindexStatus = 0;
    let progressFrame = false;
    for (let round = 0; round < 5 && !progressFrame; round++) {
      const re = await fetch(`${base}/api/repos/${repoId}/reindex`, { method: 'POST' });
      if (round === 0) reindexStatus = re.status;
      progressFrame = await page
        .waitForFunction(
          (ts) => (window.__wsLog || []).some((e) => e.ev === 'message' && e.type === 'repoqa.index.progress' && e.t >= ts),
          killTs,
          { timeout: 4000, polling: 300 }
        )
        .then(() => true)
        .catch(() => wsEvents.some((e) => e.ev === 'frame' && e.type === 'repoqa.index.progress' && e.t >= killTs));
    }
    step('reindex 受理 202', reindexStatus === 202, `status=${reindexStatus}`);
    const noReload = await page.evaluate((id) => window.__pageId === id, pageIdBefore).catch(() => false);
    const domLatch = await page.evaluate(() => window.__smokeSeenProgress === true).catch(() => false);
    step(
      '页面未刷新而 WS 重连收到索引进度（R2 锁）',
      reconnected && progressFrame && noReload,
      `reconnect=${reconnected} progressFrame=${progressFrame} noReload=${noReload} domBar=${domLatch ? '亦见' : '未渲染(仅 socket 证据，V27-23 面)'}`
    );
    if (!(reconnected && progressFrame && noReload)) {
      const diag = await page
        .evaluate(() => ({ len: (window.__wsLog || []).length, tail: (window.__wsLog || []).slice(-20) }))
        .catch((e) => ({ probeThrew: String(e).slice(0, 120) }));
      console.log('  · 诊断 __wsLog：', JSON.stringify(diag));
      console.log('  · 诊断 CDP wsEvents：', JSON.stringify(wsEvents.slice(-20)));
    }
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
    // v0.31 票 05 把 topo 降为深链页（tab-topo 测试 id 随一级导航收敛移除），
    // 切回走 URL-as-truth 契约：?repo= 自动选库、viewFromMode 缺省即 topo。
    await page.goto(`${base}/?repo=${repoId}&mode=topo`, { waitUntil: 'domcontentloaded' });
    const interactive = await page
      .waitForSelector('[data-testid="canvas"]', { state: 'visible', timeout: 15000 })
      .then(() => true)
      .catch(() => false);
    step('重启后工作台仍可交互（深链切回拓扑）', interactive);
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
