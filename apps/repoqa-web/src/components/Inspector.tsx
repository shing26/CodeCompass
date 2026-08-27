import { useEffect, useMemo, useRef, useState } from 'react';
import Editor, { type OnMount } from '@monaco-editor/react';
import type { editor } from 'monaco-editor';
import { monaco } from '../client/monacoSetup';
import type { InspectorState } from '../hooks/useInspector';
import type { UseReverseDepsResult } from '../hooks/useReverseDeps';
import type { UseSubgraphContextResult } from '../hooks/useSubgraphContext';
import { EMPTY_SYMBOL_RESOURCE, isSymbolResolutionError } from '../hooks/useSymbolResource';
import { SubgraphPanel } from './SubgraphPanel';
import { useTheme } from '../hooks/useTheme';
import type { Anchor, TokenUsage } from '../types';

export interface InspectorProps extends Omit<InspectorState, 'symbolName'> {
  symbolName?: string | null;
  onBack: () => void;
  onForward: () => void;
  canGoBack: boolean;
  canGoForward: boolean;
  /** Bug-04: narrow viewports render the inspector as an off-canvas drawer. */
  open: boolean;
  /** Close the drawer (mobile); on desktop the close button is hidden. */
  onClose: () => void;
  /** Issue 28: copy the Graph RAG agent context for the current file. */
  onCopyAgentContext?: () => void | Promise<void>;
  /** Issue 31: session token usage shown against the Inspector budget. */
  usage?: TokenUsage;
  /** Issue 31: 2-Hop caller/callee slices from the latest resolved trace. */
  slices?: Anchor[];
  /** v0.6 closeout: reverse-dependency state for the focused symbol. */
  reverseDeps?: UseReverseDepsResult;
  /** v0.6 closeout: Graph RAG subgraph state for the focused symbol. */
  subgraph?: UseSubgraphContextResult;
  /** Navigate from a reverse-deps caller chip (same stack as diagram nodes). */
  onOpenFile?: (file: string, line: number, lineEnd?: number, symbolName?: string) => void;
}

const TOKEN_BUDGET = 6000;

function formatNumber(value: number): string {
  return value.toLocaleString('en-US');
}

function languageFor(file: string): string {
  const ext = file.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'java':
      return 'java';
    case 'ts':
    case 'tsx':
      return 'typescript';
    case 'js':
    case 'jsx':
      return 'javascript';
    case 'json':
      return 'json';
    case 'yaml':
    case 'yml':
      return 'yaml';
    case 'xml':
      return 'xml';
    case 'md':
      return 'markdown';
    case 'properties':
      return 'ini';
    default:
      return 'plaintext';
  }
}

/**
 * Right inspector: read-only Monaco with a one-shot amber glow on the target
 * line, plus a back/forward navigation stack (spec FR-4).
 */
