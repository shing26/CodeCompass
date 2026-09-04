import { useState } from 'react';
import type { IncidentCard, UseEvolutionSessionResult } from '../hooks/useEvolutionSession';
import type { RepoSymbol } from '../types';
import { EvidenceCard } from './EvidenceCard';
import { MermaidDiagram } from './MermaidDiagram';
import { StackTraceInput } from './StackTraceInput';

interface IncidentViewProps {
  repoName: string | null;
  /** Issue 25 / Ticket 01 — the App-owned dual-kind artifact stream (cards filtered to incidents). */
  session: UseEvolutionSessionResult;
  /** v0.11 — symbol catalog for MermaidDiagram brand badges (same as Canvas). */
  symbols?: RepoSymbol[];
  /** App-injected submit (consent-gated); routed to session.submitIncident. */
  onSubmit: (question: string, stack?: string) => void;
  onNavigate?: (file: string, line: number, lineEnd?: number, symbolName?: string) => void;
  /** Issue 23 integration — open the latest diagram inside the main workbench (Canvas). */
  onOpenInWorkbench?: () => void;
  /** Issue 23 integration — hand the crash symbol to the deterministic call-chain trace. */
  onTraceCrash?: (symbol: string, file: string) => void;
}

/** Status marker of one incident card in the stream timeline. */
function IncidentStatusMark({ card }: { card: IncidentCard }) {
  if (card.status === 'streaming')
    return <span data-testid="incident-card-live" className="text-accent">◌</span>;
  if (card.status === 'error')
    return <span data-testid="incident-card-failed" className="text-warning">⚠</span>;
  return <span data-testid="incident-card-done" className="text-success">✓</span>;
}

