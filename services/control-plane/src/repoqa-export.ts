import type { RepoSymbol } from './repoqa-repos';
import { buildDashboard, type RepoDashboard } from './repoqa-dashboard';
import { buildTours, type RepoQaTour } from './repoqa-tours';

/**
 * Issue 14 — 一键导出 ONBOARDING 架构交接手册（`ONBOARDING.md`）。
 *
 * 纯确定性聚合：复用 Issue 12 的 `buildDashboard`（技术栈/架构指标/脱敏配置/
 * Top API）与 Issue 11 的 `buildTours`（3 条 Onboarding 路线），输出标准
 * Markdown 文本。配置值从不落盘（Issue 06），因此导出内容天然无敏感值；
 * HTTP 层还会再过一次 `maskSensitiveText` 作为防御性脱敏。
 */

export interface BuildOnboardingMarkdownOptions {
  repoId: string;
  repoName?: string;
  symbols: RepoSymbol[];
  /** Max hops for each Top API call chain / main-flow tour (default 5). */
  maxDepth?: number;
  /** How many top APIs to include (default 10). */
  topLimit?: number;
  /** Injectable clock for deterministic tests. */
  now?: () => Date;
}

/** Strip characters that are illegal in file names across common OSes. */
export function sanitizeFileName(name: string): string {
  const cleaned = name
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned || 'repo';
}

/** Standard download file name, e.g. `petclinic-ONBOARDING.md`. */
export function onboardingExportFileName(repoName?: string): string {
  return `${sanitizeFileName(repoName ?? 'repo')}-ONBOARDING.md`;
}

const SCALE_LABELS: Array<[keyof RepoDashboard['scale'], string]> = [
  ['routes', 'Routes'],
  ['services', 'Services'],
  ['repositories', 'Repositories'],
  ['advices', 'Advices'],
  ['classes', 'Classes'],
  ['interfaces', 'Interfaces'],
  ['methods', 'Methods'],
  ['fields', 'Fields'],
  ['configKeys', 'Config keys'],
  ['files', 'Files']
];

/* ------------------------------------------------------------------ */
/* Section renderers                                                   */
/* ------------------------------------------------------------------ */

function techStackSection(dashboard: RepoDashboard): string {
  const lines: string[] = ['## 技术栈（Tech Stack）', ''];
  if (dashboard.techStack.highlights.length > 0) {
    lines.push(`高亮：${dashboard.techStack.highlights.join('、')}`, '');
  }
  if (dashboard.techStack.summary.length === 0) {
    lines.push('未检测到框架依赖。', '');
    return lines.join('\n');
  }
  for (const group of dashboard.techStack.summary) {
    lines.push(`### ${group.label}（${group.count}）`, '');
    for (const item of group.items) {
      const location = item.lineStart ? `${item.filePath}:${item.lineStart}` : item.filePath;
      lines.push(`- \`${item.name}\` — \`${location}\``);
    }
    lines.push('');
  }
  return lines.join('\n');
}

function scaleSection(dashboard: RepoDashboard): string {
  const lines: string[] = ['## 架构指标（Architecture Scale）', ''];
  lines.push('| 指标 | 数量 |', '| --- | --- |');
  for (const [key, label] of SCALE_LABELS) {
    lines.push(`| ${label} | ${dashboard.scale[key]} |`);
  }
  lines.push('');
  return lines.join('\n');
}

function configSection(dashboard: RepoDashboard): string {
  const lines: string[] = ['## 脱敏配置（Config Topology）', ''];
  lines.push('> 值已脱敏：配置仅索引 key，value 从不存储与导出（Issue 06）。', '');
  if (dashboard.config.topology.length === 0) {
    lines.push('无配置键。', '');
    return lines.join('\n');
  }
  lines.push('| Group | Key | 文件 | 敏感 |', '| --- | --- | --- | --- |');
  for (const item of dashboard.config.topology) {
    const location = item.lineStart ? `${item.filePath}:${item.lineStart}` : item.filePath;
    lines.push(
      `| ${item.group} | \`${item.key}\` | \`${location}\` | ${item.sensitive ? '⚠ sensitive' : '-'} |`
    );
  }
  lines.push('');
  return lines.join('\n');
}

