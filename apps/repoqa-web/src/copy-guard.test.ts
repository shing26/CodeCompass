/**
 * v0.26-A ticket 04 — 文案回归哨总闸（A 系列验收封条，沿用票 15 哨模式）。
 *
 * 改名在本仓翻车过两次（8ac9bea 漏网→票 15；v0.25 QA 抓引导滞后）。本文件把
 * 「旧词死干净了吗」变成机械判据：对 apps/repoqa-web/src 全部源码（含注释与
 * 测试）做文件系统级 grep——黑名单词零命中，出现即红。要复活动词只需在对应处
 * 加回字面量，而那条改动会同时打红这里与票面约束，逼迫走显式裁决。
 *
 * 本文件的词表全部拆分构造（'拆'+'除计划' 形态），否则自己就是第一个命中者。
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { COPY_BLACKLIST } from './client/copyBlacklist';

const SRC = dirname(fileURLToPath(import.meta.url));

/** spec 验收门 1 黑名单（中文区）；侧栏英文节标题 Evolution 单独按 DOM 位点断言。
 * v0.27-B R3（review P2-2）：词表升格为共享权威源 client/copyBlacklist.ts——
 * copy-guard 与 errorCodes 自查共读一张表，杜绝分叉漂移（拆分构造防自燃）。 */
const BLACKLIST: string[] = [...COPY_BLACKLIST];

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return name === 'node_modules' ? [] : sourceFiles(full);
    return /\.(ts|tsx|css)$/.test(name) ? [full] : [];
  });
}

describe('copy guard (v0.26-A ticket 04)', () => {
  it('blacklisted retired words are dead across ALL src files, comments included', () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(SRC)) {
      if (relative(SRC, file) === 'copy-guard.test.ts') continue; // 双保险：哨自身豁免
      const lines = readFileSync(file, 'utf8').split(/\r?\n/);
      lines.forEach((line, index) => {
        for (const word of BLACKLIST) {
          if (line.includes(word)) {
            offenders.push(`${relative(SRC, file)}:${index + 1} 命中「${word}」: ${line.trim().slice(0, 80)}`);
          }
        }
      });
    }
    expect(offenders).toEqual([]);
  });

  it('the sidebar evolution section head is the Chinese gate name, never bare English (Q8)', () => {
    const sidebar = readFileSync(join(SRC, 'components', 'Sidebar.tsx'), 'utf8');
    const head = sidebar.match(/data-testid="sidebar-evolution-head"[^>]*>([\s\S]*?)<\/h2>/);
    expect(head, 'sidebar-evolution-head 锚点必须在位（A03 门牌哨的前提）').toBeTruthy();
    expect(head![1]).toContain('规范演进');
    expect(head![1]).not.toMatch(/\bEvolution\b/);
    // P2-8 补位点：按钮 label 同门牌（收口 review：只测节标题会漏未来按钮漂移）。
    const button = sidebar.match(/data-testid="sidebar-evolution"[\s\S]*?<\/button>/);
    expect(button, 'sidebar-evolution 按钮必须在位').toBeTruthy();
    expect(button![0]).toContain('规范演进');
    expect(button![0]).not.toMatch(/>\s*Evolution\s*</);
  });

  it('the three positioning sentences stand at their anchors (Q2 existence seal)', () => {
    // 行为级断言由票 01/02 的组件测试负责；这里只钉「源码字面量没被整句删掉」，
    // 防组件层重构把 tooltip/空态连带蒸发。
    const topbar = readFileSync(join(SRC, 'components', 'TopBar.tsx'), 'utf8');
    expect(topbar).toContain('问现状：架构、链路、风险都基于代码事实');
    expect(topbar).toContain('要方案：给改动意图，产出落位建议与风险清单；引擎只读，改动由你执行');
    const chat = readFileSync(join(SRC, 'components', 'ChatView.tsx'), 'utf8');
    expect(chat).toContain('引擎只读，改动由你执行');
    const plan = readFileSync(join(SRC, 'components', 'PlanCardView.tsx'), 'utf8');
    expect(plan).toContain('引擎只读，改动由你执行');
    expect(plan).toContain('在规范演进中展开');
    const canvas = readFileSync(join(SRC, 'components', 'Canvas.tsx'), 'utf8');
    expect(canvas).toContain('要方案');
    expect(canvas).toContain('问现状');
    const evolve = readFileSync(join(SRC, 'components', 'EvolutionView.tsx'), 'utf8');
    expect(evolve).toContain('惯例冲突'); // 新词族合法直写
    expect(evolve).toContain('引擎只读，改动由你执行');
  });
});

