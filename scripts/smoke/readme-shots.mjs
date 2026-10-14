/**
 * README 视觉资产生成器——真 Chromium 截图，供 README「产品一览」使用。
 *
 * 用法（需先 npm run build）：
 *   node scripts/smoke/readme-shots.mjs
 * 产物：.github/assets/{overview,callchain,scan,delta,inspector}.png（1600×1000）
 *
 * 设计纪律（与仓库「零幻觉」口径一致）：
 *   - 截图语义 = 产品真实渲染；fixture 是演示用多语言小仓（Java Spring +
 *     TypeScript + Python，两次提交），README 中必须如实标注为演示 fixture；
 *   - 不起 LLM、不截图 chat 面（stub 答案会上假图片，违证据纪律）；
 *   - 复用 ui_smoke.mjs 的驱动模式：CLI 起服 → POST 导入 → ?repo=&mode= 深链。
 */
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const CLI = path.join(ROOT, 'services', 'control-plane', 'dist', 'cli.js');
const OUT = path.join(ROOT, '.github', 'assets');
const VIEWPORT = { width: 1600, height: 1000 };

const log = (...a) => console.log('[shots]', ...a);

/* ---------- fixture：演示用多语言小仓（两次提交，delta 面有真实差异） ---------- */

function buildFixtureRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-shots-repo-'));
  const w = (rel, body) => {
    const p = path.join(dir, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, body);
  };
  const git = (...args) =>
    execFileSync('git', ['-C', dir, '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=', ...args], {
      stdio: 'pipe',
      encoding: 'utf8'
    });

  w('README.md', '# demo-polyglot\n\n演示 fixture：Java Spring 后端 + TypeScript 前端 + Python 服务。\n');
  w(
    'frontend/src/api/owners.ts',
    [
      "import axios from 'axios';",
      '',
      "const api = axios.create({ baseURL: '/api' });",
      '',
      'export interface Owner {',
      '  id: number;',
      '  name: string;',
      '}',
      '',
      'export async function listOwners(): Promise<Owner[]> {',
      "  const response = await api.get<Owner[]>('/owners');",
      '  return response.data;',
      '}',
      ''
    ].join('\n')
  );
  w(
    'frontend/src/pages/OwnerList.tsx',
    [
      "import { useEffect, useState } from 'react';",
      "import { listOwners, type Owner } from '../api/owners';",
      '',
      'export function OwnerList() {',
      '  const [owners, setOwners] = useState<Owner[]>([]);',
      '  useEffect(() => {',
      '    void listOwners().then(setOwners);',
      '  }, []);',
      '  return (',
      '    <ul>',
      '      {owners.map((owner) => (',
      '        <li key={owner.id}>{owner.name}</li>',
      '      ))}',
      '    </ul>',
      '  );',
      '}',
      ''
    ].join('\n')
  );
  w(
    'backend/src/main/java/com/demo/owner/OwnerController.java',
    [
      'package com.demo.owner;',
      '',
      'import java.util.List;',
      'import org.springframework.web.bind.annotation.GetMapping;',
      'import org.springframework.web.bind.annotation.RequestMapping;',
      'import org.springframework.web.bind.annotation.RestController;',
      '',
      '@RestController',
      '@RequestMapping("/api/owners")',
      'public class OwnerController {',
      '  private final OwnerService service;',
      '',
      '  public OwnerController(OwnerService service) {',
      '    this.service = service;',
      '  }',
      '',
      '  @GetMapping',
      '  public List<Owner> list() {',
      '    return service.findAll();',
      '  }',
      '}',
      ''
    ].join('\n')
  );
  w(
    'backend/src/main/java/com/demo/owner/OwnerService.java',
    [
      'package com.demo.owner;',
      '',
      'import java.util.List;',
      '',
      'public class OwnerService {',
      '  private final OwnerRepository repository;',
      '',
      '  public OwnerService(OwnerRepository repository) {',
      '    this.repository = repository;',
      '  }',
      '',
      '  public List<Owner> findAll() {',
      '    return repository.selectOwners();',
      '  }',
      '}',
      ''
    ].join('\n')
  );
  w(
    'backend/src/main/java/com/demo/owner/OwnerRepository.java',
    [
      'package com.demo.owner;',
      '',
      'import java.util.List;',
      '',
      'public interface OwnerRepository {',
      '  List<Owner> selectOwners();',
      '}',
      ''
    ].join('\n')
  );
  w(
    'backend/src/main/java/com/demo/owner/Owner.java',
    ['package com.demo.owner;', '', 'public class Owner {', '  private long id;', '  private String name;', '}', ''].join('\n')
  );
  w(
    'backend/src/main/resources/mapper/OwnerRepository.xml',
    [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<!DOCTYPE mapper PUBLIC "-//mybatis.org//DTD Mapper 3.0//EN" "http://mybatis.org/dtd/mybatis-3-mapper.dtd">',
      '<mapper namespace="com.demo.owner.OwnerRepository">',
      '  <select id="selectOwners" resultType="com.demo.owner.Owner">',
      '    SELECT id, name FROM owners ORDER BY name',
      '  </select>',
      '</mapper>',
      ''
    ].join('\n')
  );
  w(
    'services/pricing/app.py',
    [
      'from fastapi import FastAPI',
      '',
      'app = FastAPI(title="pricing")',
      '',
      '',
      '@app.get("/api/pricing")',
      'def pricing() -> dict:',
      '    return {"tier": "standard"}',
      ''
    ].join('\n')
  );

  git('init', '-b', 'main');
  git('-c', 'user.email=demo@local.invalid', '-c', 'user.name=demo', 'add', '-A');
  git('-c', 'user.email=demo@local.invalid', '-c', 'user.name=demo', 'commit', '-m', 'c1: base polyglot skeleton');

  // 提交 2：新增详情路由全链（前端 api → 控制器 → service → mapper → SQL）+ pricing 新端点
  w(
    'frontend/src/api/owners.ts',
    [
      "import axios from 'axios';",
      '',
      "const api = axios.create({ baseURL: '/api' });",
      '',
      'export interface Owner {',
      '  id: number;',
      '  name: string;',
      '}',
      '',
      'export async function listOwners(): Promise<Owner[]> {',
      "  const response = await api.get<Owner[]>('/owners');",
      '  return response.data;',
      '}',
      '',
      'export async function getOwner(id: number): Promise<Owner> {',
      "  const response = await api.get<Owner>(`/owners/${id}`);",
      '  return response.data;',
      '}',
      ''
    ].join('\n')
  );
  w(
    'backend/src/main/java/com/demo/owner/OwnerController.java',
    [
      'package com.demo.owner;',
      '',
      'import java.util.List;',
      'import org.springframework.web.bind.annotation.GetMapping;',
      'import org.springframework.web.bind.annotation.PathVariable;',
      'import org.springframework.web.bind.annotation.RequestMapping;',
      'import org.springframework.web.bind.annotation.RestController;',
      '',
      '@RestController',
      '@RequestMapping("/api/owners")',
      'public class OwnerController {',
      '  private final OwnerService service;',
      '',
      '  public OwnerController(OwnerService service) {',
      '    this.service = service;',
      '  }',
      '',
      '  @GetMapping',
      '  public List<Owner> list() {',
      '    return service.findAll();',
      '  }',
      '',
      '  @GetMapping("/{id}")',
      '  public Owner detail(@PathVariable long id) {',
      '    return service.findById(id);',
      '  }',
      '}',
      ''
    ].join('\n')
  );
  w(
    'backend/src/main/java/com/demo/owner/OwnerService.java',
    [
      'package com.demo.owner;',
      '',
      'import java.util.List;',
      '',
      'public class OwnerService {',
      '  private final OwnerRepository repository;',
      '',
      '  public OwnerService(OwnerRepository repository) {',
      '    this.repository = repository;',
      '  }',
      '',
      '  public List<Owner> findAll() {',
      '    return repository.selectOwners();',
      '  }',
      '',
      '  public Owner findById(long id) {',
      '    return repository.selectOwner(id);',
      '  }',
      '}',
      ''
    ].join('\n')
  );
  w(
    'backend/src/main/java/com/demo/owner/OwnerRepository.java',
    [
      'package com.demo.owner;',
      '',
      'import java.util.List;',
      '',
      'public interface OwnerRepository {',
      '  List<Owner> selectOwners();',
      '',
      '  Owner selectOwner(long id);',
      '}',
      ''
    ].join('\n')
  );
  w(
    'backend/src/main/resources/mapper/OwnerRepository.xml',
    [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<!DOCTYPE mapper PUBLIC "-//mybatis.org//DTD Mapper 3.0//EN" "http://mybatis.org/dtd/mybatis-3-mapper.dtd">',
      '<mapper namespace="com.demo.owner.OwnerRepository">',
      '  <select id="selectOwners" resultType="com.demo.owner.Owner">',
      '    SELECT id, name FROM owners ORDER BY name',
      '  </select>',
      '  <select id="selectOwner" resultType="com.demo.owner.Owner">',
      '    SELECT id, name FROM owners WHERE id = #{id}',
      '  </select>',
      '</mapper>',
      ''
    ].join('\n')
  );
  w(
    'services/pricing/app.py',
    [
      'from fastapi import FastAPI',
      '',
      'app = FastAPI(title="pricing")',
      '',
      '',
      '@app.get("/api/pricing")',
      'def pricing() -> dict:',
      '    return {"tier": "standard"}',
      '',
      '',
      '@app.get("/api/pricing/quote")',
      'def quote() -> dict:',
      '    return {"tier": "standard", "seats": 5}',
      ''
    ].join('\n')
  );
  git('-c', 'user.email=demo@local.invalid', '-c', 'user.name=demo', 'add', '-A');
  git('-c', 'user.email=demo@local.invalid', '-c', 'user.name=demo', 'commit', '-m', 'c2: add owner detail chain and pricing quote');
  return dir;
}