/** Render the statically resolved hop chain as a Mermaid sequence diagram. */
function sequenceDiagram(hops: string[]): string {
  const lines = ['sequenceDiagram'];
  const ids = hops.map((_, index) => `p${index + 1}`);
  hops.forEach((hop, index) => {
    lines.push(`    participant ${ids[index]} as ${hop}`);
  });
  for (let index = 0; index < hops.length - 1; index += 1) {
    lines.push(`    ${ids[index]}->>${ids[index + 1]}: 调用`);
  }
  return lines.join('\n');
}

function topApisSection(dashboard: RepoDashboard): string {
  const lines: string[] = ['## Top 核心 API（时序图）', ''];
  if (dashboard.topApis.length === 0) {
    lines.push('未检测到 REST 入口。', '');
    return lines.join('\n');
  }
  for (const api of dashboard.topApis) {
    lines.push(`### ${api.name}`, '');
    lines.push(`- 控制器：\`${api.controller}\``);
    lines.push(`- 源码：\`${api.filePath}:${api.lineStart}\``);
    lines.push(`- 深度：${api.depth}`);
    lines.push(`- 调用链：\`${api.hops.join(' → ')}\``);
    lines.push('');
    if (api.hops.length >= 2) {
      lines.push('```mermaid', sequenceDiagram(api.hops), '```', '');
    }
  }
  return lines.join('\n');
}

const TOUR_ORDINALS = ['一', '二', '三'];

function toursSection(tours: RepoQaTour[]): string {
  const lines: string[] = ['## Onboarding 路线（3 条）', ''];
  if (tours.length === 0) {
    lines.push('无可用路线。', '');
    return lines.join('\n');
  }
  tours.forEach((tour, index) => {
    const ordinal = TOUR_ORDINALS[index] ?? String(index + 1);
    lines.push(`### 路线${ordinal}：${tour.title}（\`${tour.id}\`）`, '');
    lines.push(tour.description || '—', '');
    if (tour.steps.length === 0) {
      lines.push('该路线暂无步骤。', '');
    } else {
      for (const step of tour.steps) {
        const note = step.note ? `（${step.note}）` : '';
        lines.push(`${step.step}${note} — \`${step.filePath}:${step.lineNumber}\``);
      }
    }
    lines.push('', '```mermaid', tour.mermaid, '```', '');
  });
  return lines.join('\n');
}

/* ------------------------------------------------------------------ */
/* Main builder                                                        */
/* ------------------------------------------------------------------ */

/**
 * Aggregate the dashboard + tours and format a standard ONBOARDING.md
 * handover document: tech stack, architecture scale, masked config
 * topology, Top API sequence diagrams, and the three onboarding routes.
 */
export function buildOnboardingMarkdown(
  options: BuildOnboardingMarkdownOptions
): string {
  const {
    repoId,
    repoName,
    symbols,
    maxDepth = 5,
    topLimit = 10,
    now = () => new Date()
  } = options;

  const dashboard = buildDashboard({ repoId, repoName, symbols, maxDepth, topLimit });
  const tours = buildTours({ repoId, repoName, symbols, maxDepth });
  const title = repoName || repoId;

  const lines: string[] = [
    `# ${title} — ONBOARDING 架构交接手册`,
    '',
    `> 由 CodeCompass 自动生成 · repoId: \`${repoId}\` · 生成时间：${now().toISOString()}`,
    '> 配置值从不落盘（Issue 06 脱敏引擎），本文档不包含任何敏感配置值。',
    '',
    techStackSection(dashboard),
    scaleSection(dashboard),
    configSection(dashboard),
    topApisSection(dashboard),
    toursSection(tours)
  ];

  // Collapse ≥2 consecutive blank lines into one, keep a single trailing NL.
  const markdown = lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  return `${markdown}\n`;
}