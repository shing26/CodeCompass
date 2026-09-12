// 第二轮定向复现：palette/import 的 Escape、404 来源、symbols→inspector 链、tour、375 chat 侧栏。
const { chromium } = await import('file:///D:/zcode-tmp/pw/node_modules/playwright-core/index.mjs');
const BASE = 'http://localhost:5173';
const API = 'http://127.0.0.1:43110';
const EXEC = 'C:/Users/Shing/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe';
const browser = await chromium.launch({ executablePath: EXEC, headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const bad = [];
page.on('response', (r) => { if (r.status() >= 400) bad.push(r.status() + ' ' + r.url()); });
const repo = (await (await fetch(API + '/api/repos')).json()).repos.find((r) => r.status === 'ready');
const RID = repo.id;
const dispatch = (s) => page.locator(s).first().dispatchEvent('click');
const cnt = (s) => page.locator(s).count();

await page.goto(BASE + '/?repo=' + RID, { waitUntil: 'networkidle' });

console.log('== 1. palette Escape ==');
await page.keyboard.press('Control+k'); await page.waitForTimeout(400);
console.log('  open?', await cnt('[data-testid="command-palette"]'));
await page.keyboard.press('Escape'); await page.waitForTimeout(400);
console.log('  after Esc?', await cnt('[data-testid="command-palette"]'));
// 再开一次，用 input fill 后 Escape（复现 sweep 路径）
await page.keyboard.press('Control+k'); await page.waitForTimeout(300);
await page.fill('[data-testid="palette-input"]', 'repo'); await page.waitForTimeout(600);
console.log('  results', await cnt('[data-testid="palette-symbol-name"]'));
await page.keyboard.press('Escape'); await page.waitForTimeout(400);
console.log('  after fill+Esc?', await cnt('[data-testid="command-palette"]'));
// 若仍在：点 overlay 背景关
if (await cnt('[data-testid="command-palette"]')) {
  await page.locator('[data-testid="command-palette-overlay"]').click({ position: { x: 5, y: 5 } });
  await page.waitForTimeout(300);
  console.log('  after overlay-click?', await cnt('[data-testid="command-palette"]'));
}

console.log('== 2. import Escape ==');
await dispatch('[data-testid="more-actions"]'); await page.waitForTimeout(300);
await dispatch('[data-testid="open-import"]'); await page.waitForTimeout(500);
console.log('  open?', await cnt('[data-testid="import-dialog"]'));
await page.keyboard.press('Escape'); await page.waitForTimeout(400);
console.log('  after Esc?', await cnt('[data-testid="import-dialog"]'));
if (await cnt('[data-testid="import-dialog"]')) {
  // 聚焦 modal 内元素后再 Esc（若监听是 window 则无差别）
  await page.locator('[data-testid="import-dialog"]').first().click({ position: { x: 10, y: 10 } }).catch(() => {});
  await page.keyboard.press('Escape'); await page.waitForTimeout(400);
  console.log('  after focus+Esc?', await cnt('[data-testid="import-dialog"]'));
}
await page.keyboard.press('Escape'); await page.waitForTimeout(200);

console.log('== 3. symbols → inspector ==');
if (await cnt('[data-testid="symbol-member"]') === 0) { await dispatch('[data-testid="symbols-toggle"]'); await page.waitForTimeout(600); }
console.log('  symbol-member', await cnt('[data-testid="symbol-member"]'));
await dispatch('[data-testid="symbol-member"]'); await page.waitForTimeout(500);
console.log('  inspector', await cnt('[data-testid="inspector"]'), '| file', await cnt('[data-testid="inspector-file"]'));
if (await cnt('[data-testid="inspector-reverse-deps"]')) { await dispatch('[data-testid="inspector-reverse-deps"]'); await page.waitForTimeout(1200);
  console.log('  revdeps caller/empty', await cnt('[data-testid="reverse-deps-caller"]'), await cnt('[data-testid="reverse-deps-empty"]')); }
// 面包屑导航（用户常点的「回仓库」）
console.log('  breadcrumb repo/back', await cnt('[data-testid="breadcrumb-repo"]'));
await dispatch('[data-testid="inspector-close"]'); await page.waitForTimeout(300);
console.log('  closed', await cnt('[data-testid="inspector"]'));

console.log('== 4. tour ==');
const sec = page.locator('section', { hasText: 'Quick Tours' });
console.log('  Quick Tours section', await sec.count(), '| buttons', await sec.locator('button').count());
if (await sec.locator('button').count() > 0) {
  await sec.locator('button').first().dispatchEvent('click'); await page.waitForTimeout(600);
  console.log('  tour-player', await cnt('[data-testid="tour-player"]'));
  if (await cnt('[data-testid="tour-player"]')) {
    await dispatch('[data-testid="tour-next"]'); await page.waitForTimeout(300);
    console.log('  step after next:', await cnt('[data-testid="tour-step"]'));
    await dispatch('[data-testid="tour-back"]'); await page.waitForTimeout(300);
    console.log('  back → canvas', await cnt('[data-testid="canvas"]'));
  }
}

console.log('== 5. 375 chat 侧栏（repo 在场）==');
await page.setViewportSize({ width: 375, height: 700 }); await page.waitForTimeout(300);
await dispatch('[data-testid="tab-chat"]'); await page.waitForTimeout(500);
console.log('  chat-view', await cnt('[data-testid="chat-view"]'), '| side-toggle', await cnt('[data-testid="chat-side-toggle"]'));
if (await cnt('[data-testid="chat-side-toggle"]')) {
  await dispatch('[data-testid="chat-side-toggle"]'); await page.waitForTimeout(400);
  console.log('  session-list visible?', await page.locator('[data-testid="chat-session-list"]').isVisible().catch(() => false));
}

console.log('== 6. 4xx/5xx 汇总 ==');
console.log(bad.length ? bad.join('\n') : '  （无）');
await browser.close();
