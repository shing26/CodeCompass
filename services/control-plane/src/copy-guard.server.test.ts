/**
 * v0.30 去极客化票 01（grill D8③）——服务端文案哨。
 *
 * 历史空洞：copy-guard 只扫 apps/repoqa-web/src，而 worker 中文 stage label
 * （SSE 渲染进 UI）、chat 系统提示词、export 模板标题同为「会进用户眼睛」的
 * 服务端文案，零哨护——「演进推演」型前后端漂移（前端禁词、服务端在用）正是
 * 无人看管的结果。本文件把控制面文案纳入同一张黑名单（contracts
 * USER_COPY_BLACKLIST，与 web 哨共表，杜绝第二事实源）。
 *
 * 扫描面 = 渲染到 UI 的文案载体；工程结构注释（如 routes/analysis 的
 * 「图谱读侧域」）不入服务端全文扫（本文件只扫上述 4 件）。
 * 中文层=全文扫（含注释，与 web 同哲学）；英文层/挂账活性=字符串区域扫
 * （review P1-1：注释通道不得给僵尸豁免续命——活性只认真实文案载体）。
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { USER_COPY_BLACKLIST, USER_COPY_ENGLISH_RETIRED } from '../../../packages/contracts/src/index';

// 本包构建 CJS，import.meta 不可用（typecheck 红线）；测试一律从包根执行
// （npm run test --prefix / CI matrix 同路径），cwd 即包根。守卫先行（review
// P2-5）：跑错地方给响亮指引，不留 ENOENT 天书。
const SRC = join(process.cwd(), 'src');
if (!existsSync(join(SRC, 'chat', 'agent.ts'))) {
  throw new Error('copy-guard.server.test.ts 必须从 services/control-plane 包根执行（当前 cwd 无 src/chat/agent.ts）');
}

/** 会进用户眼睛（或被模型复述进答案）的服务端文案文件。 */
const SERVER_COPY_FILES = [
  'chat/agent.ts', // 系统提示词——模型可复述面
  'chat/routes.ts', // chat SSE 人话出口
  'engine/repoqa-export.ts', // ONBOARDING/HTML 导出模板标题
  'ingest/repoqa-worker.ts' // 中文 stage label——SSE 直渲进 UI
];

/**
 * 待退役挂账（burn-down）：黑名单词在**真实文案**（字符串区域）仍有活居，
 * 由战役后段票面清零。销词必须走「文案改动与移除挂账同 commit」（D8④）；
 * 活性判定只看字符串区域（P1-1），注释提及时挂账照常失效变红——僵尸豁免
 * 无处藏身。拆分构造与 web 哨同一词面工艺。
 */
const PENDING_RETIREMENT: readonly string[] = ['拆除' + '计划', '架构' + '指标'];

const EFFECTIVE = USER_COPY_BLACKLIST.filter((w) => !PENDING_RETIREMENT.includes(w));
const ENGLISH_TERMS: RegExp[] = USER_COPY_ENGLISH_RETIRED.map((word) => new RegExp(`\\b${word}\\b`));

/** String-aware comment stripper（web copy-guard 同构移植，服务端无 JSX 文本区）。 */
function stripComments(src: string): string {
  let out = '';
  let i = 0;
  let str: string | null = null;
  while (i < src.length) {
    const ch = src[i];
    const next = src[i + 1];
    if (str) {
      out += ch;
      if (ch === '\\') { out += next ?? ''; i += 2; continue; }
      if (ch === str) str = null;
      else if (ch === '\n' && str !== '`') str = null;
      i += 1;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') { str = ch; out += ch; i += 1; continue; }
    if (ch === '/' && next === '/') { while (i < src.length && src[i] !== '\n') i += 1; continue; }
    if (ch === '/' && next === '*') {
      i += 2;
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) i += 1;
      i += 2;
      out += ' ';
      continue;
    }
    out += ch;
    i += 1;
  }
  return out;
}

/** 字符串字面量区域（' " 不跨行、` 跨行）——真实文案载体，注释不在此域。 */
function stringRegions(src: string): string[] {
  const clean = stripComments(src);
  const regions: string[] = [];
  for (const m of clean.matchAll(/'(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*"|`(?:\\.|[^`\\])*?`/g)) regions.push(m[0]);
  return regions;
}

/** 全文行扫（含注释，中文层用）；跨行断裂词以扁平文本兜底（P2-6）。 */
function scanFullText(text: string, words: readonly string[]): string[] {
  const hits: string[] = [];
  const lines = text.split(/\r?\n/);
  lines.forEach((line, index) => {
    for (const word of words) {
      if (line.includes(word)) hits.push(`L${index + 1} 命中「${word}」`);
    }
  });
  const flatRegions = stringRegions(text).join('');
  for (const word of words) {
    const alreadyFound = hits.some((h) => h.includes(`「${word}」`));
    // 跨行兜底只在字符串区域内做（P2-6）——全文扁平会把「…读\n侧…」式
    // 散文行首尾拼成假命中。
    if (!alreadyFound && flatRegions.includes(word)) hits.push(`跨行命中「${word}」`);
  }
  return hits;
}

/** 区域扫（字符串字面量内，英文层与挂账活性用）。 */
function scanRegions(text: string, needles: Array<string | RegExp>): string[] {
  const hits: string[] = [];
  for (const region of stringRegions(text)) {
    for (const n of needles) {
      const label = typeof n === 'string' ? `「${n}」` : `/${n.source}/`;
      if (typeof n === 'string' ? region.includes(n) : n.test(region)) hits.push(label);
    }
  }
  return hits;
}

function scanAllFiles(scanner: (text: string) => string[]): string[] {
  const offenders: string[] = [];
  for (const rel of SERVER_COPY_FILES) {
    const hits = scanner(readFileSync(join(SRC, rel), 'utf8'));
    offenders.push(...hits.map((h) => `${rel} ${h}`));
  }
  return offenders;
}

describe('server-side outbound copy guard (v0.30 ticket 01)', () => {
  it('user-visible server copy carries no blacklisted retired words (full text incl. comments)', () => {
    expect(scanAllFiles((t) => scanFullText(t, EFFECTIVE))).toEqual([]);
  });

  it('no retired English chrome words in server string regions (shared ENGLISH table)', () => {
    expect(scanAllFiles((t) => scanRegions(t, ENGLISH_TERMS))).toEqual([]);
  });

  it('the sentinel bites: pending words are genuinely live in string regions', () => {
    // 灵敏度自证——挂账词在真实文案（非注释）里活着；哨若只吃注释即空转。
    expect(scanAllFiles((t) => scanRegions(t, [...PENDING_RETIREMENT])).length).toBeGreaterThan(0);
    // 英文层机制同样有牙：临时词注入即命中。
    expect(scanRegions('title = "Watcher: Ready"', [/\bWatch/])).toHaveLength(1);
  });

  it('burn-down: every pending word is still live in REAL copy (comments do not count)', () => {
    for (const word of PENDING_RETIREMENT) {
      const live = scanAllFiles((t) => scanRegions(t, [word]));
      expect(
        live.length,
        `「${word}」已不在服务端真实文案里——请把它从 PENDING_RETIREMENT 摘除（销词同 commit 纪律）`
      ).toBeGreaterThan(0);
    }
  });

  it('burn-down tracker never masks a non-blacklist word (shared table sanity)', () => {
    for (const word of PENDING_RETIREMENT) {
      expect(USER_COPY_BLACKLIST, `挂账词「${word}」不在黑名单`).toContain(word);
    }
  });
});
