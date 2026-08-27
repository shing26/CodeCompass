import { useEffect, useMemo, useState } from 'react';
import type { RepoQAClient } from '../client/RepoQAClient';
import type {
  ArchitectureDeltaReport,
  ArchitectureDeltaSymbol,
  Repo
} from '../types';

interface ArchitectureDeltaViewProps {
  repo: Repo | null;
  client: Pick<RepoQAClient, 'getArchitectureDelta'>;
}

function routeLabel(symbol: ArchitectureDeltaSymbol): string {
  const parent = symbol.parentType ? `${symbol.parentType}.` : '';
  return `${parent}${symbol.name}${symbol.displayPath ? ` ${symbol.displayPath}` : ''} @ ${symbol.file}:${symbol.lineStart}`;
}

async function copyText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand('copy');
  textarea.remove();
}

/** v0.6.0 — 架构差异工作台：base/head ref 的路由增删、断边与风险分级。 */
export function ArchitectureDeltaView({ repo, client }: ArchitectureDeltaViewProps) {
  const [base, setBase] = useState('origin/main');
  const [head, setHead] = useState('HEAD');
  const [delta, setDelta] = useState<ArchitectureDeltaReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1500);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const runDelta = async () => {
    if (!repo || loading) return;
    setLoading(true);
    setError(null);
    try {
      setDelta(await client.getArchitectureDelta(repo.id, base.trim(), head.trim()));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  const markdown = useMemo(() => {
    if (!delta) return '';
    const lines = [
      '# Architecture Delta',
      '',
      `- base: \`${delta.base}\``,
      `- head: \`${delta.head}\``,
      '',
      `- Added routes: ${delta.addedRoutes.length}`,
      `- Removed routes: ${delta.removedRoutes.length}`,
      `- Broken edges: ${delta.brokenEdges.length}`,
      `- Impacted APIs: ${delta.impactedApis.length}`,
      ''
    ];
    if (delta.addedRoutes.length > 0) {
      lines.push('## Added Routes', '');
      delta.addedRoutes.forEach((route) => lines.push(`- ${routeLabel(route)}`));
      lines.push('');
    }
    if (delta.removedRoutes.length > 0) {
      lines.push('## Removed Routes', '');
      delta.removedRoutes.forEach((route) => lines.push(`- ${routeLabel(route)}`));
      lines.push('');
    }
    if (delta.brokenEdges.length > 0) {
      lines.push('## Broken Edges', '');
      delta.brokenEdges.forEach((edge) =>
        lines.push(
          `- ${edge.from.file}:${edge.from.line} ${edge.from.method} -> ${edge.to.file}:${edge.to.line} ${edge.to.method}`
        )
      );
      lines.push('');
    }
    if (delta.impactedApis.length > 0) {
      lines.push('## Impacted APIs', '');
      delta.impactedApis.forEach((api) =>
        lines.push(
          `- [${api.riskLevel}] ${routeLabel(api.routeSymbol)} (${api.affectedBySymbols.join(', ')})`
        )
      );
      lines.push('');
    }
    return lines.join('\n');
  }, [delta]);

  const handleCopy = async () => {
    if (!markdown) return;
    await copyText(markdown);
    setCopied(true);
  };

  if (!repo) {
    return (
      <div
        data-testid="architecture-delta-empty"
        className="flex flex-1 items-center justify-center p-8"
      >
        <p className="text-sm text-muted">选择一个仓库后对比 base/head 架构差异。</p>
      </div>
    );
  }

  return (
    <div
      data-testid="architecture-delta"
      className="workbench-grid flex-1 overflow-y-auto p-4"
    >
      <div className="mx-auto max-w-4xl space-y-4">
        <header className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-ink">架构差异</h2>
            <p className="mt-0.5 truncate text-xs text-muted">{repo.name}</p>
          </div>
          <button
            type="button"
            data-testid="delta-copy"
            onClick={handleCopy}
            disabled={!markdown}
            className={`shrink-0 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-50 ${
              copied
                ? 'border-success/40 bg-success/10 text-success'
                : 'border-line bg-surface text-muted hover:border-accent hover:text-accent'
            }`}
          >
            {copied ? '已复制' : '复制报告'}
          </button>
        </header>

        <section className="rounded-md border border-line bg-surface p-3">
          <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
            <label className="flex flex-col gap-1 text-xs text-muted">
              Base ref
              <input
                data-testid="delta-base"
                value={base}
                onChange={(e) => setBase(e.target.value)}
                className="h-8 rounded-md border border-line bg-surface px-2 font-mono text-xs text-ink outline-none focus:border-accent"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-muted">
              Head ref
              <input
                data-testid="delta-head"
                value={head}
                onChange={(e) => setHead(e.target.value)}
                className="h-8 rounded-md border border-line bg-surface px-2 font-mono text-xs text-ink outline-none focus:border-accent"
              />
            </label>
            <button
              type="button"
              data-testid="delta-run"
              onClick={runDelta}
              disabled={loading || !base.trim() || !head.trim()}
              className="h-8 shrink-0 self-end rounded-md bg-accent px-4 text-xs font-medium text-white hover:bg-accent/90 disabled:opacity-50"
            >
              {loading ? '分析中…' : '运行差异分析'}
            </button>
          </div>
          {error && <p className="mt-2 text-xs text-danger">{error}</p>}
        </section>

        {delta && (
          <>
            <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <span
                data-testid="delta-added"
                className="rounded-md border border-line bg-surface px-3 py-2 text-xs text-muted"
              >
                <span className="block text-lg font-semibold text-success">
                  {delta.addedRoutes.length}
                </span>
                Added Routes
              </span>
              <span
                data-testid="delta-removed"
                className="rounded-md border border-line bg-surface px-3 py-2 text-xs text-muted"
              >
                <span className="block text-lg font-semibold text-danger">
                  {delta.removedRoutes.length}
                </span>
                Removed Routes
              </span>
              <span
                data-testid="delta-broken"
                className="rounded-md border border-line bg-surface px-3 py-2 text-xs text-muted"
              >
                <span className="block text-lg font-semibold text-warning">
                  {delta.brokenEdges.length}
                </span>
                Broken Edges
              </span>
              <span
                data-testid="delta-impact"
                className="rounded-md border border-line bg-surface px-3 py-2 text-xs text-muted"
              >
                <span className="block text-lg font-semibold text-accent">
                  {delta.impactedApis.length}
                </span>
                Impacted APIs
              </span>
            </section>

            {delta.addedRoutes.length > 0 && (
              <section className="rounded-md border border-line bg-surface p-3">
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-success">
                  新增路由
                </h3>
                <ul className="space-y-1 font-mono text-[11px] text-ink">
                  {delta.addedRoutes.map((route) => (
                    <li key={`${route.file}:${route.lineStart}:${route.name}`}>
                      <span className="mr-2 text-success">+</span>
                      {routeLabel(route)}
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {delta.removedRoutes.length > 0 && (
              <section className="rounded-md border border-line bg-surface p-3">
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-danger">
                  删除路由
                </h3>
                <ul className="space-y-1 font-mono text-[11px] text-ink">
                  {delta.removedRoutes.map((route) => (
                    <li key={`${route.file}:${route.lineStart}:${route.name}`}>
                      <span className="mr-2 text-danger">-</span>
                      {routeLabel(route)}
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {delta.brokenEdges.length > 0 && (
              <section className="rounded-md border border-line bg-surface p-3">
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-warning">
                  断边
                </h3>
                <ul className="space-y-1 font-mono text-[11px] text-ink">
                  {delta.brokenEdges.map((edge, index) => (
                    <li key={index}>
                      <span className="mr-2 text-warning">~</span>
                      {edge.from.file}:{edge.from.line} {edge.from.method} -&gt;{' '}
                      {edge.to.file}:{edge.to.line} {edge.to.method}
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {delta.impactedApis.length > 0 && (
              <section className="rounded-md border border-line bg-surface p-3">
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-accent">
                  受影响 API
                </h3>
                <ul className="space-y-1 font-mono text-[11px] text-ink">
                  {delta.impactedApis.map((api) => (
                    <li key={`${api.routeSymbol.file}:${api.routeSymbol.lineStart}:${api.routeSymbol.name}`}>
                      <span
                        className={`mr-2 rounded px-1.5 py-0.5 text-[9px] font-semibold ${
                          api.riskLevel === 'HIGH'
                            ? 'bg-warning/15 text-warning'
                            : api.riskLevel === 'MEDIUM'
                              ? 'bg-accent/10 text-accent'
                              : 'bg-success/10 text-success'
                        }`}
                      >
                        {api.riskLevel}
                      </span>
                      {routeLabel(api.routeSymbol)}
                      <span className="ml-2 text-muted">
                        ({api.affectedBySymbols.join(', ')})
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            <section className="rounded-md border border-line bg-surface p-3">
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">
                Markdown 报告
              </h3>
              <pre
                data-testid="delta-markdown"
                className="custom-scroll max-h-64 overflow-auto rounded-md border border-line bg-code px-3 py-2 font-mono text-[11px] leading-relaxed text-ink"
              >
                {markdown}
              </pre>
            </section>
          </>
        )}
      </div>
    </div>
  );
}
