import { useState } from 'react';
import type { RepoQAClient } from '../client/RepoQAClient';
import type { SnippetGraph } from '../types';
import { MermaidDiagram } from './MermaidDiagram';

/**
 * v1.4 票 02 — paste a snippet, see its call graph. No repository, no import
 * dialog: the server parses the source in memory and answers with the same
 * deterministic edges every other surface reads. Symbol names + positions only
 * — the pasted source never travels back over the wire.
 */

const STARTER_CODE = `function loadUser(id: string): string {
  const raw = fetchUser(id);
  return normalize(raw);
}

function fetchUser(id: string): string {
  return normalize(id);
}

function normalize(value: string): string {
  return value.trim();
}
`;

export function SnippetView({
  client,
  onBack
}: {
  client: RepoQAClient;
  /** Back to the empty/onboarding state (optional). */
  onBack?: () => void;
}) {
  const [source, setSource] = useState(STARTER_CODE);
  const [fileName, setFileName] = useState('');
  const [graph, setGraph] = useState<SnippetGraph | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const breakParts = graph
    ? [
        graph.breaks.external > 0 ? `片段外 ${graph.breaks.external}` : '',
        graph.breaks.dynamic > 0 ? `动态派发 ${graph.breaks.dynamic}` : '',
        graph.breaks.unresolved > 0 ? `片段内未绑定 ${graph.breaks.unresolved}` : ''
      ].filter((part) => part !== '')
    : [];

  const analyze = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await client.analyzeSnippet(source, fileName.trim() || undefined);
      setGraph(result);
    } catch (err) {
      setGraph(null);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main
      data-testid="snippet-view"
      className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto p-4 md:flex-row"
    >
      <section className="flex min-h-[16rem] flex-col md:w-1/2">
        <div className="mb-2 flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-ink">粘贴代码片段</h2>
          {onBack && (
            <button
              type="button"
              data-testid="snippet-back"
              onClick={onBack}
              className="text-xs text-muted hover:text-ink"
            >
              返回
            </button>
          )}
        </div>
        <p className="mb-2 text-xs text-muted">
          粘贴一段 TS / JS 源码，直接看它内部的调用关系——不导入仓库，不写磁盘。
          只解析这段代码自己：调用到片段外的名字会如实标为边界，不会编造目标。
        </p>
        <input
          data-testid="snippet-filename"
          value={fileName}
          onChange={(event) => setFileName(event.target.value)}
          placeholder="文件名（可选，如 auth.ts）"
          className="mb-2 w-full rounded-md border border-line px-2 py-1.5 text-xs text-ink outline-none focus:border-accent"
        />
        <textarea
          data-testid="snippet-source"
          value={source}
          onChange={(event) => setSource(event.target.value)}
          spellCheck={false}
          className="min-h-[12rem] flex-1 w-full resize-y rounded-md border border-line bg-subtle p-2 font-mono text-xs text-ink outline-none focus:border-accent"
        />
        <div className="mt-2 flex items-center gap-2">
          <button
            type="button"
            data-testid="snippet-analyze"
            disabled={busy || source.trim() === ''}
            onClick={() => void analyze()}
            className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-canvas hover:opacity-90 disabled:opacity-50"
          >
            {busy ? '解析中…' : '解析片段'}
          </button>
          <span className="text-micro text-muted">服务端内存解析，零 LLM。</span>
        </div>
      </section>

      <section className="min-h-0 flex-1 md:w-1/2">
        {error && (
          <p data-testid="snippet-error" className="rounded-md border border-line bg-subtle p-2 text-xs text-warning">
            解析失败：{error}
          </p>
        )}
        {!error && !graph && (
          <p className="text-xs text-muted">解析结果会显示在这里：函数列表 + 调用关系图。</p>
        )}
        {graph && (
          <div className="flex h-full min-h-0 flex-col gap-2">
            <div data-testid="snippet-stats" className="text-xs text-muted">
              {graph.stats.symbols} 个符号 · {graph.stats.edges} 条调用关系 ·{' '}
              {breakParts.length > 0
                ? `未解析边缘 ${graph.breaks.total} 处（${breakParts.join('、')}）`
                : '没有未解析边缘'}
              {graph.stats.truncated ? ` · 图中省略 ${graph.stats.droppedNodes} 个函数` : ''}
            </div>
            <MermaidDiagram code={graph.mermaid} />
            <ul data-testid="snippet-function-list" className="max-h-48 overflow-auto text-xs text-muted">
              {graph.nodes.map((node) => (
                <li key={node.id} className="flex items-baseline justify-between gap-2 border-b border-line py-0.5">
                  <span className="truncate font-mono text-ink">{node.name}</span>
                  <span className="shrink-0 text-micro">
                    L{node.line} · 入 {node.inDegree} / 出 {node.outDegree}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>
    </main>
  );
}
