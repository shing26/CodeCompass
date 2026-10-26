/**
 * v1.7 — 工件浏览器验收（Artifact Browser Gate）。
 *
 * 用真实 Chromium 打开单文件 HTML 工件，回答一个问题：**它在读者浏览器里能不能用**。
 * 只验「可渲染 / 可交互 / 无运行时错误 / 无外部依赖」，不验正文语义是否正确
 * （锚点是否存在属于 v1.5 verification 回执的事，ADR-0023）。
 *
 * 用法：
 *   node scripts/smoke/artifact_browser_check.mjs <artifact.html> [--out <receipt.json>] [--json]
 *   node scripts/smoke/artifact_browser_check.mjs --self-test
 *
 * 退出码（fail-closed）：
 *   0 = PASS        全部检查通过，回执 verdict=PASS
 *   1 = FAIL        有检查失败，回执 verdict=FAIL，diagnostics 逐条给 check+code+selector
 *   2 = UNCHECKED   无法下结论（无 playwright / 浏览器起不来 / 超时 / 工件读不到 / 内部错误）
 *                   —— 2 不是成功，任何消费方不得当成绿。
 *
 * 环境接缝（与 ui_smoke.mjs 一致）：SMOKE_PW_MODULE / SMOKE_CHROMIUM_PATH。
 */
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SCHEMA = 'codecompass/artifact-browser-check@1';
const VIEWPORT = { width: 1440, height: 900 };
const DIAGRAM_TIMEOUT_MS = 10000;
const EXIT = { PASS: 0, FAIL: 1, UNCHECKED: 2 };

const DIAGNOSTIC_CODES = new Set([
  'ARTIFACT_UNREADABLE',
  'ARTIFACT_NOT_SELF_CONTAINED',
  'MERMAID_CDN_FALLBACK',
  'DIAGRAM_SVG_EMPTY',
  'DIAGRAM_SYNTAX_ERROR',
  'VIEW_NOT_RENDERED',
  'STORY_BEATS_STUCK',
  'DEEPLINK_EMPTY',
  'PAGE_ERROR',
  'CONSOLE_ERROR',
  'EXTERNAL_REQUEST',
  'CHECK_TIMEOUT',
  'BROWSER_UNAVAILABLE',
  'INTERNAL_ERROR',
  // v1.7 评审（Standards 轴）补：目标节点失踪时不许静默 SKIP，
  // release 门用 --require-full 把任何 SKIPPED 直接判红。
  'DIAGRAM_TARGET_MISSING',
  'CHECK_SKIPPED'
]);

function log(line) {
  console.log(line);
}

/** 回执里的路径：仓库相对、正斜杠；跨盘符时退化为绝对路径（同样正斜杠）。 */
function displayPath(p) {
  return path.relative(ROOT, path.resolve(p)).replace(/\\/g, '/');
}

function readVersion() {
  // 回执要带引擎版本；这里读单一源，不硬编码（version.ts 的纪律）。
  try {
    const text = fs.readFileSync(path.join(ROOT, 'services', 'control-plane', 'src', 'version.ts'), 'utf8');
    const m = text.match(/VERSION = '([^']+)'/);
    return m ? m[1] : 'unknown';
  } catch {
    return 'unknown';
  }
}

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
  return null;
}

async function launchChromium(chromium) {
  const opts = { headless: true };
  if (process.env.SMOKE_CHROMIUM_PATH) opts.executablePath = process.env.SMOKE_CHROMIUM_PATH;
  try {
    return await chromium.launch(opts);
  } catch {
    // 版本不匹配时回退 ms-playwright 缓存（与 readme-shots.mjs 同一策略）。
    const cache = path.join(process.env.LOCALAPPDATA || os.homedir(), 'ms-playwright');
    if (!fs.existsSync(cache)) return null;
    const dirs = fs
      .readdirSync(cache)
      .filter((d) => /^chromium-\d+$/.test(d))
      .sort()
      .reverse();
    for (const d of dirs) {
      const exe = path.join(cache, d, 'chrome-win', 'chrome.exe');
      if (!fs.existsSync(exe)) continue;
      try {
        return await chromium.launch({ ...opts, executablePath: exe });
      } catch {
        /* try next */
      }
    }
    return null;
  }
}

