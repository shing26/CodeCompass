import fs from 'node:fs';
import path from 'node:path';
import { existsSync } from 'node:fs';

/**
 * v0.8.0 — Self-contained HTML artifact export (Archify-style single file).
 *
 * A diagnosis result is rendered into one .html file with the topology
 * diagram, chain steps and code slices inlined. The mermaid runtime is
 * embedded from the local node_modules so the file renders offline and can be
 * archived with a PR; when no local copy exists it falls back to a CDN script
 * (the artifact then needs network to draw the diagram).
 */

export interface ArtifactSection {
  heading: string;
  body: string;
  kind?: 'text' | 'code';
}

export interface ArtifactInput {
  title: string;
  repoName: string;
  generatedAt?: string;
  mermaid?: string;
  sections: ArtifactSection[];
  deepLink?: string;
  summary?: string;
}

const CDN_MERMAID = 'https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js';

/** Locate a local mermaid build (monorepo-aware); null when unavailable. */
export function locateMermaidScript(fromDir = path.resolve(__dirname, '..')): string | null {
  const candidates = [
    path.resolve(fromDir, 'node_modules', 'mermaid', 'dist', 'mermaid.min.js'),
    path.resolve(fromDir, 'node_modules', 'mermaid', 'dist', 'mermaid.js'),
    // From services/control-plane: the web app's hoisted dependency.
    path.resolve(fromDir, '..', '..', 'apps', 'repoqa-web', 'node_modules', 'mermaid', 'dist', 'mermaid.min.js'),
    path.resolve(fromDir, '..', 'apps', 'repoqa-web', 'node_modules', 'mermaid', 'dist', 'mermaid.min.js')
  ];
  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function renderArtifactHtml(input: ArtifactInput): string {
  const mermaidScript = locateMermaidScript();
  const offlineReady = Boolean(mermaidScript);
  const mermaidTag = mermaidScript
    ? `<script>${fs.readFileSync(mermaidScript, 'utf8')}</script>`
    : `<script src="${CDN_MERMAID}"></script>`;

  const offlineWarning = offlineReady
    ? ''
    : `<div class="offline-warning">⚠️ 本工件未找到本地 mermaid 运行时，已回退 CDN 加载：断网打开时拓扑图不会渲染。在仓库内构建后重新导出即可自包含。</div>`;

  const sections = input.sections
    .map(
      (section) => `
    <section class="card">
      <h2>${escapeHtml(section.heading)}</h2>
      ${
        section.kind === 'code'
          ? `<pre class="code">${escapeHtml(section.body)}</pre>`
          : `<p>${escapeHtml(section.body).replace(/\n/g, '<br/>')}</p>`
      }
    </section>`
    )
    .join('\n');

  const diagram = input.mermaid
    ? `<section class="card"><h2>Topology</h2><pre class="mermaid">${escapeHtml(input.mermaid)}</pre></section>`
    : '';

  const summary = input.summary
    ? `<p class="summary">${escapeHtml(input.summary)}</p>`
    : '';
  const deepLink = input.deepLink
    ? `<p class="deeplink">Cockpit: <a href="${escapeHtml(input.deepLink)}">${escapeHtml(input.deepLink)}</a></p>`
    : '';

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${escapeHtml(input.title)}</title>
<style>
  :root { color-scheme: dark; }
  body { margin: 0; padding: 24px; background: #0b0e14; color: #d7dde8;
         font: 14px/1.6 "Segoe UI", system-ui, sans-serif; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  .meta { color: #8b93a7; font-size: 12px; margin-bottom: 16px; }
  .card { background: #12161f; border: 1px solid #232a38; border-radius: 8px;
          padding: 14px 16px; margin: 0 0 14px; max-width: 960px; }
  .card h2 { font-size: 13px; text-transform: uppercase; letter-spacing: .06em;
             color: #7aa2f7; margin: 0 0 8px; }
  pre.code, pre.mermaid { background: #0b0e14; border: 1px solid #1d2430;
          border-radius: 6px; padding: 10px 12px; overflow-x: auto;
          font: 12px/1.5 Consolas, monospace; color: #c0caf5; }
  p.summary { max-width: 960px; }
  .offline-warning { max-width: 960px; margin-bottom: 14px; padding: 10px 12px;
          border: 1px solid #e0af68; border-radius: 6px; color: #e0af68;
          background: rgba(224, 175, 104, .08); font-size: 12px; }
  .deeplink { font-size: 12px; color: #8b93a7; }
  .deeplink a { color: #7aa2f7; }
</style>
${mermaidTag}
<script>if (window.mermaid) { mermaid.initialize({ startOnLoad: true, theme: 'dark' }); }</script>
</head>
<body>
<h1>${escapeHtml(input.title)}</h1>
<p class="meta">repo ${escapeHtml(input.repoName)} · generated ${escapeHtml(input.generatedAt ?? new Date().toISOString())} · CodeCompass v0.8</p>
${offlineWarning}
${summary}
${deepLink}
${diagram}
${sections}
</body>
</html>
`;
}

export function writeArtifactFile(html: string, outPath: string): string {
  const absolute = path.resolve(outPath);
  fs.writeFileSync(absolute, html, 'utf8');
  return absolute;
}
