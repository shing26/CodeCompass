// v0.27 用户报「越改越退化」全功能面回归走查（dev 前端 5173 + API 43110）。
// 逐视图+关键交互断言，收集 FAIL；网络 4xx/5xx 与 console/pageerror 全量哨兵。
const { chromium } = await import('file:///D:/zcode-tmp/pw/node_modules/playwright-core/index.mjs');
const BASE = 'http://localhost:5173';
const API = 'http://127.0.0.1:43110';
const EXEC = 'C:/Users/Shing/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe';

const failures = [];
const notes = [];
function ok(label, cond, extra) {
  if (cond) console.log('  ✓', label, extra ?? '');
  else { console.log('  ✗ FAIL', label, extra ?? ''); failures.push(label + (extra ? ' :: ' + extra : '')); }
}
function info(label, v) { console.log('  ·', label, v); notes.push(label + ': ' + v); }

const browser = await chromium.launch({ executablePath: EXEC, headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + String(e.message || e).slice(0, 250)));
page.on('console', (m) => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text().slice(0, 250)); });
page.on('requestfailed', (r) => { if (r.url().includes('/api/')) errors.push('REQFAIL: ' + r.url()); });
page.on('response', (res) => { if (res.url().includes('/api/') && res.status() >= 400) errors.push('HTTP ' + res.status() + ' ' + res.url().replace(API, '')); });

const click = async (sel, ms = 250) => { await page.locator(sel).first().dispatchEvent('click'); await page.waitForTimeout(ms); };
const visible = async (sel, ms = 2500) => { try { await page.waitForSelector(sel, { state: 'visible', timeout: ms }); return true; } catch { return false; } };

const repoRes = await (await fetch(`${API}/api/repos`)).json();
const repo = repoRes.repos.find((r) => r.status === 'ready');
const RID = repo.id;
console.log('repo =', repo.name, RID);

// ---------- A 首屏（无库） ----------
console.log('--- A. 首屏（无库） ---');
await page.goto(BASE + '/', { waitUntil: 'networkidle', timeout: 20000 });
ok('empty-state 渲染', await visible('[data-testid="empty-state"]'));
ok('footer-status 渲染', await visible('[data-testid="footer-status"]'));

// ---------- B 选库主视图 ----------
console.log('--- B. 选库 / 拓扑 ---');
await page.goto(BASE + '/?repo=' + RID, { waitUntil: 'networkidle', timeout: 20000 });
ok('canvas', await visible('[data-testid="canvas"]'));
ok('sidebar 路由项', (await page.locator('[data-testid="route-item"]').count()) > 0, 'count=' + await page.locator('[data-testid="route-item"]').count());
ok('AskDock 常驻', await visible('[data-testid="ask-dock"]'));
ok('mermaid 图（或降级）', (await visible('[data-testid="mermaid-svg"]', 6000)) || (await visible('[data-testid="mermaid-fallback"]', 1000)));

// ---------- C 仪表盘 + 查调用链 ----------
console.log('--- C. 仪表盘 ---');
await click('[data-testid="tab-metrics"]', 600);
ok('dashboard', await visible('[data-testid="dashboard"]'));
ok('tech-stack', await visible('[data-testid="tech-stack"]'));
ok('top-apis', await visible('[data-testid="top-apis"]'));
const oc = await visible('[data-testid="open-chat"]', 1500);
ok('「查调用链」按钮存在', oc);
if (oc) {
  await click('[data-testid="open-chat"]', 500);
  ok('查调用链→回到拓扑', await visible('[data-testid="canvas"]'));
  const traced = (await visible('[data-testid="trace-strip"]', 2000)) || (await visible('[data-testid="selected-node"]', 500));
  ok('查调用链带出链路/选中态', traced);
}

// ---------- D Inspector 链路 ----------
console.log('--- D. Inspector ---');
await page.goto(BASE + '/?repo=' + RID, { waitUntil: 'networkidle' });
const sym = page.locator('[data-testid="symbol-member"]').first();
if ((await sym.count()) > 0) {
  await sym.dispatchEvent('click'); await page.waitForTimeout(400);
  ok('符号点击→inspector 打开', await visible('[data-testid="inspector"]', 3000));
  ok('inspector 文件头', await visible('[data-testid="inspector-file"]', 4000));
  const rev = await visible('[data-testid="inspector-reverse-deps"]', 1500);
  if (rev) { await click('[data-testid="inspector-reverse-deps"]', 600);
    ok('反向依赖面板', (await visible('[data-testid="reverse-deps-caller"]', 2500)) || (await visible('[data-testid="reverse-deps-empty"]', 1000))); }
  await click('[data-testid="inspector-close"]', 400);
  ok('inspector 关闭', (await page.locator('[data-testid="inspector"]')).count() === 0);
} else failures.push('sidebar 无 symbol-member 可点');