export function Inspector({
  file,
  text,
  loading,
  error,
  glow,
  symbolName,
  onBack,
  onForward,
  canGoBack,
  canGoForward,
  open,
  onClose,
  onCopyAgentContext,
  usage = { input: 0, output: 0, total: 0, source: 'estimate' },
  slices = [],
  reverseDeps,
  subgraph,
  onOpenFile
}: InspectorProps) {
  const language = useMemo(() => (file ? languageFor(file) : 'plaintext'), [file]);
  const { theme } = useTheme();
  const lineLabel =
    glow?.lineEnd && glow.lineEnd > glow.line
      ? `${glow.line} ~ ${glow.lineEnd}`
      : glow
        ? `${glow.line}`
        : '';
  const usagePercent = Math.min(100, (usage.total / TOKEN_BUDGET) * 100);
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
  const [editorReady, setEditorReady] = useState(false);
  const [editorMount, setEditorMount] = useState(0);
  const [copying, setCopying] = useState(false);

  const handleMount: OnMount = (monacoEditor) => {
    editorRef.current = monacoEditor;
    setEditorReady(true);
    setEditorMount((value) => value + 1);
  };

  const handleCopyAgentContext = async () => {
    if (!file || !onCopyAgentContext || copying) return;
    setCopying(true);
    try {
      await onCopyAgentContext();
    } finally {
      setCopying(false);
    }
  };

  // v0.6.0 — global Monaco theme responder: switching the app theme calls
  // editor.setTheme and re-lays-out after 50ms so the code pane never flashes.
  useEffect(() => {
    if (!editorReady || !editorRef.current) return;
    monaco.editor?.setTheme?.(theme === 'cyber' ? 'vs-dark' : 'vs');
    const timer = setTimeout(() => {
      if (typeof editorRef.current?.layout === 'function') {
        editorRef.current.layout();
      }
    }, 50);
    return () => clearTimeout(timer);
  }, [theme, editorReady, editorMount]);

  useEffect(() => {
    if (!editorReady || !editorRef.current) return;
    if (typeof ResizeObserver === 'undefined') return;
    let observer: ResizeObserver | null = null;
    try {
      observer = new ResizeObserver(() => {
        if (typeof editorRef.current?.layout === 'function') {
          editorRef.current.layout();
        }
      });
      observer.observe(document.documentElement);
    } catch {
      // jsdom/test environments may not support ResizeObserver.
    }
    return () => observer?.disconnect();
  }, [editorReady, editorMount]);

  // Glow on every navigation, not just first mount: the Monaco wrapper mounts
  // asynchronously (monaco loader) and swaps models on path change. Waiting a
  // single tick is racy — the new model is often not attached yet, so the
  // glow lands on the previous file and the first cross-file jump misses it.
  // Retry until ed.getModel() corresponds to the target file (bounded), then
  // apply exactly once.
  useEffect(() => {
    if (!glow || !editorReady || !editorRef.current) return;
    const ed = editorRef.current;
    const target = file;
    let finished = false;
    const apply = () => {
      if (finished) return;
      const model = ed.getModel();
      const modelPath = model?.uri?.path;
      const pathMatches =
        target !== null &&
        (modelPath === target || (target.startsWith('/') ? modelPath === target : modelPath === `/${target}`));
      if (model && pathMatches) {
        finished = true;
        clearTimeout(timer);
        revealAndGlow(ed, glow.line, glow.lineEnd);
        return;
      }
    };
    const modelListener = ed.onDidChangeModel?.(apply);
    const timer = setTimeout(() => {
      if (finished) return;
      finished = true;
      modelListener?.dispose();
      // Bounded safety net: even if the model path never matches exactly, the
      // navigation should still reveal and glow instead of staying silent.
      revealAndGlow(ed, glow.line, glow.lineEnd);
    }, 2000);
    apply();
    return () => {
      finished = true;
      modelListener?.dispose();
      clearTimeout(timer);
    };
  }, [glow, file, editorReady, editorMount]);

  return (
    <aside
      data-testid="inspector"
      className={`fixed inset-y-0 right-0 z-40 flex w-[85vw] max-w-sm flex-col border-l border-line bg-surface transition-transform md:static md:z-auto md:w-[340px] md:shrink-0 md:translate-x-0 ${
        open ? 'translate-x-0' : 'translate-x-full'
      }`}
    >
      <div className="border-b border-line">
        <div className="flex items-center justify-between gap-2 px-3 py-1.5">
          <div className="flex min-w-0 items-center gap-1">
            <button
              type="button"
              data-testid="inspector-back"
              onClick={onBack}
              disabled={!canGoBack}
              className="rounded px-1.5 py-0.5 text-sm text-muted hover:bg-subtle disabled:opacity-30"
              aria-label="Back"
            >
              ←
            </button>
            <button
              type="button"
              data-testid="inspector-forward"
              onClick={onForward}
              disabled={!canGoForward}
              className="rounded px-1.5 py-0.5 text-sm text-muted hover:bg-subtle disabled:opacity-30"
              aria-label="Forward"
            >
              →
            </button>
          </div>
          <span
            data-testid="inspector-file"
            className="min-w-0 truncate font-mono text-xs text-muted"
            title={file ?? undefined}
          >
            {file ?? 'No file open'}
          </span>
          {file && onCopyAgentContext && (
            <button
              type="button"
              data-testid="copy-agent-context"
              onClick={handleCopyAgentContext}
              disabled={copying}
              className="whitespace-nowrap rounded-md border border-line bg-surface px-2 py-0.5 text-[11px] text-muted hover:border-accent/40 hover:text-accent disabled:opacity-60"
            >
              {copying ? '复制中…' : '复制 Agent 上下文'}
            </button>
          )}
          <button
            type="button"
            data-testid="inspector-close"
            onClick={onClose}
            aria-label="Close inspector"
            className="rounded px-1.5 py-0.5 text-sm text-muted hover:bg-subtle md:hidden"
          >
            ✕
          </button>
        </div>
        {file && (
          <div className="flex items-center gap-2 border-t border-line px-3 py-1.5">
            <span
              data-testid="inspector-line"
              className="shrink-0 rounded bg-accent/10 px-1.5 py-0.5 font-mono text-[10px] font-medium text-accent"
            >
              {lineLabel || '—'}
            </span>
            <div
              data-testid="inspector-token-budget"
              className="flex min-w-0 flex-1 items-center gap-2"
            >
              <div
                role="progressbar"
                aria-label="Token 预算"
                aria-valuemin={0}
                aria-valuemax={TOKEN_BUDGET}
                aria-valuenow={usage.total}
                className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-subtle"
              >
                <div
                  className="h-full rounded-full bg-accent"
                  style={{ width: `${usagePercent}%` }}
                />
              </div>
              <span className="shrink-0 font-mono text-[10px] text-muted">
                {formatNumber(usage.total)} / {formatNumber(TOKEN_BUDGET)} Tokens
              </span>
            </div>
          </div>
        )}
      </div>

      <div className="min-h-0 flex-1">
        {loading && (
          <div className="flex h-full items-center justify-center text-sm text-muted">
            Loading file…
          </div>
        )}
        {!loading && error && (
          <div className="flex h-full items-center justify-center p-4">
            <p data-testid="inspector-error" className="text-sm text-danger">
              {error}
            </p>
          </div>
        )}
        {!loading && !error && !file && (
          <div className="flex h-full items-center justify-center p-6">
            <p className="text-center text-sm text-muted">
              Click a diagram node or source card to open the file here.
            </p>
          </div>
        )}
        {!loading && !error && file && text !== null && (
          <Editor
            height="100%"
            defaultLanguage={language}
            path={file}
            value={text}
            theme={theme === 'cyber' ? 'vs-dark' : 'vs'}
            onMount={handleMount}
            options={{
              readOnly: true,
              minimap: { enabled: false },
              scrollBeyondLastLine: false,
              fontSize: 13,
              wordWrap: 'off',
              automaticLayout: true
            }}
          />
        )}
      </div>
      {!loading && !error && file && text !== null && (
        <div
          data-testid="inspector-slices"
          className="border-t border-line bg-subtle px-3 py-2"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-muted">
              2-Hop 关联切片
            </span>
            <span className="shrink-0 font-mono text-[10px] text-accent">{lineLabel}</span>
          </div>
          {slices.length > 0 ? (
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {slices.map((slice, idx) => {
                const role =
                  idx === 0 ? '↑ Caller' : idx === slices.length - 1 ? '↓ Callee' : 'Target';
                const name = slice.file.split(/[\\/]/).pop() ?? slice.file;
                return (
                  <span
                    key={`${slice.file}-${slice.line}-${idx}`}
                    data-testid="slice-chip"
                    className={`rounded border border-line bg-surface px-1.5 py-0.5 font-mono text-[10px] ${
                      role.includes('Callee') ? 'text-callee' : 'text-accent'
                    }`}
                  >
                    {role} {name} L{slice.line}
                  </span>
                );
              })}
            </div>
          ) : (
            <p className="mt-1 max-h-8 overflow-hidden font-mono text-[10px] text-muted">
              {file} · {language}
            </p>
          )}
        </div>
      )}
      {!loading && !error && file && text !== null && symbolName && (
        <>
          <ReverseDepsPanel
            symbolName={symbolName}
            state={reverseDeps ?? EMPTY_SYMBOL_RESOURCE}
            onOpenCaller={onOpenFile}
          />
          <SubgraphPanel
            state={subgraph ?? EMPTY_SYMBOL_RESOURCE}
            onOpenFile={onOpenFile}
          />
        </>
      )}
    </aside>
  );
}

