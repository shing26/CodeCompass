import { useEffect, useMemo, useState } from 'react';
import type { Repo, RepoDashboard } from '../types';

interface CiGateViewProps {
  repo: Repo | null;
  dashboard: RepoDashboard | null;
}

function formatNumber(value: number): string {
  return value.toLocaleString('en-US');
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

/**
 * Issue 29 workbench panel: CI gate policy knobs plus the generated
 * `codecompass pr-summary` command. The panel never fabricates a gate verdict;
 * it only composes policy and reflects the current indexed baseline.
 */
export function CiGateView({ repo, dashboard }: CiGateViewProps) {
  const [base, setBase] = useState('origin/main');
  const [head, setHead] = useState('HEAD');
  const [maxRoutes, setMaxRoutes] = useState(10);
  const [failOnBreak, setFailOnBreak] = useState(true);
  const [failOnAuthImpact, setFailOnAuthImpact] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1500);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const command = useMemo(() => {
    const parts = ['npx codecompass pr-summary', base, head];
    if (repo?.localPath) parts.push(`"${repo.localPath}"`);
    parts.push(`--max-affected-routes ${maxRoutes}`);
    if (failOnBreak) parts.push('--fail-on-break');
    if (failOnAuthImpact) parts.push('--fail-on-auth-impact');
    return parts.join(' ');
  }, [base, failOnAuthImpact, failOnBreak, head, maxRoutes, repo?.localPath]);

  const handleCopy = async () => {
    await copyText(command);
    setCopied(true);
  };

  if (!repo) {
    return (
      <div data-testid="ci-gate-empty" className="flex flex-1 items-center justify-center p-8">
        <p className="text-sm text-muted">选择一个仓库后配置 CI 门禁策略。</p>
      </div>
    );
  }

  return (
    <div data-testid="ci-gate" className="workbench-grid flex-1 overflow-y-auto p-4">
      <div className="mx-auto max-w-3xl space-y-4">
        <header className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-ink">CI 门禁</h2>
            <p className="mt-0.5 truncate text-xs text-muted">{repo.name}</p>
          </div>
          <button
            type="button"
            data-testid="copy-ci-command"
            onClick={handleCopy}
            className={`shrink-0 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors ${
              copied
                ? 'border-success/40 bg-success/10 text-success'
                : 'border-line bg-surface text-muted hover:border-accent hover:text-accent'
            }`}
          >
            {copied ? '已复制' : '复制 CI 命令'}
          </button>
        </header>

        <section className="rounded-md border border-line bg-surface p-3">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">
            门禁策略
          </h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-xs text-muted">
              影响路由阈值
              <input
                data-testid="ci-max-routes"
                type="number"
                min={1}
                value={maxRoutes}
                onChange={(e) => setMaxRoutes(Number(e.target.value) || 1)}
                className="h-8 rounded-md border border-line bg-surface px-2 text-sm text-ink outline-none focus:border-accent"
              />
            </label>
            <label className="flex items-center gap-2 text-xs text-muted">
              <input
                data-testid="ci-fail-on-break"
                type="checkbox"
                checked={failOnBreak}
                onChange={(e) => setFailOnBreak(e.target.checked)}
                className="h-4 w-4 accent-[rgb(var(--color-accent))]"
              />
              断链检测
            </label>
            <label className="flex items-center gap-2 text-xs text-muted">
              <input
                data-testid="ci-fail-on-auth-impact"
                type="checkbox"
                checked={failOnAuthImpact}
                onChange={(e) => setFailOnAuthImpact(e.target.checked)}
                className="h-4 w-4 accent-[rgb(var(--color-accent))]"
              />
              未鉴权敏感链路
            </label>
            <div className="flex items-center gap-2">
              <label className="flex flex-1 flex-col gap-1 text-xs text-muted">
                Base
                <input
                  data-testid="ci-base"
                  value={base}
                  onChange={(e) => setBase(e.target.value)}
                  className="h-8 rounded-md border border-line bg-surface px-2 font-mono text-xs text-ink outline-none focus:border-accent"
                />
              </label>
              <label className="flex flex-1 flex-col gap-1 text-xs text-muted">
                Head
                <input
                  data-testid="ci-head"
                  value={head}
                  onChange={(e) => setHead(e.target.value)}
                  className="h-8 rounded-md border border-line bg-surface px-2 font-mono text-xs text-ink outline-none focus:border-accent"
                />
              </label>
            </div>
          </div>
        </section>

        <section className="rounded-md border border-line bg-surface p-3">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">基线</h3>
          <div data-testid="ci-baseline" className="flex flex-wrap gap-2">
            <span className="rounded-md border border-line bg-subtle px-2 py-1 text-xs text-muted">
              {dashboard ? `${formatNumber(dashboard.scale.routes)} Routes` : '—'}
            </span>
            <span className="rounded-md border border-line bg-subtle px-2 py-1 text-xs text-muted">
              {dashboard ? `${formatNumber(dashboard.topApis.length)} Top APIs` : '—'}
            </span>
            <span className="rounded-md border border-line bg-subtle px-2 py-1 text-xs text-muted">
              {dashboard ? `${formatNumber(dashboard.scale.files)} Files` : '—'}
            </span>
          </div>
        </section>

        <section className="rounded-md border border-line bg-surface p-3">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">命令</h3>
          <pre
            data-testid="ci-command"
            className="overflow-x-auto rounded-md border border-line bg-code px-3 py-2 font-mono text-[11px] leading-relaxed text-ink"
          >
            {command}
          </pre>
        </section>
      </div>
    </div>
  );
}