/* ---------- 驱动（复用 ui_smoke.mjs 模式） ---------- */

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

function startServer(port, dataDir) {
  const child = spawn(process.execPath, [CLI, '--port', String(port), '--data-dir', dataDir, '--no-browser', '--no-watch'], {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, MHW_CP_HOST: '127.0.0.1' }
  });
  const stderr = { lines: [] };
  child.stderr.on('data', (c) => stderr.lines.push(String(c)));
  child.stdout.on('data', () => {});
  return { child, stderr };
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

async function waitRepoReady(base, repoId, timeoutMs = 180000) {
  const t0 = Date.now();
  for (;;) {
    try {
      const r = await fetch(`${base}/api/repos/${repoId}`);
      if (r.ok) {
        const { repo } = await r.json();
        if (repo?.status === 'ready') return repo;
        if (repo?.status === 'error') return repo;
      }
    } catch {
      /* retry */
    }
    if (Date.now() - t0 > timeoutMs) return null;
    await new Promise((r) => setTimeout(r, 500));
  }
}

async function loadChromium() {
  const mod = await import('playwright');
  const launch = async (executablePath) =>
    mod.chromium.launch({ headless: true, executablePath });
  try {
    return await launch(undefined);
  } catch (e) {
    // 版本不匹配时回退到 ms-playwright 缓存里已有的 chromium
    const cache = path.join(process.env.LOCALAPPDATA ?? '', 'ms-playwright');
    const candidates = fs
      .readdirSync(cache)
      .filter((d) => /^chromium-\d+$/.test(d))
      .sort()
      .reverse();
    for (const d of candidates) {
      const exe = path.join(cache, d, 'chrome-win', 'chrome.exe');
      if (!fs.existsSync(exe)) continue;
      try {
        return await launch(exe);
      } catch {
        /* try next */
      }
    }
    throw e;
  }
}