/**
 * v0.30 票 01（grill D8②，销 V27-10 前瞻项）——英文退役词层：
 * 原 Evolution 封条只锚侧栏 2 个 testid 位点（上方 Q8），位点外的未来英文
 * 用户文案会漏网；本层把判据升为「全 src 非测试源码的 JSX 文本节点 +
 * 字符串字面量」扫描。
 *
 * 标识符免疫原理：区域收集只认字符串/JSX 文本，\bEvolution\b 不会命中
 * EvolutionView/EvolutionRisk 这类复合标识符（词尾无边界）；注释不产区域
 * （先剥注释再收集），历史叙述在注释里不误红。
 * 已知限制（票 01 Comments 登记）：正则字面量内的引号可能被剥离器误判为
 * 字符串开合——真触发误报时对该文件具名豁免并留活例，不放空机制。
 */

/** String-aware comment stripper: drops line and block comments, keeps string bodies intact. */
function stripComments(src: string): string {
  let out = '';
  let i = 0;
  let str: string | null = null; // active quote char: ' " `
  while (i < src.length) {
    const ch = src[i];
    const next = src[i + 1];
    if (str) {
      out += ch;
      if (ch === '\\') { out += next ?? ''; i += 2; continue; }
      if (ch === str) str = null;
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

/** User-visible copy regions: JSX text nodes + quoted string literals (comment-free source only). */
function userTextRegions(src: string): string[] {
  const clean = stripComments(src);
  const regions: string[] = [];
  for (const m of clean.matchAll(/>([^<>{}]+)</g)) regions.push(m[1]);
  for (const m of clean.matchAll(/(["'`])(?:\\.|(?!\1)[\s\S])*?\1/g)) regions.push(m[0]);
  return regions;
}

/** Scan one source file's user-visible regions for retired English terms; returns offender lines. */
function scanEnglishRetired(relPath: string, src: string, terms: RegExp[]): string[] {
  const offenders: string[] = [];
  for (const region of userTextRegions(src)) {
    for (const term of terms) {
      if (term.test(region)) {
        offenders.push(`${relPath} 用户文案区域命中 ${term}: ${region.trim().slice(0, 80)}`);
      }
    }
  }
  return offenders;
}

// G3 起向此表填入退役英文 chrome 词（表 D 第二层）。G1 立机制、词表留空，
// 灵敏度由下方注入测试证明——防空转。
const ENGLISH_RETIRED: RegExp[] = [];

describe('English retired-word layer (v0.30 ticket 01, D8②)', () => {
  it('no bare English `Evolution` (and G3+ retired chrome words) in any user-visible copy region', () => {
    const terms: RegExp[] = [/\bEvolution\b/, ...ENGLISH_RETIRED];
    const offenders: string[] = [];
    for (const file of sourceFiles(SRC)) {
      const rel = relative(SRC, file);
      if (rel === 'copy-guard.test.ts') continue; // 哨自身豁免
      if (/\.test\.tsx?$/.test(rel)) continue; // 测试标题不是用户文案
      if (!/\.tsx?$/.test(rel)) continue;
      offenders.push(...scanEnglishRetired(rel, readFileSync(file, 'utf8'), terms));
    }
    expect(offenders).toEqual([]);
  });

  it('identifier noise and comments are immune (false-positive guard)', () => {
    const immune = [
      "import { EvolutionRisk } from 'x';",
      'function openEvolutionView() { /* the Evolution workbench in prose */ }',
      'const v: EvolutionStageId;',
      '// Ticket 04: open the Evolution workbench view.'
    ].join('\n');
    expect(scanEnglishRetired('synthetic.tsx', immune, [/\bEvolution\b/])).toEqual([]);
  });

  it('user copy in strings and JSX text is caught (sensitivity proof)', () => {
    const red = [
      '<h2>Evolution</h2>',
      'title="Evolution console"',
      "label: 'Evolution'"
    ].join('\n');
    expect(scanEnglishRetired('synthetic.tsx', red, [/\bEvolution\b/])).toHaveLength(3);
  });

  it('the G3+ English retirement list hook is wired (empty at G1 by design)', () => {
    // 机制就位证明：临时词注入即红、且 ENGLISH_RETIRED 参与全 src 扫描。
    expect(scanEnglishRetired('synthetic.tsx', 'title="Watch: Ready"', [/\bWatch/])).toHaveLength(1);
    expect(Array.isArray(ENGLISH_RETIRED)).toBe(true);
  });
});
