import { useEffect, useMemo, useRef, useState } from 'react';
import Editor, { type OnMount } from '@monaco-editor/react';
import type { editor } from 'monaco-editor';
import '../client/monacoSetup';
import type { InspectorState } from '../hooks/useInspector';

export interface InspectorProps extends InspectorState {
  onBack: () => void;
  onForward: () => void;
  canGoBack: boolean;
  canGoForward: boolean;
  /** Bug-04: narrow viewports render the inspector as an off-canvas drawer. */
  open: boolean;
  /** Close the drawer (mobile); on desktop the close button is hidden. */
  onClose: () => void;
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
  onBack,
  onForward,
  canGoBack,
  canGoForward,
  open,
  onClose
}: InspectorProps) {
  const language = useMemo(() => (file ? languageFor(file) : 'plaintext'), [file]);
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
  const [editorReady, setEditorReady] = useState(false);

  const handleMount: OnMount = (monacoEditor) => {
    editorRef.current = monacoEditor;
    setEditorReady(true);
  };

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
    let attempts = 0;
    const maxAttempts = 8;
    const intervalMs = 50;
    let finished = false;
    const apply = () => {
      if (finished) return;
      const model = ed.getModel();
      if (model && target !== null && model.uri?.path === target) {
        finished = true;
        clearInterval(timer);
        revealAndGlow(ed, glow.line, glow.lineEnd);
        return;
      }
      attempts += 1;
      if (attempts >= maxAttempts) {
        // Model never matched (path normalization edge case) — still reveal on
        // whatever model is present so the navigation is never a silent miss.
        finished = true;
        clearInterval(timer);
        revealAndGlow(ed, glow.line, glow.lineEnd);
      }
    };
    const timer = setInterval(apply, intervalMs);
    apply();
    return () => {
      finished = true;
      clearInterval(timer);
    };
  }, [glow, file, editorReady]);

  return (
    <aside
      data-testid="inspector"
      className={`fixed inset-y-0 right-0 z-40 flex w-[85vw] max-w-sm flex-col border-l border-slate-200 bg-white transition-transform md:static md:z-auto md:w-1/3 md:min-w-96 md:shrink-0 md:translate-x-0 ${
        open ? 'translate-x-0' : 'translate-x-full'
      }`}
    >
      <div className="flex items-center justify-between gap-2 border-b border-slate-200 px-3 py-2">
        <div className="flex min-w-0 items-center gap-1">
          <button
            type="button"
            data-testid="inspector-back"
            onClick={onBack}
            disabled={!canGoBack}
            className="rounded px-1.5 py-0.5 text-sm text-slate-600 hover:bg-slate-100 disabled:opacity-30"
            aria-label="Back"
          >
            ←
          </button>
          <button
            type="button"
            data-testid="inspector-forward"
            onClick={onForward}
            disabled={!canGoForward}
            className="rounded px-1.5 py-0.5 text-sm text-slate-600 hover:bg-slate-100 disabled:opacity-30"
            aria-label="Forward"
          >
            →
          </button>
        </div>
        <span data-testid="inspector-file" className="min-w-0 truncate font-mono text-xs text-slate-500">
          {file ?? 'No file open'}
        </span>
        <button
          type="button"
          data-testid="inspector-close"
          onClick={onClose}
          aria-label="Close inspector"
          className="rounded px-1.5 py-0.5 text-sm text-slate-600 hover:bg-slate-100 md:hidden"
        >
          ✕
        </button>
      </div>

      <div className="min-h-0 flex-1">
        {loading && (
          <div className="flex h-full items-center justify-center text-sm text-slate-400">
            Loading file…
          </div>
        )}
        {!loading && error && (
          <div className="flex h-full items-center justify-center p-4">
            <p data-testid="inspector-error" className="text-sm text-red-600">
              {error}
            </p>
          </div>
        )}
        {!loading && !error && !file && (
          <div className="flex h-full items-center justify-center p-6">
            <p className="text-center text-sm text-slate-400">
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
            theme="vs"
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
    </aside>
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