/**
 * 注意：不存在「自动开播的 Tour」——Canvas 底部的「步骤 X/Y」是 trace-strip
 * （trace-step-label），Top API 点击后链路自动加载，无需退 Tour。
 */

async function main() {
  if (!fs.existsSync(CLI)) throw new Error(`dist/cli.js 缺失——先 npm run build（${CLI}）`);
  fs.mkdirSync(OUT, { recursive: true });
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-shots-data-'));
  const repoDir = buildFixtureRepo();
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const srv = startServer(port, dataDir);
  let browser = null;
  const shot = async (page, name) => {
    const file = path.join(OUT, `${name}.png`);
    await page.screenshot({ path: file });
    const kb = (fs.statSync(file).size / 1024).toFixed(0);
    log(`✓ ${name}.png（${kb} KB）`);
  };
  try {
    if (!(await waitHealth(base))) {
      console.error(srv.stderr.lines.join('').split('\n').slice(-30).join('\n'));
      throw new Error('服务起不来');
    }
    const imp = await (
      await fetch(`${base}/api/repos`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ localPath: repoDir, name: 'demo-polyglot', branch: 'main' }),
        signal: AbortSignal.timeout(30000)
      })
    ).json();
    const repoId = imp.repo?.id;
    if (!repoId) throw new Error('导入失败：' + JSON.stringify(imp).slice(0, 300));
    const ready = await waitRepoReady(base, repoId);
    if (ready?.status !== 'ready') throw new Error(`索引未就绪：status=${ready?.status} error=${ready?.error ?? ''}`);
    log(`fixture 索引就绪（${ready.fileCount ?? '?'} files / ${ready.symbolCount ?? '?'} symbols）`);

    browser = await loadChromium();
    const page = await browser.newPage({ viewport: VIEWPORT });
    const settle = (ms = 2500) => page.waitForTimeout(ms);

    // 1. 拓扑概览：栈构成 / 规模 / 枢纽 / Top API 入口
    await page.goto(`${base}/?repo=${repoId}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForSelector('[data-testid="repo-overview"] [data-testid="scale-files"]', { state: 'visible', timeout: 30000 });
    await page.waitForSelector('[data-testid="api-entry"]', { timeout: 30000 }).catch(() => {});
    await settle();
    await shot(page, 'overview');

    // 2. 点 Top API 入口 → 聚焦卡片流（拓扑面的调用链形态：逐跳 file:line 锚点）
    const entry = await page.$('[data-testid="api-entry"]');
    if (entry) {
      await entry.click();
      await page.waitForSelector('[data-testid="trace-origin"]', { timeout: 15000 }).catch(() => {});
      await page.waitForSelector('[data-testid="flow-card"]', { timeout: 20000 }).catch(() => {});
      await page.$eval('[data-testid="flow-cards"]', (el) => el.scrollIntoView({ block: 'center' })).catch(() => {});
      await settle(2500);
      await shot(page, 'callchain');
    } else {
      log('⚠ api-entry 未出现，跳过 callchain');
    }

    // 2b. Onboarding Tour：优先「核心主业务流」（REST 端点→服务→数据层全链，多节点图）
    await page.goto(`${base}/?repo=${repoId}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForSelector('[data-testid^="tour-"]', { timeout: 20000 }).catch(() => {});
    const more = await page.$('[data-testid="more-tours-toggle"]');
    if (more) {
      await more.click();
      await page.waitForTimeout(400);
    }
    const mainFlow = page.locator('[data-testid^="tour-"]', { hasText: '主业务流' });
    const target = (await mainFlow.count()) ? mainFlow.first() : page.locator('[data-testid^="tour-"]').first();
    if ((await target.count()) > 0) {
      await target.click();
      const rendered = await page
        .waitForSelector('[data-testid="mermaid-svg"] svg', { timeout: 20000 })
        .then(() => true)
        .catch(() => false);
      const fallbackShown = await page.$('[data-testid="mermaid-fallback"]').then((h) => Boolean(h));
      const emptyTour = await page
        .$eval('[data-testid="mermaid-svg"]', (el) => (el.textContent || '').includes('暂无匹配'))
        .catch(() => false);
      if (!rendered || fallbackShown || emptyTour) {
        log(`⚠ tour 图未正常渲染（rendered=${rendered} fallback=${fallbackShown} empty=${emptyTour}），跳过 tour`);
      } else {
        await settle(2000);
        await shot(page, 'tour');
      }
    } else {
      log('⚠ 侧栏无 tour 入口，跳过 tour');
    }

    // 3. 体检面：五桶 + 精度态势
    await page.goto(`${base}/?repo=${repoId}&mode=scan`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForSelector('[data-testid="scan-bucket-orphanedPublic"]', { state: 'visible', timeout: 30000 });
    await settle();
    await shot(page, 'scan');

    // 4. Diff 影响面：HEAD~1 → HEAD
    // 已知缺陷（2026-10-14 实测）：delta.mermaid 自带 ```mermaid 围栏且 linkStyle 含
    // 无效的 color: 属性，mermaid.render 双阻断 → 差异图恒走 mermaid-fallback 源码态。
    // 本截图保留为该面的实况记录；修复前不入 README。
    await page.goto(`${base}/?repo=${repoId}&mode=delta`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForSelector('[data-testid="delta-run"]', { state: 'visible', timeout: 15000 });
    await page.fill('[data-testid="delta-base"]', 'HEAD~1');
    await page.fill('[data-testid="delta-head"]', 'HEAD');
    await page.click('[data-testid="delta-run"]');
    await page
      .waitForSelector('[data-testid="delta-added"], [data-testid="delta-impact"], [data-testid="delta-diagram"]', {
        state: 'visible',
        timeout: 60000
      })
      .catch(() => log('⚠ delta 结果区未出现（仍截图当前态）'));
    await settle();
    await shot(page, 'delta');

    // 5. Inspector：点路由项 → 源码 + 锚点
    await page.goto(`${base}/?repo=${repoId}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    const route = await page.waitForSelector('[data-testid="route-item"]', { timeout: 20000 }).catch(() => null);
    if (route) {
      await route.click();
      await page.waitForSelector('[data-testid="inspector"]', { state: 'visible', timeout: 15000 });
      await settle(3000);
      await shot(page, 'inspector');
    } else {
      log('⚠ route-item 未出现，跳过 inspector');
    }

    log('全部完成 → ' + OUT);
  } finally {
    if (browser) await browser.close().catch(() => {});
    if (srv.child.exitCode === null && srv.child.signalCode === null) {
      srv.child.kill();
      await new Promise((r) => srv.child.once('exit', r)).catch(() => {});
    }
    for (const dir of [dataDir, repoDir]) {
      try {
        fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
      } catch {
        log(`清理遗留（可忽略）：${dir}`);
      }
    }
  }
}

main().catch((e) => {
  console.error('[shots] FAILED:', e);
  process.exit(1);
});
