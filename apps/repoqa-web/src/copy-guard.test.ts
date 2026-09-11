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

const SRC = dirname(fileURLToPath(import.meta.url));

/** spec 验收门 1 黑名单（中文区）；侧栏英文节标题 Evolution 单独按 DOM 位点断言。 */
const BLACKLIST: string[] = [
  '推演' + '卡', // Q5：名词岗退场，「推演」只留动词（开始推演/追加推演/阶段名）
  '拆除' + '计划', // Q3：PlanCardView 已更名「方案摘要」
  '约定' + '冲突', // Q4：语系归「惯例」
  '架构' + '指标', // 8ac9bea 轮退场的旧 tab 名
  '智能体' + '对话', // 8ac9bea 轮退场的旧 tab 名
  '读' + '侧', // Q2：内部分析语言，禁入用户可见文案
  '写' + '侧'
];

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