/** One incident investigation card: collapsed summary row, expandable to the findings. */
function IncidentStreamCard({
  card,
  expanded,
  onToggle,
  symbols,
  onNavigate,
  showActions,
  crashTarget,
  onTraceCrash,
  onOpenInWorkbench
}: {
  card: IncidentCard;
  expanded: boolean;
  onToggle: () => void;
  symbols: RepoSymbol[];
  onNavigate?: (file: string, line: number, lineEnd?: number, symbolName?: string) => void;
  showActions: boolean;
  crashTarget: { symbol: string; file: string } | null;
  onTraceCrash?: (symbol: string, file: string) => void;
  onOpenInWorkbench?: () => void;
}) {
  return (
    <article data-testid={card.id} className="rounded-md border border-line bg-surface">
      <button
        type="button"
        data-testid="incident-card-toggle"
        onClick={onToggle}
        className="flex w-full items-center gap-2 px-3 py-2 text-left"
      >
        <IncidentStatusMark card={card} />
        <span
          data-testid="incident-user-message"
          className="min-w-0 flex-1 truncate text-xs text-ink"
        >
          {card.intent}
        </span>
        {card.stack && (
          <span className="shrink-0 rounded bg-muted/10 px-1.5 py-0.5 text-[9px] font-semibold text-muted">
            堆栈
          </span>
        )}
        <span className="shrink-0 text-[10px] text-muted">{expanded ? '收起 ▲' : '展开 ▼'}</span>
      </button>

      {expanded && (
        <div className="space-y-3 border-t border-line p-3 text-sm text-ink">
          {/* Echo of the pasted stack (Issue 23) — expanded body keeps the raw excerpt. */}
          {card.stack && (
            <pre
              data-testid="incident-user-stack"
              className="max-h-40 overflow-auto whitespace-pre-wrap rounded border border-line bg-surface p-1.5 font-mono text-[10px] text-muted"
            >
              {card.stack}
            </pre>
          )}
          {card.answer ? (
            <div className="whitespace-pre-wrap">{card.answer}</div>
          ) : (
            <div className="text-xs text-muted">排查中…</div>
          )}
          {/* Ticket 06 — a done query with neither anchors nor a diagram is a break, never a silent success. */}
          {card.status === 'done' && card.break && (
            <div
              data-testid="incident-break"
              className="rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-xs"
            >
              <span className="font-semibold text-danger">Static Analysis Break</span>
              <span className="mt-1 block text-danger">
                该排查未解析出可锚定的证据，以下为已到达的内容。
              </span>
            </div>
          )}
          {card.diagram && (
            <MermaidDiagram code={card.diagram} onNavigate={onNavigate} symbols={symbols} />
          )}
          {card.evidence && card.evidence.length > 0 && (
            <EvidenceCard evidence={card.evidence} onNavigate={onNavigate} />
          )}
          {card.status === 'done' && (card.provenance || card.usage || card.lowConfidence) && (
            <div className="flex flex-wrap items-center gap-2 border-t border-line pt-2 text-[11px] text-muted">
              {card.provenance && (
                <span data-testid="incident-provenance">
                  {card.provenance === 'static' ? '静态图谱' : '模型推理'}
                </span>
              )}
              {card.lowConfidence && <span className="text-warning">低置信度</span>}
              {card.usage && (
                <span data-testid="incident-usage">本次 {card.usage.total} tokens</span>
              )}
            </div>
          )}
          {card.error && <p className="text-xs text-danger">{card.error}</p>}
          {showActions && (
            <div
              data-testid="incident-actions"
              className="flex flex-wrap items-center gap-2 border-t border-line pt-2"
            >
              <span className="text-[10px] font-semibold uppercase tracking-wide text-muted">
                接入工作台
              </span>
              {onTraceCrash && crashTarget && (
                <button
                  type="button"
                  data-testid="incident-trace-crash"
                  onClick={() => onTraceCrash(crashTarget.symbol, crashTarget.file)}
                  className="rounded-md border border-line bg-surface px-2 py-0.5 text-xs text-muted hover:border-accent/40 hover:text-accent"
                >
                  追踪 {crashTarget.symbol} 调用链 →
                </button>
              )}
              {onOpenInWorkbench && (
                <button
                  type="button"
                  data-testid="incident-open-workbench"
                  onClick={onOpenInWorkbench}
                  className="rounded-md border border-line bg-surface px-2 py-0.5 text-xs text-muted hover:border-accent/40 hover:text-accent"
                >
                  在工作台打开对话 →
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </article>
  );
}

/**
 * Issue 23 — Architecture & Incident Copilot view; Issue 25 / Ticket 01 —
 * rebuilt on the App-owned dual-kind artifact stream: every investigation is
 * an append-only incident card (same (repoId, commit) stream as evolution).
 * Streaming / reconnect / error state comes from the session hook; the
 * composer and the evidence rendering stay incident-specific.
 */
export function IncidentView({
  repoName,
  session,
  symbols = [],
  onSubmit,
  onNavigate,
  onOpenInWorkbench,
  onTraceCrash
}: IncidentViewProps) {
  // Explicit expand/collapse overrides; untracked cards default to
  // "latest open, history collapsed" (same rule as the evolution stream).
  const [openOverrides, setOpenOverrides] = useState<Record<string, boolean>>({});
  const cards = session.cards.filter((card): card is IncidentCard => card.kind === 'incident');

  // Issue 23 integration — crash point = first physically resolvable VERIFIED
  // assertion of the latest completed card (stack frames are resolved in
  // order, so the first match is the deepest frame of the pasted trace).
  const latestDone = [...cards].reverse().find((card) => card.status === 'done');
  const crashTarget = (() => {
    const row = latestDone?.evidence?.find(
      (candidate) =>
        candidate.status === 'VERIFIED' && candidate.file.length > 0 && candidate.line > 0
    );
    return row ? { symbol: row.label, file: row.file } : null;
  })();
  const actionsEnabled = Boolean(onOpenInWorkbench || onTraceCrash);

  return (
    <section data-testid="incident-view" className="flex min-h-0 flex-1 flex-col">
      <header className="flex items-center justify-between border-b border-line bg-surface px-3 py-1.5">
        <span className="text-xs font-semibold text-ink">排障副驾驶 · Architecture &amp; Incident Copilot</span>
        <span data-testid="incident-repo" className="text-[10px] text-muted">
          {repoName ?? '未连接仓库'}
        </span>
      </header>

      <div data-testid="incident-messages" className="custom-scroll min-h-0 flex-1 overflow-y-auto p-3">
        {cards.length === 0 && (
          <div data-testid="incident-empty" className="mx-auto mt-8 max-w-md text-center">
            <h2 className="text-base font-semibold text-ink">把线上故障贴进来</h2>
            <p className="mt-2 text-sm text-muted">
              粘贴堆栈或描述症状，副驾驶只用本仓库索引过的物理证据（file:line + commit）定位崩溃点、
              诊断链路与影响面；无法证实的部分会明确标注 BREAK / SUSPECT。
            </p>
          </div>
        )}
        {cards.map((card, index) => {
          const isLatest = index === cards.length - 1;
          const expanded = openOverrides[card.id] ?? isLatest;
          return (
            <IncidentStreamCard
              key={card.id}
              card={card}
              expanded={expanded}
              onToggle={() => setOpenOverrides((prev) => ({ ...prev, [card.id]: !expanded }))}
              symbols={symbols}
              onNavigate={onNavigate}
              showActions={actionsEnabled && isLatest && card.status === 'done'}
              crashTarget={crashTarget}
              onTraceCrash={onTraceCrash}
              onOpenInWorkbench={onOpenInWorkbench}
            />
          );
        })}
        {session.incidentReconnecting && (
          <div data-testid="incident-reconnecting" className="mt-2 text-xs text-warning">
            连接中断，正在自动重连…
          </div>
        )}
        {session.incidentRecovered && (
          <div data-testid="incident-recovered" className="mt-2 text-xs text-success">
            连接已恢复。
          </div>
        )}
        {session.incidentError && (
          <div data-testid="incident-error" className="mt-2 text-xs text-danger">
            {session.incidentError}
          </div>
        )}
      </div>

      <StackTraceInput streaming={session.incidentRunning} onSubmit={onSubmit} />
    </section>
  );
}
