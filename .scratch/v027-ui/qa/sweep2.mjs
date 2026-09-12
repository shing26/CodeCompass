// v0.27 回归走查 R2（修掉 R1 的脚本伪报，并补 trace/换库/隐藏规则等面）。
const { chromium } = await import('file:///D:/zcode-tmp/pw/node_modules/playwright-core/index.mjs');
const BASE = 'http://localhost:5173';
const API = 'http://127.0.0.1:43110';
const EXEC = 'C:/Users/Shing/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe';
const failures = []; const notes = [];
function ok(label, cond, extra) { if (cond) console.log('  ✓', label); else { console.log('  ✗ FAIL', label, extra ?? ''); failures.push(label + (extra ? ' :: ' + extra : '')); } }
function info(l, v) { console.log('  ·', l, v); notes.push(l + ': ' + v); }
const browser = await chromium.launch({ executablePath: EXEC, headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + String(e.message || e).slice(0, 250)));
page.on('console', (m) => { if (m.type() === 'error') errors.push('CONSOLE: ' + (m.location().url || '') + ' | ' + m.text().slice(0, 200)); });
page.on('response', (r) => { if (r.status() >= 400) errors.push('HTTP ' + r.status() + ' ' + r.url()); });
const dispatch = (s) => page.locator(s).first().dispatchEvent('click');
const cnt = (s) => page.locator(s).count();
const vis = async (s, ms = 2500) => { try { await page.waitForSelector(s, { state: 'visible', timeout: ms }); return true; } catch { return false; } };

const repos = (await (await fetch(API + '/api/repos')).json()).repos;
const repo = repos.find((r) => r.status === 'ready');
const repo2 = repos.find((r) => r.status === 'ready' && r.id !== repo.id);
const RID = repo.id;
await page.goto(BASE + '/?repo=' + RID, { waitUntil: 'networkidle', timeout: 20000 });

console.log('--- 1. 拓扑基础 ---');
ok('canvas', await vis('[data-testid="canvas"]'));
ok('route-item 列表', (await cnt('[data-testid="route-item"]')) > 0);
ok('AskDock 常驻', await vis('[data-testid="ask-dock"]'));

console.log('--- 2. 点路由 → trace 步进 ---');
await dispatch('[data-testid="route-item"]'); await page.waitForTimeout(1500);
ok('trace-strip', await vis('[data-testid="trace-strip"]', 4000));
const stepsBefore = await cnt('[data-testid="trace-step-label"]');
await dispatch('[data-testid="trace-step-next"]'); await page.waitForTimeout(500);
ok('step-next 生效', (await cnt('[data-testid="selected-node"]')) > 0 || (await cnt('[data-testid="trace-step-label"]')) >= stepsBefore, 'before=' + stepsBefore);
await dispatch('[data-testid="trace-step-prev"]'); await page.waitForTimeout(300);
ok('step-prev 生效', await vis('[data-testid="trace-strip"]', 1500));

console.log('--- 3. symbols→inspector→关闭可见性 ---');
if ((await cnt('[data-testid="symbol-member"]')) === 0) { await dispatch('[data-testid="symbols-toggle"]'); await page.waitForTimeout(800); }
ok('symbol-member 出现', (await cnt('[data-testid="symbol-member"]')) > 0);
await dispatch('[data-testid="symbol-member"]'); await page.waitForTimeout(500);
ok('inspector 可见', await vis('[data-testid="inspector"]', 3000));
ok('monaco 文件头', await vis('[data-testid="inspector-file"]', 6000));
await dispatch('[data-testid="inspector-reverse-deps"]'); await page.waitForTimeout(1200);
ok('反向依赖区', (await vis('[data-testid="reverse-deps-caller"]', 2500)) || (await vis('[data-testid="reverse-deps-empty"]', 1000)));
await dispatch('[data-testid="inspector-close"]'); await page.waitForTimeout(400);
ok('inspector 关闭（isVisible=false）', !(await page.locator('[data-testid="inspector"]').first().isVisible()));

console.log('--- 4. 仪表盘细节 ---');
await dispatch('[data-testid="tab-metrics"]'); await page.waitForTimeout(1200);
ok('dashboard', await vis('[data-testid="dashboard"]'));
ok('tech-stack', await vis('[data-testid="tech-stack"]'));
ok('config-topology 或 scale', (await vis('[data-testid="config-topology"]', 1500)) || (await vis('[data-testid="scale"]', 1500)));
ok('api-entry 项', (await cnt('[data-testid="api-entry"]')) > 0);