/**
 * v0.6 closeout: static "who calls this symbol" panel backed by
 * /api/repos/:id/reverse-deps. Caller chips hop the navigation stack to the
 * call site, so the panel doubles as a caller-walk.
 */
export function ReverseDepsPanel({
  symbolName,
  state,
  onOpenCaller
}: {
  symbolName: string;
  state: UseReverseDepsResult;
  onOpenCaller?: (file: string, line: number, lineEnd?: number, symbolName?: string) => void;
}) {
  return (
    <div
      data-testid="inspector-reverse-deps"
      className="border-t border-line bg-surface px-3 py-2"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-muted">
          反向依赖 · {symbolName}
        </span>
        {state.result && (
          <span
            data-testid="reverse-deps-count"
            className="shrink-0 rounded-full bg-accent/10 px-2 py-0.5 font-mono text-[10px] font-medium text-accent"
          >
            {state.result.count}
          </span>
        )}
      </div>
      {state.loading && (
        <p data-testid="reverse-deps-loading" className="mt-1 text-[11px] text-muted">
          解析调用方…
        </p>
      )}
      {!state.loading && state.error && (
        <p data-testid="reverse-deps-error" className="mt-1 text-[11px] text-muted">
          {isSymbolResolutionError(state.error)
            ? '未定位到可解析符号，反向依赖不可用。'
            : '反向依赖暂不可用，请稍后重试。'}
        </p>
      )}
      {!state.loading && !state.error && state.result && (
        <>
          {state.result.fallback && (
            <p className="mt-1 text-[10px] text-warning">
              精确符号未命中，以下为默认入口推导结果。
            </p>
          )}
          {state.result.callers.length === 0 ? (
            <p data-testid="reverse-deps-empty" className="mt-1 text-[11px] text-muted">
              没有静态调用方（entry point 或未被引用）。
            </p>
          ) : (
            <div className="mt-1.5 flex max-h-28 flex-wrap gap-1.5 overflow-y-auto">
              {state.result.callers.map((caller, idx) => (
                <button
                  key={`${caller.file}-${caller.line}-${caller.callLine ?? 'x'}-${idx}`}
                  type="button"
                  data-testid="reverse-deps-caller"
                  onClick={() =>
                    onOpenCaller?.(caller.file, caller.callLine ?? caller.line, undefined, caller.method)
                  }
                  title={`${caller.method} · ${caller.file}:${caller.callLine ?? caller.line}`}
                  className="rounded border border-line bg-surface px-1.5 py-0.5 font-mono text-[10px] text-accent hover:border-accent/50"
                >
                  {caller.method} · {caller.file.split(/[\\/]/).pop()} L
                  {caller.callLine ?? caller.line}
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

/**
 * One-shot glow decorations shared across calls: a new glow replaces the
 * previous one instead of stacking, so rapid navigations never leave
 * duplicated collections on the model.
 */
let activeGlow: editor.IEditorDecorationsCollection | null = null;

/** Reveal the line and paint a one-shot amber glow decoration. */
function revealAndGlow(
  ed: editor.IStandaloneCodeEditor,
  line: number,
  lineEnd?: number
): void {
  ed.revealLineInCenter(line);
  const model = ed.getModel();
  if (!model) return;
  const endLine = lineEnd ?? line;
  if (activeGlow) {
    activeGlow.clear();
    activeGlow = null;
  }
  const glow = ed.createDecorationsCollection([
    {
      range: {
        startLineNumber: line,
        startColumn: 1,
        endLineNumber: endLine,
        endColumn: model.getLineMaxColumn(endLine)
      },
      options: {
        isWholeLine: true,
        className: 'inspector-glow',
        linesDecorationsClassName: 'inspector-glow-gutter'
      }
    }
  ]);
  activeGlow = glow;
  setTimeout(() => {
    // Only clear if this is still the active glow; a newer navigation keeps
    // its own decoration.
    if (activeGlow === glow) {
      glow.clear();
      activeGlow = null;
    }
  }, 1500);
}
