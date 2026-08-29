import fs from 'node:fs';
import path from 'node:path';
import { existsSync } from 'node:fs';

/**
 * v0.9.0 — Multi-view self-contained HTML artifact export (Archify-style
 * single file). Extends the v0.8 single-diagram artifact with:
 *
 *  - view tabs: Architecture + Sequence (both data-backed); Lifecycle and
 *    Dataflow render an honest "no evidence yet" placeholder instead of
 *    inventing graphs (their AST sources ship in a later release),
 *  - lazy rendering: the Sequence view is stored as raw text and rendered
 *    through mermaid.run() only when its tab is first activated — rendering
 *    a hidden display:none container yields zero-width SVGs,
 *  - brand badges: inline SVGs keyed off dependency/config keyword evidence,
 *  - Story Beats: a Prev/Next stepper synced with code slices.
 *
 * The mermaid runtime is inlined from the local node_modules so the file
 * renders offline; without it the artifact falls back to a CDN and says so.
 */

export interface ArtifactSection {
  heading: string;
  body: string;
  kind?: 'text' | 'code';
}

export interface ArtifactStoryBeat {
  label: string;
  detail: string;
  code?: string;
}

export interface ArtifactInput {
  title: string;
  repoName: string;
  generatedAt?: string;
  /** Architecture view (flowchart). */
  mermaid?: string;
  /** Sequence view (mermaid sequenceDiagram), rendered lazily. */
  sequence?: string;
  badges?: string[];
  storyBeats?: ArtifactStoryBeat[];
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

/** Deterministic badge registry: dependency/config keyword → brand color.
 *  Single source of truth for both matching and rendering. */
const BADGE_REGISTRY: Array<{ name: string; keyword: string; color: string }> = [
  { name: 'Spring', keyword: 'spring', color: '#6db33f' },
  { name: 'React', keyword: 'react', color: '#61dafb' },
  { name: 'Redis', keyword: 'redis', color: '#dc382d' },
  { name: 'MySQL', keyword: 'mysql', color: '#4479a1' },
  { name: 'MyBatis', keyword: 'mybatis', color: '#000000' },
  { name: 'FastAPI', keyword: 'fastapi', color: '#009688' },
  { name: 'Kafka', keyword: 'kafka', color: '#231f20' },
  { name: 'Express', keyword: 'express', color: '#52636b' },
  { name: 'Gin', keyword: 'gin', color: '#00acd7' }
];

export function deriveBadges(evidenceText: string): string[] {
  const lower = evidenceText.toLowerCase();
  return BADGE_REGISTRY.filter((badge) => lower.includes(badge.keyword)).map(
    (badge) => badge.name
  );
}

function badgeSvg(name: string): string {
  const color =
    BADGE_REGISTRY.find((badge) => badge.name === name)?.color ?? '#7aa2f7';
  const width = 14 + name.length * 8;
  return (
    `<svg class="badge" width="${width}" height="22" viewBox="0 0 ${width} 22" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${escapeHtml(name)}">` +
    `<rect width="${width}" height="22" rx="4" fill="${color}" fill-opacity="0.18"/>` +
    `<circle cx="11" cy="11" r="4" fill="${color}"/>` +
    `<text x="20" y="15" font-size="11" fill="#d7dde8" font-family="Segoe UI, sans-serif">${escapeHtml(name)}</text>` +
    `</svg>`
  );
}

const STORY_BEATS_JS = `
(function () {
  var beats = JSON.parse(document.getElementById('story-beats-data').textContent || '[]');
  if (!beats.length) return;
  var idx = 0;
  var label = document.getElementById('beat-label');
  var detail = document.getElementById('beat-detail');
  var code = document.getElementById('beat-code');
  var counter = document.getElementById('beat-counter');
  var prev = document.getElementById('beat-prev');
  var next = document.getElementById('beat-next');
  function render() {
    var beat = beats[idx];
    label.textContent = beat.label;
    detail.textContent = beat.detail;
    code.textContent = beat.code || '(no code slice for this step)';
    counter.textContent = (idx + 1) + ' / ' + beats.length;
    prev.disabled = idx === 0;
    next.disabled = idx === beats.length - 1;
  }
  prev.addEventListener('click', function () { if (idx > 0) { idx--; render(); } });
  next.addEventListener('click', function () { if (idx < beats.length - 1) { idx++; render(); } });
  render();
})();
`;

const VIEWS_JS = `
(function () {
  // Lazy mermaid render (reminder #3): a hidden display:none container gives
  // mermaid a zero-width box, so the Sequence view renders on first activation.
  var seqRendered = false;
  var seqCode = '';
  var seqNode = document.getElementById('view-sequence');
  var seqSrc = document.getElementById('sequence-src');
  if (seqSrc) seqCode = seqSrc.textContent || '';
  function activate(view) {
    document.querySelectorAll('.view').forEach(function (el) {
      el.style.display = el.id === 'view-' + view ? 'block' : 'none';
    });
    document.querySelectorAll('.tab').forEach(function (el) {
      el.classList.toggle('active', el.dataset.view === view);
    });
    if (view === 'sequence' && !seqRendered && seqCode && window.mermaid) {
      seqNode.textContent = seqCode;
      window.mermaid.run({ nodes: [seqNode] }).catch(function () {});
      seqRendered = true;
    }
  }
  document.querySelectorAll('.tab').forEach(function (el) {
    el.addEventListener('click', function () { activate(el.dataset.view); });
  });
  // Sequence-only artifacts open on the sequence tab — render it immediately.
  var initial = document.querySelector('.tab.active');
  if (initial && initial.dataset.view === 'sequence') activate('sequence');
})();
`;

export function renderArtifactHtml(input: ArtifactInput): string {
  const mermaidScript = locateMermaidScript();
  const offlineReady = Boolean(mermaidScript);
  const mermaidTag = mermaidScript
    ? `<script>${fs.readFileSync(mermaidScript, 'utf8')}</script>`
    : `<script src="${CDN_MERMAID}"></script>`;

  const offlineWarning = offlineReady
    ? ''
    : `<div class="offline-warning">⚠️ 本工件未找到本地 mermaid 运行时，已回退 CDN 加载：断网打开时拓扑图不会渲染。在仓库内构建后重新导出即可自包含。</div>`;

  const badges = (input.badges ?? []).map(badgeSvg).join('');

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

  const hasViews = Boolean(input.mermaid || input.sequence);
  const viewsBlock = hasViews
    ? `
  <div class="tabs">
    ${input.mermaid ? `<button class="tab active" data-view="arch">Architecture</button>` : ''}
    ${input.sequence ? `<button class="tab${input.mermaid ? '' : ' active'}" data-view="sequence">Sequence</button>` : ''}
    <button class="tab disabled" disabled title="Lifecycle / Dataflow 需要方法体级证据，规划于 v1.0">Lifecycle (v1.0)</button>
    <button class="tab disabled" disabled title="Lifecycle / Dataflow 需要方法体级证据，规划于 v1.0">Dataflow (v1.0)</button>
  </div>
  ${input.mermaid ? `<div class="card view" id="view-arch"><h2>Architecture</h2><pre class="mermaid">${escapeHtml(input.mermaid)}</pre></div>` : ''}
  ${
    input.sequence
      ? `<div class="card view" id="view-sequence" style="display:${input.mermaid ? 'none' : 'block'}"><h2>Sequence</h2><pre class="mermaid"></pre><script type="text/plain" id="sequence-src">${escapeHtml(input.sequence)}</script></div>`
      : ''
  }`
    : '';

  const beats = input.storyBeats ?? [];
  const beatsBlock = beats.length
    ? `
  <section class="card" id="story-beats">
    <h2>Story Beats</h2>
    <div class="beat-bar">
      <button id="beat-prev">◀ Prev</button>
      <span id="beat-counter">1 / ${beats.length}</span>
      <button id="beat-next">Next ▶</button>
      <span id="beat-label" class="beat-label"></span>
    </div>
    <p id="beat-detail" class="beat-detail"></p>
    <pre id="beat-code" class="code"></pre>
    <script type="application/json" id="story-beats-data">${escapeHtml(JSON.stringify(beats))}</script>
  </section>`
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
  .meta { color: #8b93a7; font-size: 12px; margin-bottom: 12px; }
  .badges { margin-bottom: 14px; display: flex; gap: 6px; flex-wrap: wrap; }
  .tabs { display: flex; gap: 6px; margin-bottom: 12px; max-width: 960px; }
  .tab { background: #12161f; color: #8b93a7; border: 1px solid #232a38;
         border-radius: 6px; padding: 5px 12px; font-size: 12px; cursor: pointer; }
  .tab.active { color: #7aa2f7; border-color: #7aa2f7; }
  .tab.disabled { opacity: .45; cursor: not-allowed; }
  .card { background: #12161f; border: 1px solid #232a38; border-radius: 8px;
          padding: 14px 16px; margin: 0 0 14px; max-width: 960px; }
  .card h2 { font-size: 13px; text-transform: uppercase; letter-spacing: .06em;
             color: #7aa2f7; margin: 0 0 8px; }
  pre.code, pre.mermaid { background: #0b0e14; border: 1px solid #1d2430;
          border-radius: 6px; padding: 10px 12px; overflow-x: auto;
          font: 12px/1.5 Consolas, monospace; color: #c0caf5; }
  p.summary { max-width: 960px; }
  .deeplink { font-size: 12px; color: #8b93a7; }
  .deeplink a { color: #7aa2f7; }
  .offline-warning { max-width: 960px; margin-bottom: 14px; padding: 10px 12px;
          border: 1px solid #e0af68; border-radius: 6px; color: #e0af68;
          background: rgba(224, 175, 104, .08); font-size: 12px; }
  .beat-bar { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; }
  .beat-bar button { background: #1a2030; color: #d7dde8; border: 1px solid #2b3446;
          border-radius: 6px; padding: 4px 12px; cursor: pointer; font-size: 12px; }
  .beat-bar button:disabled { opacity: .4; cursor: not-allowed; }
  .beat-label { color: #7aa2f7; font-size: 13px; font-weight: 600; }
  .beat-detail { color: #8b93a7; font-size: 12px; margin: 4px 0 8px; }
</style>
${mermaidTag}
<script>if (window.mermaid) { mermaid.initialize({ startOnLoad: true, theme: 'dark' }); }</script>
</head>
<body>
<h1>${escapeHtml(input.title)}</h1>
<p class="meta">repo ${escapeHtml(input.repoName)} · generated ${escapeHtml(input.generatedAt ?? new Date().toISOString())} · CodeCompass v0.9</p>
${badges ? `<div class="badges">${badges}</div>` : ''}
${offlineWarning}
${summary}
${deepLink}
${viewsBlock}
${beatsBlock}
${sections}
<script>${VIEWS_JS}</script>
<script>${STORY_BEATS_JS}</script>
</body>
</html>
`;
}

export function writeArtifactFile(html: string, outPath: string): string {
  const absolute = path.resolve(outPath);
  fs.writeFileSync(absolute, html, 'utf8');
  return absolute;
}