function diagnostic(check, code, message, extra) {
  const d = { check, code, message };
  if (extra && extra.selector) d.selector = extra.selector;
  if (extra && extra.evidence) d.evidence = extra.evidence;
  return d;
}

function check(id, status, evidence, diagnostics) {
  const entry = { id, status, evidence: evidence || {} };
  if (diagnostics && diagnostics.length) entry.diagnostics = diagnostics;
  return entry;
}

/** 静态自包含扫描：任何 http(s) 外链脚本/样式都意味着脱网即废。 */
function staticSelfContained(html) {
  const externalScript = /<script[^>]+src=["']https?:/i.test(html);
  const externalStyle = /<link[^>]+href=["']https?:/i.test(html);
  const cdnFallback =
    html.includes('data-check="offline-warning"') || html.includes('class="offline-warning"');
  return { externalScript, externalStyle, cdnFallback };
}

async function runChecks(browser, artifactPath, options = {}) {
  const checks = [];
  const diagnostics = [];
  const html = await fsp.readFile(artifactPath, 'utf8');
  const stat = await fsp.stat(artifactPath);
  const sha256 = crypto.createHash('sha256').update(html).digest('hex');

  checks.push(check('artifact/readable', 'PASS', { bytes: stat.size, sha256 }));

  const staticScan = staticSelfContained(html);
  checks.push(
    check(
      'artifact/self-contained',
      staticScan.externalScript || staticScan.externalStyle ? 'FAIL' : 'PASS',
      staticScan,
      staticScan.externalScript || staticScan.externalStyle
        ? [diagnostic('artifact/self-contained', 'ARTIFACT_NOT_SELF_CONTAINED', 'artifact references external script/style URLs')]
        : []
    )
  );

  const context = await browser.newContext({ viewport: VIEWPORT, offline: true });
  const page = await context.newPage();
  const pageErrors = [];
  const consoleErrors = [];
  const externalRequests = [];
  page.on('pageerror', (e) => pageErrors.push(String(e).split('\n')[0].slice(0, 200)));
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 200));
  });
  await page.route('**/*', (route) => {
    const url = route.request().url();
    if (url.startsWith('file:') || url.startsWith('data:') || url.startsWith('blob:')) return route.continue();
    externalRequests.push(url.slice(0, 200));
    return route.abort();
  });

  let domEvidence = {};
  try {
    const fileUrl = 'file:///' + artifactPath.replace(/\\/g, '/').replace(/^\//, '');
    await page.goto(fileUrl, { waitUntil: 'load', timeout: DIAGRAM_TIMEOUT_MS });
    // startOnLoad 的 mermaid 是异步的：等图渲染稳定（或超时），不靠固定 sleep。
    await page
      .waitForFunction(
        () => {
          const visible = (el) => el.offsetParent !== null;
          const hooked = Array.from(document.querySelectorAll('[data-check="diagram"]'));
          const nodes = (hooked.length ? hooked : Array.from(document.querySelectorAll('.mermaid'))).filter(visible);
          return nodes.length > 0 && nodes.every((n) => n.querySelector('svg'));
        },
        null,
        { timeout: DIAGRAM_TIMEOUT_MS }
      )
      .catch(() => {});

    domEvidence = await page.evaluate(() => {
      const visible = (el) => el.offsetParent !== null;
      const hooked = Array.from(document.querySelectorAll('[data-check="diagram"]'));
      const nodes = (hooked.length ? hooked : Array.from(document.querySelectorAll('.mermaid'))).filter(visible);
      const rendered = nodes.map((n) => {
        const svg = n.querySelector('svg');
        const box = svg ? n.getBoundingClientRect() : null;
        return {
          svg: Boolean(svg),
          width: box ? Math.round(box.width) : 0,
          height: box ? Math.round(box.height) : 0
        };
      });
      // 记录实际命中的 selector 形态：钩子优先、类名/id 只作回退（票 05 验收）。
      const beatRoot = document.querySelector('[data-check="story-beats"]');
      const beatFallback = document.getElementById('story-beats');
      return {
        visibleMermaid: rendered,
        syntaxError: /Syntax error/i.test(document.body.innerText),
        offlineWarning: Boolean(document.querySelector('[data-check="offline-warning"]') || document.querySelector('.offline-warning')),
        hasSequenceTab: Boolean(document.querySelector('.tab[data-view="sequence"]')),
        hasBeats: Boolean(beatRoot || beatFallback),
        hasDeeplink: Boolean(document.querySelector('[data-check="deeplink"] a') || document.querySelector('.deeplink a')),
        selectors: {
          diagram: hooked.length ? '[data-check="diagram"]' : '.mermaid',
          sequence: document.querySelector('[data-check="view-sequence"]')
            ? '[data-check="view-sequence"]'
            : '#view-sequence',
          beats: beatRoot ? '[data-check="story-beats"]' : '#story-beats',
          deeplink: document.querySelector('[data-check="deeplink"] a')
            ? '[data-check="deeplink"] a'
            : '.deeplink a'
        }
      };
    });
  } catch (e) {
    checks.push(check('diagram/svg-rendered', 'UNCHECKED', {}, [
      diagnostic('diagram/svg-rendered', 'CHECK_TIMEOUT', 'page did not become inspectable: ' + String(e).slice(0, 160))
    ]));
    await context.close();
    return { checks, diagnostics, pageErrors, consoleErrors, externalRequests, sha256, bytes: stat.size };
  }

  if (domEvidence.offlineWarning) {
    // 同一判断的两条证据面（静态扫描 + DOM 标记）合并成一条 check，
    // 不重复追加同 id 条目——回执的 checks 是集合，不是流水账。
    checks[1] = check('artifact/self-contained', 'FAIL', { ...staticScan, cdnFallback: true }, [
      ...(checks[1].diagnostics || []),
      diagnostic('artifact/self-contained', 'MERMAID_CDN_FALLBACK', 'artifact falls back to the mermaid CDN; offline readers see no diagram')
    ]);
  } else if (checks[1].status === 'PASS') {
    checks[1] = check('artifact/self-contained', 'PASS', { ...staticScan, cdnFallback: false });
  }

  // diagram/svg-rendered —— 只要求「当前可见」的图渲染出非零尺寸 SVG。
  const badNodes = domEvidence.visibleMermaid.filter((n) => !n.svg || n.width <= 4 || n.height <= 4);
  const claimsDiagrams = html.includes('data-check="diagram"') || html.includes('class="mermaid"');
  if (domEvidence.visibleMermaid.length === 0) {
    // 模板声称有图、DOM 里却找不到可见容器 = 钩子/类名漂移，不得静默 SKIP。
    if (claimsDiagrams) {
      checks.push(check('diagram/svg-rendered', 'FAIL', { selector: domEvidence.selectors.diagram }, [
        diagnostic('diagram/svg-rendered', 'DIAGRAM_TARGET_MISSING', 'artifact claims a diagram but exposes no visible diagram container', { selector: domEvidence.selectors.diagram })
      ]));
    } else {
      checks.push(check('diagram/svg-rendered', 'SKIPPED', { reason: 'artifact has no diagram at all' }));
    }
  } else if (domEvidence.syntaxError) {
    checks.push(check('diagram/svg-rendered', 'FAIL', { visibleMermaid: domEvidence.visibleMermaid }, [
      diagnostic('diagram/svg-rendered', 'DIAGRAM_SYNTAX_ERROR', 'rendered diagram contains a mermaid syntax error', { selector: domEvidence.selectors.diagram })
    ]));
  } else if (badNodes.length > 0) {
    checks.push(check('diagram/svg-rendered', 'FAIL', { visibleMermaid: domEvidence.visibleMermaid }, [
      diagnostic('diagram/svg-rendered', 'DIAGRAM_SVG_EMPTY', 'a visible diagram container has no non-zero SVG', { selector: domEvidence.selectors.diagram })
    ]));
  } else {
    checks.push(check('diagram/svg-rendered', 'PASS', { containers: domEvidence.visibleMermaid.length, selector: domEvidence.selectors.diagram }));
  }

  // diagram/lazy-view —— 切到 Sequence 后必须出现非零宽 SVG（v0.9 lazy render 事故点）。
  if (!domEvidence.hasSequenceTab) {
    checks.push(check('diagram/lazy-view', 'SKIPPED', { reason: 'artifact has no sequence tab' }));
  } else {
    await page.evaluate(() => document.querySelector('.tab[data-view="sequence"]').click());
    await page
      .waitForFunction(
        () => {
          const view = document.querySelector('[data-check="view-sequence"]') || document.getElementById('view-sequence');
          if (!view || getComputedStyle(view).display === 'none') return false;
          const svg = view.querySelector('svg');
          if (!svg) return false;
          const box = svg.getBoundingClientRect();
          return box.width > 4 && box.height > 4;
        },
        null,
        { timeout: DIAGRAM_TIMEOUT_MS }
      )
      .catch(() => {});
    const lazy = await page.evaluate(() => {
      const view = document.querySelector('[data-check="view-sequence"]') || document.getElementById('view-sequence');
      const svg = view ? view.querySelector('svg') : null;
      const box = view ? view.getBoundingClientRect() : null;
      return {
        viewVisible: view ? getComputedStyle(view).display !== 'none' : false,
        hasSvg: Boolean(svg),
        width: box ? Math.round(box.width) : 0,
        height: box ? Math.round(box.height) : 0,
        svgWidth: svg ? Math.round(svg.getBoundingClientRect().width) : 0,
        svgHeight: svg ? Math.round(svg.getBoundingClientRect().height) : 0,
        selector: view && view.getAttribute('data-check') ? '[data-check="view-sequence"]' : '#view-sequence'
      };
    });
    const ok = lazy.viewVisible && lazy.hasSvg && lazy.svgWidth > 4 && lazy.svgHeight > 4;
    checks.push(
      check('diagram/lazy-view', ok ? 'PASS' : 'FAIL', lazy, ok ? [] : [
        diagnostic('diagram/lazy-view', 'VIEW_NOT_RENDERED', 'sequence view did not render a non-zero diagram after activation', { selector: lazy.selector })
      ])
    );
  }

  // story-beats/step —— 存在步进条时，初始 label 必须有内容且 Next 能推进。
  if (!domEvidence.hasBeats) {
    checks.push(check('story-beats/step', 'SKIPPED', { reason: 'artifact has no story-beats block' }));
  } else {
    const beats = await page.evaluate(async () => {
      const root = document.querySelector('[data-check="story-beats"]') || document.getElementById('story-beats') || document;
      const label = root.querySelector('#beat-label') || document.getElementById('beat-label');
      const counter = root.querySelector('#beat-counter') || document.getElementById('beat-counter');
      const next = root.querySelector('#beat-next') || document.getElementById('beat-next');
      const prev = root.querySelector('#beat-prev') || document.getElementById('beat-prev');
      const initial = { label: label ? label.textContent : '', counter: counter ? counter.textContent : '' };
      if (!next || !label) return { initial, advanced: false, returned: false, missing: true };
      next.click();
      await new Promise((r) => setTimeout(r, 120));
      const after = { label: label.textContent, counter: counter.textContent };
      if (prev) prev.click();
      await new Promise((r) => setTimeout(r, 120));
      const back = { label: label.textContent, counter: counter.textContent };
      return {
        initial,
        after,
        back,
        // spec：点 Next 后 `.beat-label` 文本必须变化；counter 单独变不算
        // （label 卡死正是 v1.4 事故形态）。
        advanced: after.label !== initial.label,
        returned: back.label === initial.label && back.counter === initial.counter
      };
    });
    const single = /\/\s*1\s*$/.test(beats.initial.counter || '');
    if (single) {
      checks.push(check('story-beats/step', 'SKIPPED', { reason: 'single story beat, nothing to advance', counter: beats.initial.counter }));
    } else {
      const ok = Boolean(beats.initial.label) && beats.advanced && beats.returned;
      checks.push(check('story-beats/step', ok ? 'PASS' : 'FAIL', beats, ok ? [] : [
        diagnostic('story-beats/step', 'STORY_BEATS_STUCK', 'story beats did not advance/return as authored', { selector: domEvidence.selectors.beats + ' .beat-bar' })
      ]));
    }
  }

  // deeplink/non-empty —— 只验地址存在且 scheme 合法，不请求网络。
  const href = await page.evaluate(() => {
    const a =
      document.querySelector('[data-check="deeplink"] a') ||
      document.querySelector('.deeplink a') ||
      document.querySelector('a[href^="http"]');
    return a ? a.getAttribute('href') : null;
  });
  if (!domEvidence.hasDeeplink && !href) {
    checks.push(check('deeplink/non-empty', 'SKIPPED', { reason: 'artifact has no deeplink anchor and no http anchor' }));
  } else {
    const ok = typeof href === 'string' && /^https?:\/\//i.test(href);
    checks.push(check('deeplink/non-empty', ok ? 'PASS' : 'FAIL', { href: href || '', selector: domEvidence.selectors.deeplink }, ok ? [] : [
      diagnostic('deeplink/non-empty', 'DEEPLINK_EMPTY', 'deeplink anchor is empty or not http(s)', { selector: domEvidence.selectors.deeplink })
    ]));
  }

  // runtime — 页面异常 / console error / 外部请求，三条都 fail-closed。
  checks.push(check('runtime/no-pageerror', pageErrors.length === 0 ? 'PASS' : 'FAIL', { count: pageErrors.length, sample: pageErrors.slice(0, 3) }, pageErrors.length === 0 ? [] : [
    diagnostic('runtime/no-pageerror', 'PAGE_ERROR', 'page raised ' + pageErrors.length + ' error(s)')
  ]));
  checks.push(check('runtime/no-console-error', consoleErrors.length === 0 ? 'PASS' : 'FAIL', { count: consoleErrors.length, sample: consoleErrors.slice(0, 3) }, consoleErrors.length === 0 ? [] : [
    diagnostic('runtime/no-console-error', 'CONSOLE_ERROR', 'console.error fired ' + consoleErrors.length + ' time(s)')
  ]));
  checks.push(check('runtime/no-network', externalRequests.length === 0 ? 'PASS' : 'FAIL', { count: externalRequests.length, sample: externalRequests.slice(0, 3) }, externalRequests.length === 0 ? [] : [
    diagnostic('runtime/no-network', 'EXTERNAL_REQUEST', 'artifact requested ' + externalRequests.length + ' external resource(s)')
  ]));

  // --require-full：release 工件必须把整套检查都跑出结论；任何 SKIPPED 都判红。
  // ADR-0023 决定 5：钩子/模板漂移时静默 SKIP 比红更糟，release 工件没有 N/A 可辩。
  if (options.requireFull) {
    for (let i = 0; i < checks.length; i += 1) {
      if (checks[i].status !== 'SKIPPED') continue;
      const reason = (checks[i].evidence && checks[i].evidence.reason) || 'no reason recorded';
      checks[i] = check(checks[i].id, 'FAIL', checks[i].evidence, [
        diagnostic(checks[i].id, 'CHECK_SKIPPED', '--require-full: check skipped (' + reason + ')')
      ]);
    }
  }

  for (const entry of checks) {
    if (entry.diagnostics) diagnostics.push(...entry.diagnostics);
  }
  await context.close();
  return { checks, diagnostics, sha256, bytes: stat.size };
}

