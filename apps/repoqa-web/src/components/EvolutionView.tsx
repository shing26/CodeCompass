import { useCallback, useEffect, useRef, useState } from 'react';
import type { RepoQAClient, EvolveStreamLike } from '../client/RepoQAClient';
import { MermaidDiagram } from './MermaidDiagram';
import type {
  ConventionConflictDetail,
  EvolveEvent,
  EvolutionIntentEcho,
  ModuleEvolutionResult,
  Repo,
  RepoQaEvolveStage
} from '../types';

interface EvolutionViewProps {
  repo: Repo | null;
  client: Pick<RepoQAClient, 'evolveStream'>;
  /** Jump an anchor / placement file into the Monaco Inspector. */
  onNavigate?: (file: string, line: number) => void;
}

/** Stage pipeline shown as the run header while the stream is live. */
const STAGE_ORDER = ['intent_parse', 'target_resolve', 'convention_scan', 'pipeline', 'diagram'] as const;

const STAGE_LABEL: Record<string, string> = {
  intent_parse: '意图解析',
  target_resolve: '目标锚定',
  convention_scan: '惯例嗅探',
  pipeline: '演进推演',
  diagram: '图谱投射'
};

type StageState = Record<string, 'running' | 'done'>;

/** Wrap a base filename with its click-through affordance. */
function FileLink({
  file,
  line,
  onNavigate
}: {
  file: string;
  line: number;
  onNavigate?: (file: string, line: number) => void;
}) {
  if (!onNavigate) return <span className="font-mono">{file}</span>;
  return (
    <button
      type="button"
      onClick={() => onNavigate(file, line)}
      className="font-mono text-accent underline decoration-dotted hover:opacity-80"
      title={`${file}:${line}`}
    >
      {file}
    </button>
  );
}

