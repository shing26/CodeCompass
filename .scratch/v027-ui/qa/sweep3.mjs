const { chromium } = await import('file:///D:/zcode-tmp/pw/node_modules/playwright-core/index.mjs');
const BASE='http://localhost:5173', API='http://127.0.0.1:43110';
const EXEC='C:/Users/Shing/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe';
const b=await chromium.launch({executablePath:EXEC,headless:true});
const ctx=await b.newContext({viewport:{width:1280,height:800},acceptDownloads:true});
const page=await ctx.newPage();
const errs=[]; page.on('pageerror',e=>errs.push(String(e).slice(0,200)));
const repo=(await (await fetch(API+'/api/repos')).json()).repos.find(r=>r.status==='ready');
await page.goto(BASE+'/?repo='+repo.id,{waitUntil:'networkidle'});
const dispatch=s=>page.locator(s).first().dispatchEvent('click');
console.log('-- 复制 Agent 上下文 --');
if((await page.locator('[data-testid="symbol-member"]').count())===0){await dispatch('[data-testid="symbols-toggle"]');await page.waitForTimeout(700);}
await dispatch('[data-testid="symbol-member"]');await page.waitForTimeout(1500);
const cp=await page.locator('[data-testid="copy-agent-context"]').count();
console.log('  button:',cp);
if(cp){await dispatch('[data-testid="copy-agent-context"]');await page.waitForTimeout(800);
  console.log('  反馈文案:',await page.locator('[data-testid="copy-agent-context"]').innerText());}
console.log('-- 导出 onboarding（下载流）--');
await dispatch('[data-testid="more-actions"]');await page.waitForTimeout(300);
const dlP=page.waitForEvent('download',{timeout:15000}).catch(()=>null);
await dispatch('[data-testid="export-onboarding"]');
const dl=await dlP;console.log('  download:',dl?dl.suggestedFilename():'未触发');
console.log('-- pageerror --',errs.length?errs:'无');
await b.close();