function buildReceipt(artifactPath, result, browserInfo, startedAt) {
  const failed = result.checks.some((c) => c.status === 'FAIL');
  const unchecked = result.checks.some((c) => c.status === 'UNCHECKED');
  const verdict = failed ? 'FAIL' : unchecked ? 'UNCHECKED' : 'PASS';
  return {
    schema: SCHEMA,
    engineVersion: readVersion(),
    checkedAt: new Date().toISOString(),
    verdict,
    artifact: {
      path: displayPath(artifactPath),
      bytes: result.bytes,
      sha256: result.sha256
    },
    browser: browserInfo,
    checks: result.checks,
    diagnostics: result.diagnostics,
    durationMs: Date.now() - startedAt
  };
}

async function checkArtifact(artifactPath, options = {}) {
  const startedAt = Date.now();
  let html;
  try {
    html = await fsp.readFile(artifactPath, 'utf8');
  } catch (e) {
    return {
      exit: EXIT.UNCHECKED,
      receipt: {
        schema: SCHEMA,
        engineVersion: readVersion(),
        checkedAt: new Date().toISOString(),
        verdict: 'UNCHECKED',
        artifact: { path: displayPath(artifactPath), bytes: null, sha256: null },
        browser: null,
        checks: [check('artifact/readable', 'UNCHECKED', {}, [
          diagnostic('artifact/readable', 'ARTIFACT_UNREADABLE', 'cannot read artifact: ' + String(e).slice(0, 160))
        ])],
        diagnostics: [diagnostic('artifact/readable', 'ARTIFACT_UNREADABLE', 'cannot read artifact: ' + String(e).slice(0, 160))],
        durationMs: Date.now() - startedAt
      }
    };
  }
  if (!/^\s*<!DOCTYPE html>/i.test(html)) {
    return {
      exit: EXIT.FAIL,
      receipt: {
        schema: SCHEMA,
        engineVersion: readVersion(),
        checkedAt: new Date().toISOString(),
        verdict: 'FAIL',
        artifact: { path: displayPath(artifactPath), bytes: Buffer.byteLength(html), sha256: crypto.createHash('sha256').update(html).digest('hex') },
        browser: null,
        checks: [check('artifact/readable', 'FAIL', { bytes: Buffer.byteLength(html) }, [
          diagnostic('artifact/readable', 'ARTIFACT_UNREADABLE', 'artifact does not start with <!DOCTYPE html>')
        ])],
        diagnostics: [diagnostic('artifact/readable', 'ARTIFACT_UNREADABLE', 'artifact does not start with <!DOCTYPE html>')],
        durationMs: Date.now() - startedAt
      }
    };
  }

  const chromium = await loadChromium();
  if (!chromium) {
    return {
      exit: EXIT.UNCHECKED,
      receipt: {
        schema: SCHEMA,
        engineVersion: readVersion(),
        checkedAt: new Date().toISOString(),
        verdict: 'UNCHECKED',
        artifact: { path: displayPath(artifactPath), bytes: Buffer.byteLength(html), sha256: crypto.createHash('sha256').update(html).digest('hex') },
        browser: null,
        checks: [check('runtime/browser', 'UNCHECKED', {}, [
          diagnostic('runtime/browser', 'BROWSER_UNAVAILABLE', 'playwright/chromium not resolvable (set SMOKE_PW_MODULE / SMOKE_CHROMIUM_PATH)')
        ])],
        diagnostics: [diagnostic('runtime/browser', 'BROWSER_UNAVAILABLE', 'playwright/chromium not resolvable (set SMOKE_PW_MODULE / SMOKE_CHROMIUM_PATH)')],
        durationMs: Date.now() - startedAt
      }
    };
  }

  const browser = await launchChromium(chromium);
  if (!browser) {
    return {
      exit: EXIT.UNCHECKED,
      receipt: {
        schema: SCHEMA,
        engineVersion: readVersion(),
        checkedAt: new Date().toISOString(),
        verdict: 'UNCHECKED',
        artifact: { path: displayPath(artifactPath), bytes: Buffer.byteLength(html), sha256: crypto.createHash('sha256').update(html).digest('hex') },
        browser: null,
        checks: [check('runtime/browser', 'UNCHECKED', {}, [
          diagnostic('runtime/browser', 'BROWSER_UNAVAILABLE', 'chromium executable could not be launched')
        ])],
        diagnostics: [diagnostic('runtime/browser', 'BROWSER_UNAVAILABLE', 'chromium executable could not be launched')],
        durationMs: Date.now() - startedAt
      }
    };
  }

  try {
    const result = await runChecks(browser, artifactPath, options);
    const browserInfo = { name: 'chromium', version: browser.version(), viewport: VIEWPORT, offline: true };
    const receipt = buildReceipt(artifactPath, result, browserInfo, startedAt);
    const exit = receipt.verdict === 'PASS' ? EXIT.PASS : receipt.verdict === 'FAIL' ? EXIT.FAIL : EXIT.UNCHECKED;
    return { exit, receipt };
  } catch (e) {
    const message = 'internal error: ' + String(e).slice(0, 200);
    return {
      exit: EXIT.UNCHECKED,
      receipt: {
        schema: SCHEMA,
        engineVersion: readVersion(),
        checkedAt: new Date().toISOString(),
        verdict: 'UNCHECKED',
        artifact: { path: displayPath(artifactPath), bytes: Buffer.byteLength(html), sha256: crypto.createHash('sha256').update(html).digest('hex') },
        browser: { name: 'chromium', version: browser.version(), viewport: VIEWPORT, offline: true },
        checks: [check('runtime/internal', 'UNCHECKED', {}, [diagnostic('runtime/internal', 'INTERNAL_ERROR', message)])],
        diagnostics: [diagnostic('runtime/internal', 'INTERNAL_ERROR', message)],
        durationMs: Date.now() - startedAt
      }
    };
  } finally {
    await browser.close();
  }
}