/** ConventionManifestCard — decided axes with coverage + divergent anchors. */
function ConventionCard({
  result,
  onNavigate
}: {
  result: ModuleEvolutionResult;
  onNavigate?: (file: string, line: number) => void;
}) {
  const axes = (result.conventions?.axes ?? []).filter((axis) => axis.verdict);
  if (axes.length === 0) return null;
  return (
    <section data-testid="evolve-conventions" className="rounded-md border border-line bg-surface p-3">
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">惯例清单</h3>
      <ul className="space-y-2 text-xs">
        {axes.map((axis) => (
          <li key={axis.axis}>
            <div className="flex flex-wrap items-baseline gap-2">
              <span
                data-testid={`evolve-axis-${axis.axis}`}
                className={`rounded px-1.5 py-0.5 text-[9px] font-semibold ${
                  axis.coverage && axis.coverage.total > 0 && axis.coverage.match / axis.coverage.total >= 0.85
                    ? 'bg-success/10 text-success'
                    : 'bg-warning/10 text-warning'
                }`}
              >
                {axis.axis}
              </span>
              <span className="text-ink">{axis.verdict}</span>
              {axis.coverage && axis.coverage.total > 0 && (
                <span className="text-muted">
                  {axis.coverage.match}/{axis.coverage.total}
                </span>
              )}
            </div>
            {(axis.dissidents?.length ?? 0) > 0 && (
              <div className="mt-1 flex flex-wrap gap-2 text-[11px] text-muted">
                <span>偏离样本:</span>
                {axis.dissidents!.map((anchor) => (
                  <FileLink key={`${anchor.file}:${anchor.line}`} file={`${anchor.file}:${anchor.line}`} line={anchor.line} onNavigate={onNavigate} />
                ))}
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** PlacementPlanCard — where the new code lands and how it wires in. */
function PlacementCard({
  result,
  onNavigate
}: {
  result: ModuleEvolutionResult;
  onNavigate?: (file: string, line: number) => void;
}) {
  const placement = result.placement;
  if (!placement) return null;
  return (
    <section data-testid="evolve-placement" className="rounded-md border border-line bg-surface p-3">
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">落位方案</h3>
      <p className="mb-1 font-mono text-[11px] text-ink">{placement.packagePath}</p>
      <ul className="space-y-1 text-xs text-ink">
        {placement.files.map((file) => (
          <li key={file.filePath}>
            <span className="mr-2 rounded bg-accent/10 px-1.5 py-0.5 text-[9px] font-semibold text-accent">
              {file.role}
            </span>
            <FileLink file={file.filePath} line={1} onNavigate={onNavigate} />
          </li>
        ))}
      </ul>
      {placement.injection.style !== 'unsupported' && (
        <p className="mt-2 text-[11px] text-muted">
          注入:{placement.injection.style}
          {placement.injection.signature ? ` · ${placement.injection.signature}` : ''}
        </p>
      )}
      {placement.handlerSignature && (
        <p className="mt-1 font-mono text-[11px] text-muted">{placement.handlerSignature}</p>
      )}
    </section>
  );
}

/** DeadCodeCascadeCard — DEPRECATE orphan checklist, anchored to source. */
function DeadCodeCard({
  result,
  onNavigate
}: {
  result: ModuleEvolutionResult;
  onNavigate?: (file: string, line: number) => void;
}) {
  const orphans = result.blastRadius.orphanedSymbols;
  if (orphans.length === 0) return null;
  return (
    <section data-testid="evolve-deadcode" className="rounded-md border border-line bg-surface p-3">
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">
        死代码级联({orphans.length})
      </h3>
      <ul className="space-y-1 text-xs">
        {orphans.map((orphan) => (
          <li key={`${orphan.filePath}:${orphan.line}:${orphan.name}`} className="flex items-center gap-2">
            <input type="checkbox" className="h-3 w-3 accent-[var(--color-accent)]" readOnly />
            <span className="text-ink">{orphan.name}</span>
            <FileLink file={`${orphan.filePath}:${orphan.line}`} line={orphan.line} onNavigate={onNavigate} />
          </li>
        ))}
      </ul>
    </section>
  );
}

/** RiskChecklistCard — transaction decoupling + weak-convention risks. */
function RiskCard({ result }: { result: ModuleEvolutionResult }) {
  const risks = result.risks ?? [];
  if (risks.length === 0) return null;
  return (
    <section data-testid="evolve-risks" className="rounded-md border border-line bg-surface p-3">
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">风险与建议</h3>
      <ul className="space-y-2 text-xs">
        {risks.map((risk, index) => (
          <li key={index}>
            <span
              className={`mr-2 rounded px-1.5 py-0.5 text-[9px] font-semibold ${
                risk.kind === 'transaction-warning' ? 'bg-warning/10 text-warning' : 'bg-accent/10 text-accent'
              }`}
            >
              {risk.kind === 'transaction-warning' ? '事务解耦' : '惯例分歧'}
            </span>
            <span className="text-ink">{risk.message}</span>
            {risk.suggestion && <p className="mt-0.5 pl-1 text-[11px] text-muted">建议:{risk.suggestion}</p>}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Issue 24 / Ticket 04 — Evolution workbench: intent → four artifact cards. */
export function EvolutionView({ repo, client, onNavigate }: EvolutionViewProps) {
  const [intent, setIntent] = useState('');
  const [running, setRunning] = useState(false);
  const [stages, setStages] = useState<StageState>({});
  const [echo, setEcho] = useState<EvolutionIntentEcho | null>(null);
  const [result, setResult] = useState<ModuleEvolutionResult | null>(null);
  const [mermaid, setMermaid] = useState<string | null>(null);
  const [commit, setCommit] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<ConventionConflictDetail | null>(null);
  // Pinned target from a Correction-Pill switch — re-submits with it.
  const [pinnedTarget, setPinnedTarget] = useState<string | null>(null);
  const streamRef = useRef<EvolveStreamLike | null>(null);

  useEffect(() => () => streamRef.current?.close(), []);

  const reset = () => {
    setStages({});
    setEcho(null);
    setResult(null);
    setMermaid(null);
    setCommit(null);
    setError(null);
    setConflict(null);
  };

  const consume = useCallback(
    (event: EvolveEvent) => {
      if (event.type === 'stage') {
        const payload = event.payload as RepoQaEvolveStage;
        setStages((prev) => ({ ...prev, [payload.stage]: payload.status }));
        if (payload.intentEcho) setEcho(payload.intentEcho);
      } else if (event.type === 'done') {
        setEcho(event.payload.intentEcho);
        setResult(event.payload.result);
        setMermaid(event.payload.mermaid ?? null);
        setCommit(event.payload.commit ?? null);
      } else {
        setError(event.payload.error);
        setConflict(event.payload.conventionConflict ?? null);
      }
    },
    []
  );

  const run = async (targetOverride?: string) => {
    if (!repo || !intent.trim() || running) return;
    streamRef.current?.close();
    reset();
    setRunning(true);
    const target = targetOverride ?? pinnedTarget ?? undefined;
    const stream = client.evolveStream(repo.id, intent.trim(), target);
    streamRef.current = stream;
    stream.onEvent(consume);
    stream.onError((err) => {
      setError(err instanceof Error ? err.message : String(err));
    });
    stream.onDone(() => setRunning(false));
    await stream.connect();
  };

  if (!repo) {
    return (
      <div data-testid="evolution-empty" className="flex flex-1 items-center justify-center p-8">
        <p className="text-sm text-muted">选择一个仓库后输入演进意图。</p>
      </div>
    );
  }

  const runningStageIndex = STAGE_ORDER.findIndex((stage) => stages[stage] === 'running');

  return (
    <div data-testid="evolution-view" className="flex-1 overflow-y-auto p-4">
      <div className="mx-auto max-w-4xl space-y-4">
        <header>
          <h2 className="text-base font-semibold text-ink">演进推演</h2>
          <p className="mt-0.5 truncate text-xs text-muted">
            {repo.name}
            {commit ? ` · @ ${commit}` : ''}
          </p>
        </header>

        <section className="rounded-md border border-line bg-surface p-3">
          <label className="flex flex-col gap-2 text-xs text-muted">
            演进意图(自然语言,如「给订单模块加 Excel 导出」)
            <textarea
              data-testid="evolve-intent"
              value={intent}
              onChange={(e) => setIntent(e.target.value)}
              rows={2}
              className="rounded-md border border-line bg-surface px-2 py-1.5 text-xs text-ink outline-none focus:border-accent"
              placeholder="给订单模块加 Excel 导出"
            />
          </label>
          <button
            type="button"
            data-testid="evolve-run"
            onClick={() => run()}
            disabled={running || !intent.trim()}
            className="mt-2 rounded-md bg-accent px-4 py-1.5 text-xs font-medium text-white hover:bg-accent/90 disabled:opacity-50"
          >
            {running ? '推演中…' : '开始推演'}
          </button>
          {error && <p className="mt-2 text-xs text-danger">{error}</p>}
        </section>

        {/* Intent echo + Correction Pill (target anchoring transparency) */}
        {echo && (
          <section data-testid="evolve-echo" className="rounded-md border border-line bg-surface p-3">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="rounded bg-accent/10 px-1.5 py-0.5 text-[9px] font-semibold text-accent">
                {echo.intentType}
              </span>
              <span data-testid="evolve-echo-parsedby" className="text-muted">
                {echo.parsedBy === 'llm' ? 'LLM 解析' : '确定性解析'}
              </span>
              {echo.resolvedTarget ? (
                <span data-testid="evolve-target-pill" className="text-ink">
                  🎯 目标锚定:{echo.resolvedTarget}
                  {echo.alternatives[0] && (
                    <span className="text-muted">
                      {' '}(匹配 {Math.round(echo.alternatives[0].score)}%)
                    </span>
                  )}
                </span>
              ) : (
                <span data-testid="evolve-target-pill" className="text-warning">
                  未锚定目标:{echo.rawKeyword}
                </span>
              )}
            </div>
            {echo.extensionGoal && <p className="mt-1 text-[11px] text-muted">扩展目标:{echo.extensionGoal}</p>}
            {(echo.alternatives.length > 1 || (echo.resolvedTarget && echo.alternatives.length > 0)) && (
              <div data-testid="evolve-alternatives" className="mt-2 flex flex-wrap items-center gap-2 text-[11px]">
                <span className="text-muted">切换备选:</span>
                {echo.alternatives
                  .filter((alt) => alt.symbol !== echo.resolvedTarget)
                  .slice(0, 3)
                  .map((alt) => (
                    <button
                      key={alt.symbol}
                      type="button"
                      data-testid={`evolve-alt-${alt.symbol}`}
                      onClick={() => {
                        setPinnedTarget(alt.symbol);
                        void run(alt.symbol);
                      }}
                      className="rounded border border-line bg-surface px-2 py-0.5 text-muted hover:border-accent hover:text-accent"
                    >
                      {alt.symbol} ({Math.round(alt.score)}%)
                    </button>
                  ))}
              </div>
            )}
          </section>
        )}

        {/* Stage pipeline header */}
        {(running || Object.keys(stages).length > 0) && (
          <section data-testid="evolve-stages" className="flex flex-wrap gap-2 text-[11px]">
            {STAGE_ORDER.map((stage, index) => {
              const state = stages[stage];
              const cls =
                state === 'done'
                  ? 'border-success/40 bg-success/10 text-success'
                  : state === 'running'
                    ? 'border-accent/40 bg-accent/10 text-accent'
                    : 'border-line bg-surface text-muted';
              return (
                <span key={stage} className={`rounded border px-2 py-0.5 ${cls}`}>
                  {index + 1}. {STAGE_LABEL[stage]}
                  {state === 'done' ? ' ✓' : state === 'running' ? ' …' : ''}
                </span>
              );
            })}
          </section>
        )}

        {/* Structured convention conflict (planned outcome, not a crash) */}
        {conflict && (
          <section data-testid="evolve-conflict" className="rounded-md border border-warning/40 bg-warning/5 p-3">
            <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-warning">
              惯例冲突 · {conflict.axis}
            </h3>
            <p className="text-xs text-ink">{conflict.verdict}</p>
            {conflict.coverage && (
              <p className="mt-0.5 text-[11px] text-muted">
                覆盖率 {conflict.coverage.match}/{conflict.coverage.total}
              </p>
            )}
            {conflict.suggestion && <p className="mt-1 text-xs text-ink">建议:{conflict.suggestion}</p>}
            {(conflict.anchors?.length ?? 0) > 0 && (
              <div className="mt-1 flex flex-wrap gap-2 text-[11px]">
                {conflict.anchors.map((anchor) => (
                  <FileLink
                    key={`${anchor.file}:${anchor.line}`}
                    file={`${anchor.file}:${anchor.line}`}
                    line={anchor.line}
                    onNavigate={onNavigate}
                  />
                ))}
              </div>
            )}
          </section>
        )}

        {/* Four artifact cards */}
        {result && (
          <>
            <ConventionCard result={result} onNavigate={onNavigate} />
            <PlacementCard result={result} onNavigate={onNavigate} />
            <DeadCodeCard result={result} onNavigate={onNavigate} />
            <RiskCard result={result} />
            {mermaid && (
              <section data-testid="evolve-diagram" className="rounded-md border border-line bg-surface p-3">
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">
                  落位靶点(引擎编译产物)
                </h3>
                <MermaidDiagram code={mermaid} onNavigate={onNavigate} highlightNode={echo?.resolvedTarget ?? undefined} />
              </section>
            )}
            {result.checklists.length > 0 && (
              <section data-testid="evolve-checklists" className="rounded-md border border-line bg-surface p-3">
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">变更清单</h3>
                <ul className="space-y-1 text-xs">
                  {result.checklists.map((item, index) => (
                    <li key={index} className="flex flex-wrap items-baseline gap-2">
                      <span className="rounded bg-muted/10 px-1.5 py-0.5 text-[9px] font-semibold text-muted">
                        {item.action} · {item.category}
                      </span>
                      <span className="text-ink">{item.description}</span>
                      <FileLink file={`${item.filePath}`} line={1} onNavigate={onNavigate} />
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </>
        )}

        {/* Keep the layout honest while stages run with nothing to show yet */}
        {running && runningStageIndex >= 0 && !result && !error && (
          <p className="text-xs text-muted" data-testid="evolve-progress">
            {STAGE_LABEL[STAGE_ORDER[runningStageIndex]]}…
          </p>
        )}
      </div>
    </div>
  );
}