// ---------- E 命令面板 ----------
console.log('--- E. 命令面板 ---');
await page.keyboard.press('Control+k'); await page.waitForTimeout(400);
if (await visible('[data-testid="command-palette"]', 1500)) {
  await page.fill('[data-testid="palette-input"]', 'repo'); await page.waitForTimeout(700);
  ok('palette 结果', (await page.locator('[data-testid="palette-symbol-name"]').count()) > 0);
  await page.keyboard.press('Escape'); await page.waitForTimeout(300);
  ok('palette Escape 关闭', (await page.locator('[data-testid="command-palette"]')).count() === 0);
} else failures.push('Ctrl+K 未打开命令面板');

// ---------- F 导览 Tour ----------
console.log('--- F. Tour ---');
const tourBtn = page.locator('[data-testid="sidebar"] button', { hasText: /走查|播放|开始/ }).first();
if ((await tourBtn.count()) > 0) {
  await tourBtn.dispatchEvent('click'); await page.waitForTimeout(500);
  if (!(await visible('[data-testid="tour-player"]', 2500))) {
    // QuickTours 按钮文案未知：改点第一个 Quick Tours 区按钮
    const btns = page.locator('[data-testid="sidebar"] section button');
    const n = await btns.count(); info('sidebar 按钮数', n);
    for (let i = 0; i < n; i++) { await btns.nth(i).dispatchEvent('click'); await page.waitForTimeout(300);
      if (await visible('[data-testid="tour-player"]', 800)) break; }
  }
  ok('tour-player', await visible('[data-testid="tour-player"]'));
  if (await visible('[data-testid="tour-player"]', 500)) {
    await click('[data-testid="tour-next"]', 300);
    ok('tour-next 前进', await visible('[data-testid="tour-progress"]'));
    await click('[data-testid="tour-back"]', 300);
    ok('tour-back 退出', await visible('[data-testid="canvas"]'));
  }
} else failures.push('侧栏找不到 tour 入口按钮');

// ---------- G 架构问答（真实发送） ----------
console.log('--- G. Chat 真实发送 ---');
await click('[data-testid="tab-chat"]', 500);
ok('chat-view', await visible('[data-testid="chat-view"]'));
await page.fill('[data-testid="chat-question"]', 'App.tsx 大概是做什么的？一句话。');
await click('[data-testid="chat-send"]');
const consent = await visible('[data-testid="consent-modal"]', 1200);
if (consent) { await click('[data-testid="consent-confirm"]'); info('consent 弹窗', '出现并已确认'); }
const answered = await page.waitForFunction(() => {
  const errs = document.querySelector('[data-testid="chat-error"]');
  if (errs) return 'ERR:' + (errs.textContent || '').slice(0, 120);
  const msgs = document.querySelectorAll('[data-testid="chat-messages"] > div');
  const last = msgs[msgs.length - 1];
  const txt = last ? (last.textContent || '') : '';
  return msgs.length >= 1 && txt.trim().length > 20 ? 'ANSWER len=' + txt.length : false;
}, { timeout: 90000 }).catch(() => null);
ok('真实回答到达', !!answered && String(answered && answered.jsonValue()).startsWith('ANSWER'), answered ? String(await answered.jsonValue()) : '90s 无响应');
if (answered) { const v = String(await answered.jsonValue()); if (v.startsWith('ERR')) failures.push('chat 显示错误: ' + v); }
const sess = await page.locator('[data-testid="chat-session-list"] > *').count();
ok('会话列表有当前会话', sess >= 1, 'count=' + sess);
await click('[data-testid="chat-new-session"]', 400);
ok('新会话后消息清空', (await page.locator('[data-testid="chat-messages"] > div').count()) === 0 || (await page.locator('[data-testid="chat-starter-card"]').count()) > 0);
await click('[data-testid="chat-back"]', 400);
ok('chat-back 回拓扑', await visible('[data-testid="canvas"]'));

// ---------- H AskDock 预填链路 ----------
console.log('--- H. AskDock ---');
await page.fill('[data-testid="ask-dock-input"]', '这个项目用什么构建？');
await page.keyboard.press('Enter'); await page.waitForTimeout(600);
ok('dock→chat 视图', await visible('[data-testid="chat-view"]'));
const pv = await page.inputValue('[data-testid="chat-question"]');
ok('草稿预填且不自动发送', pv === '这个项目用什么构建？', 'v=' + pv);
await click('[data-testid="chat-back"]', 400);

// ---------- I 变更审计 ----------
console.log('--- I. 变更审计 ---');
await click('[data-testid="tab-gate"]', 600);
ok('ci-gate 视图', (await visible('[data-testid="ci-gate"]')) || (await visible('[data-testid="ci-gate-empty"]')));
ok('gate 输入控件', await visible('[data-testid="ci-base"]'));
const hist = (await page.locator('[data-testid="gate-run-row"]').count()) > 0 || (await visible('[data-testid="gate-history-empty"]', 1500)) || (await visible('[data-testid="gate-history-error"]', 500));
ok('gate 历史区（有记录/空态/错误态之一）', hist);