async function writeReceipt(artifactPath, receiptPath, receipt) {
  const target = receiptPath || artifactPath + '.browser-check.json';
  await fsp.writeFile(target, JSON.stringify(receipt, null, 2) + '\n', 'utf8');
  return target;
}

function summarize(receipt) {
  const counts = { PASS: 0, FAIL: 0, UNCHECKED: 0, SKIPPED: 0 };
  for (const c of receipt.checks) counts[c.status] = (counts[c.status] || 0) + 1;
  return {
    verdict: receipt.verdict,
    checks: receipt.checks.length,
    pass: counts.PASS,
    fail: counts.FAIL,
    unchecked: counts.UNCHECKED,
    skipped: counts.SKIPPED,
    diagnostics: receipt.diagnostics.length,
    durationMs: receipt.durationMs
  };
}

function assertReceiptShape(receipt) {
  const problems = [];
  if (receipt.schema !== SCHEMA) problems.push('schema');
  if (!receipt.engineVersion) problems.push('engineVersion');
  if (!['PASS', 'FAIL', 'UNCHECKED'].includes(receipt.verdict)) problems.push('verdict');
  if (!receipt.artifact || typeof receipt.artifact.path !== 'string') problems.push('artifact.path');
  if (!Array.isArray(receipt.checks) || receipt.checks.length === 0) problems.push('checks');
  if (!Array.isArray(receipt.diagnostics)) problems.push('diagnostics');
  const ids = (receipt.checks || []).map((c) => c.id);
  if (new Set(ids).size !== ids.length) problems.push('duplicate check ids');
  for (const c of receipt.checks || []) {
    if (!c.id || !['PASS', 'FAIL', 'UNCHECKED', 'SKIPPED'].includes(c.status)) problems.push('check:' + (c.id || '?'));
    for (const d of c.diagnostics || []) if (!DIAGNOSTIC_CODES.has(d.code)) problems.push('diag code:' + d.code);
  }
  const hasUnchecked = (receipt.checks || []).some((c) => c.status === 'UNCHECKED');
  if (hasUnchecked && receipt.verdict === 'PASS') problems.push('verdict/checks disagreement');
  for (const d of receipt.diagnostics || []) if (!DIAGNOSTIC_CODES.has(d.code)) problems.push('diag code:' + d.code);
  const hasFail = (receipt.checks || []).some((c) => c.status === 'FAIL');
  if (hasFail && receipt.verdict !== 'FAIL') problems.push('verdict/checks disagreement');
  if (!hasFail && receipt.verdict === 'FAIL') problems.push('verdict/checks disagreement');
  return problems;
}