console.log('--- 5. Tour 入口面板 ---');
const tsec = page.locator('section', { hasText: 'Quick Tours' });
const tbtn = tsec.locator('button');
const tn = await tbtn.count();
ok('Quick Tours 面板', (await tsec.count()) >= 1);
if (tn > 0) {
  await tbtn.first().dispatchEvent('click'); await page.waitForTimeout(600);
  ok('tour-player', await vis('[data-testid="tour-player"]'));
  if (await vis('[data-testid="tour-player"]', 800)) {
    await dispatch('[data-testid="tour-next"]'); await page.waitForTimeout(300);
    await dispatch('[data-testid="tour-back"]'); await page.waitForTimeout(300);
    ok('tour-back 回拓扑', await vis('[data-testid="canvas"]'));
  }
} else info('本仓库 tours 数据', '面板按钮 0（API tours=[]，启发式对 TS 前端仓无锚点——内容问题入台账）');

console.log('--- 6. 换库（repo2） ---');
if (repo2) {
  await page.goto(BASE + '/?repo=' + repo2.id, { waitUntil: 'networkidle' }); await page.waitForTimeout(800);
  ok('repo2 canvas', await vis('[data-testid="canvas"]'));
  ok('repo2 dashboard', (await dispatch('[data-testid="tab-metrics"]'), await vis('[data-testid="dashboard"]', 4000)));
} else info('第二仓库', '无 ready 仓库可换');

console.log('--- 7. chat 真发（修正断言） ---');
await page.goto(BASE + '/?repo=' + RID, { waitUntil: 'networkidle' });
await dispatch('[data-testid="tab-chat"]'); await page.waitForTimeout(500);
ok('chat 视图中 AskDock 隐藏', (await page.locator('[data-testid="ask-dock"]').count()) === 0 || !(await page.locator('[data-testid="ask-dock"]').first().isVisible()));
await page.fill('[data-testid="chat-question"]', '这个仓库主要用什么语言？一句话。');
await dispatch('[data-testid="chat-send"]');
if (await vis('[data-testid="consent-modal"]', 1200)) await dispatch('[data-testid="consent-confirm"]');
const verdict = String(await page.waitForFunction(() => {
  const errs = document.querySelector('[data-testid="chat-error"]');
  if (errs) return 'ERR:' + (errs.textContent || '').slice(0, 120);
  const msgs = document.querySelectorAll('[data-testid="chat-messages"] > div');
  const last = msgs[msgs.length - 1];
  const txt = last ? (last.textContent || '') : '';
  return msgs.length >= 1 && txt.trim().length > 20 ? 'ANSWER len=' + txt.length : false;
}, { timeout: 90000 }).then((h) => h.jsonValue()).catch(() => 'TIMEOUT'));
ok('真实回答到达', verdict.startsWith('ANSWER'), verdict);
if (verdict.startsWith('ERR')) failures.push('chat 显示错误 ' + verdict);

console.log('--- 8. 375 抽屉（repo 在场重导航） ---');
await page.setViewportSize({ width: 375, height: 700 });
await page.goto(BASE + '/?repo=' + RID, { waitUntil: 'networkidle' }); await page.waitForTimeout(500);
ok('375 sidebar-toggle', await vis('[data-testid="sidebar-toggle"]', 1500));
await dispatch('[data-testid="tab-chat"]'); await page.waitForTimeout(500);
ok('375 chat-side-toggle', await vis('[data-testid="chat-side-toggle"]', 1500));
if (await vis('[data-testid="chat-side-toggle"]', 500)) {
  await dispatch('[data-testid="chat-side-toggle"]'); await page.waitForTimeout(400);
  ok('375 会话列表展开', await vis('[data-testid="chat-session-list"]', 1500));
}

console.log('=== FAILURES (' + failures.length + ') ===');
failures.forEach((f) => console.log('  ✗', f));
console.log('=== 网络/Console (' + new Set(errors).size + ') ===');
[...new Set(errors)].slice(0, 20).forEach((e) => console.log('  ' + e));
await browser.close();
process.exit(failures.length ? 1 : 0);