// ---------- J Diff 影响面（真跑） ----------
console.log('--- J. Diff 影响面 ---');
await click('[data-testid="tab-delta"]', 400);
ok('delta 视图', await visible('[data-testid="architecture-delta"]'));
await page.fill('[data-testid="delta-base"]', 'HEAD~6');
await page.fill('[data-testid="delta-head"]', 'HEAD');
await click('[data-testid="delta-run"]');
ok('delta 出结果', await visible('[data-testid="delta-added"]', 30000));
if (await visible('[data-testid="delta-run-error"]', 500)) {
  failures.push('delta 报错: ' + (await page.locator('[data-testid="delta-run-error"]').innerText()).slice(0, 150));
}
const copyBtn = await visible('[data-testid="delta-copy"]', 500);
if (copyBtn) { await click('[data-testid="delta-copy"]', 300); ok('复制报告反馈', await visible('text=已复制', 1000)); }

// ---------- K 规范演进 ----------
console.log('--- K. 规范演进 ---');
await click('[data-testid="tab-evolve"]', 500);
ok('evolution 视图', (await visible('[data-testid="evolution-view"]')) || (await visible('[data-testid="evolution-empty"]')));
ok('evolve 输入', await visible('[data-testid="evolve-intent"]') || (await visible('[data-testid="evolve-run"]')));

// ---------- L 更多操作 / 导入对话框 ----------
console.log('--- L. 更多操作 ---');
await click('[data-testid="more-actions"]', 400);
ok('more-menu', await visible('[data-testid="more-menu"]'));
await click('[data-testid="open-import"]', 500);
ok('import-dialog', await visible('[data-testid="import-dialog"]'));
const browse = await visible('[data-testid="import-browse"]', 800);
info('import-browse(原生目录选择器入口)', browse ? '存在' : '缺失(非 Windows 隐藏合法)');
await page.keyboard.press('Escape'); await page.waitForTimeout(300);
ok('import Escape 关闭', (await page.locator('[data-testid="import-dialog"]')).count() === 0);
await page.keyboard.press('Escape'); await page.waitForTimeout(200);

// ---------- M 主题切换 ----------
console.log('--- M. 主题 ---');
const before = await page.evaluate(() => document.documentElement.className + '|' + document.documentElement.dataset.theme);
await click('[data-testid="theme-toggle"]', 400);
const after = await page.evaluate(() => document.documentElement.className + '|' + document.documentElement.dataset.theme);
ok('主题切换生效', before !== after, before + ' → ' + after);
await click('[data-testid="theme-toggle"]', 300);

// ---------- N URL 同步（深链/回退） ----------
console.log('--- N. URL 真值 ---');
await click('[data-testid="tab-metrics"]', 500);
const u1 = page.url();
info('dashboard 后 URL', u1);
await page.goBack(); await page.waitForTimeout(500);
info('goBack 后 URL', page.url());
const backOk = await visible('[data-testid="canvas"]', 2000);
ok('浏览器回退恢复视图', backOk, 'url=' + page.url());

// ---------- O 375px 抽屉 ----------
console.log('--- O. 375px ---');
await page.setViewportSize({ width: 375, height: 700 });
await page.waitForTimeout(400);
const st = await visible('[data-testid="sidebar-toggle"]', 1200);
ok('375 sidebar-toggle 出现', st);
if (st) { await click('[data-testid="sidebar-toggle"]', 400);
  const open = await page.evaluate(() => !!document.querySelector('[data-testid="sidebar"]')?.getBoundingClientRect().width);
  ok('375 抽屉展开', open);
  await click('[data-testid="sidebar-toggle"]', 300); }
await click('[data-testid="tab-chat"]', 500);
const ct = await visible('[data-testid="chat-side-toggle"]', 1200);
ok('375 chat 侧栏切换钮', ct);
if (ct) { await click('[data-testid="chat-side-toggle"]', 400); ok('375 chat 侧栏展开', await visible('[data-testid="chat-session-list"]')); }
await page.setViewportSize({ width: 1280, height: 800 });

// ---------- 汇总 ----------
console.log('=== FAILURES (' + failures.length + ') ===');
failures.forEach((f) => console.log('  ✗', f));
const uniqErr = [...new Set(errors)];
console.log('=== 网络/Console 异常 (' + uniqErr.length + ') ===');
uniqErr.slice(0, 30).forEach((e) => console.log('  ' + e));
await page.screenshot({ path: 'D:/CodeCompass/.scratch/v027-ui/qa/sweep-final.png' });
await browser.close();
process.exit(failures.length ? 1 : 0);