async function selfTest() {
  const fixtures = await import('./make-artifact-fixtures.mjs');
  const dir = fixtures.makeFixtures(path.join(os.tmpdir(), 'codecompass-artifact-gate-selftest'));
  const expectations = [
    ['good', dir.good, 'PASS', []],
    ['bad-syntax', dir['bad-syntax.html'], 'FAIL', ['DIAGRAM_SYNTAX_ERROR']],
    ['bad-lazy', dir['bad-lazy.html'], 'FAIL', ['VIEW_NOT_RENDERED']],
    ['bad-beats', dir['bad-beats.html'], 'FAIL', ['STORY_BEATS_STUCK']]
  ];
  let failures = 0;
  for (const [name, file, expectedVerdict, expectedCodes] of expectations) {
    const { exit, receipt } = await checkArtifact(file, { requireFull: true });
    const shapeProblems = assertReceiptShape(receipt);
    const codes = receipt.diagnostics.map((d) => d.code);
    const verdictOk = receipt.verdict === expectedVerdict;
    const codesOk = expectedCodes.every((c) => codes.includes(c));
    const exitOk = exit === (expectedVerdict === 'PASS' ? EXIT.PASS : expectedVerdict === 'FAIL' ? EXIT.FAIL : EXIT.UNCHECKED);
    const ok = verdictOk && codesOk && exitOk && shapeProblems.length === 0;
    if (!ok) failures += 1;
    log((ok ? '  PASS ' : '  FAIL ') + name + ' :: verdict=' + receipt.verdict + ' exit=' + exit + ' codes=' + JSON.stringify(codes).slice(0, 160) +
      (shapeProblems.length ? ' shape=' + JSON.stringify(shapeProblems) : ''));
  }
  // 回执自己也要有门：构造畸形回执，assertReceiptShape 必须判红（票 03 验收）。
  const malformed = [
    ['duplicate check ids', { schema: SCHEMA, engineVersion: 'x', verdict: 'PASS', artifact: { path: 'a' }, checks: [{ id: 'a', status: 'PASS' }, { id: 'a', status: 'PASS' }], diagnostics: [] }],
    ['unknown diagnostic code', { schema: SCHEMA, engineVersion: 'x', verdict: 'PASS', artifact: { path: 'a' }, checks: [{ id: 'a', status: 'PASS' }], diagnostics: [{ check: 'a', code: 'NOPE', message: 'm' }] }],
    ['verdict disagrees with checks', { schema: SCHEMA, engineVersion: 'x', verdict: 'PASS', artifact: { path: 'a' }, checks: [{ id: 'a', status: 'FAIL' }], diagnostics: [] }]
  ];
  for (const [name, evil] of malformed) {
    const caught = assertReceiptShape(evil).length > 0;
    if (!caught) failures += 1;
    log((caught ? '  PASS ' : '  FAIL ') + 'receipt-negative :: ' + name + ' -> ' + (caught ? 'caught' : 'NOT CAUGHT'));
  }

  if (failures > 0) {
    console.error('artifact-browser-check self-test: ' + failures + ' expectation(s) failed');
    return EXIT.FAIL;
  }
  log('artifact-browser-check self-test: all expectations passed');
  return EXIT.PASS;
}

async function main(argv) {
  const positional = [];
  let out = null;
  let json = false;
  let self = false;
  let requireFull = false;
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--out') out = argv[++i];
    else if (a === '--json') json = true;
    else if (a === '--self-test') self = true;
    else if (a === '--require-full') requireFull = true;
    else if (a.startsWith('--')) {
      console.error('unknown flag: ' + a);
      return EXIT.UNCHECKED;
    } else positional.push(a);
  }

  if (self) return selfTest();
  if (positional.length !== 1) {
    console.error('usage: node scripts/smoke/artifact_browser_check.mjs <artifact.html> [--out <receipt.json>] [--json] [--require-full]');
    console.error('       node scripts/smoke/artifact_browser_check.mjs --self-test');
    console.error('');
    console.error('note: <artifact.html> 是占位符——PowerShell 里 < 会被当成重定向。传真实路径并加引号，例如：');
    console.error('      node scripts/smoke/artifact_browser_check.mjs "$env:TEMP\\codecompass-artifact-fixtures\\good.html" --json');
    return EXIT.UNCHECKED;
  }

  const artifactPath = path.resolve(positional[0]);
  const { exit, receipt } = await checkArtifact(artifactPath, { requireFull });
  let receiptPath = null;
  try {
    receiptPath = await writeReceipt(artifactPath, out, receipt);
  } catch (e) {
    console.error('artifact-browser-check: failed to write receipt: ' + String(e).slice(0, 160));
  }
  const summary = summarize(receipt);
  if (json) {
    log(JSON.stringify({ ...summary, receipt: receiptPath, artifact: receipt.artifact.path }));
  } else {
    log('artifact-browser-check: ' + receipt.verdict + ' :: ' + receipt.artifact.path);
    for (const c of receipt.checks) {
      log('  ' + (c.status === 'PASS' ? '✓' : c.status === 'SKIPPED' ? '-' : '✗') + ' ' + c.id + ' :: ' + c.status);
    }
    for (const d of receipt.diagnostics) log('  ! ' + d.check + ' ' + d.code + ' — ' + d.message);
    log('  receipt: ' + (receiptPath || '(not written)'));
  }
  return exit;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((e) => {
      console.error('artifact-browser-check: fatal: ' + String(e));
      process.exit(EXIT.UNCHECKED);
    });
}
