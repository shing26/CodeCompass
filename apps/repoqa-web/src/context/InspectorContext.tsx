import { createContext, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { useInspector } from '../hooks/useInspector';
import { useReverseDeps } from '../hooks/useReverseDeps';
import { useSubgraphContext } from '../hooks/useSubgraphContext';
import { useRepo } from './RepoContext';

interface InspectorContextValue {
  inspector: ReturnType<typeof useInspector>;
  reverseDeps: ReturnType<typeof useReverseDeps>;
  subgraph: ReturnType<typeof useSubgraphContext>;
  inspectorOpen: boolean;
  setInspectorOpen: (v: boolean) => void;
  paletteFocus: { symbol: string; requestId: number } | null;
  handlePaletteSelect: (symbol: string, filePath: string, line: number) => void;
  maskingToastAt: number;
  handleCopyAgentContext: () => Promise<void>;
  canCopyAgentContext: boolean;
}

const InspectorContext = createContext<InspectorContextValue | null>(null);

/**
 * v0.25.0 批次 3：检查器域状态分片——文件/符号导航、2-Hop 反查与子图切片、
 * 移动抽屉、命令面板聚焦与 agent-context 拷贝脱敏提示。只依赖 RepoContext
 * （单向，不 cross-import 其他 Context）。
 */
export function InspectorProvider({ children }: { children: ReactNode }) {
  const { client, repoId } = useRepo();
  const inspector = useInspector(client, repoId);
  const reverseDeps = useReverseDeps(client, repoId, inspector.symbolName);
  const subgraph = useSubgraphContext(client, repoId, inspector.symbolName);
  // Bug-04: the Inspector drawer on narrow viewports (≤ 375px).
  const [inspectorOpen, setInspectorOpen] = useState(false);
  // v0.11 (Stage 3) — diagram focus request raised by the command palette.
  const [paletteFocus, setPaletteFocus] = useState<{
    symbol: string;
    requestId: number;
  } | null>(null);

  const handlePaletteSelect = (symbol: string, filePath: string, line: number) => {
    // Open the Inspector at the symbol's source line and center the diagram.
    inspector.openFile(filePath, line, undefined, symbol);
    setPaletteFocus((prev) => ({ symbol, requestId: (prev?.requestId ?? 0) + 1 }));
  };

  // Opening a file (diagram node / anchor / tour step) auto-reveals the
  // Inspector on mobile; on desktop the drawer classes are inert (md:static).
  // Ticket 11 (QA-02): reveal is driven by the navigation action (navSeq),
  // not the file string alone — closing the drawer via the mask and
  // re-clicking the same file must open it again.
  useEffect(() => {
    if (inspector.file) setInspectorOpen(true);
  }, [inspector.file, inspector.navSeq]);

  // Ticket 13 (QA-04): when history navigation cancels the selection, the
  // drawer must not linger over the onboarding guide showing the previous
  // repo's source slice (privacy + consistency). File/text/symbol and the nav
  // stack are already reset by useInspector's [repoId] effect; only the open
  // flag needs an explicit drop.
  useEffect(() => {
    if (!repoId) setInspectorOpen(false);
  }, [repoId]);

  // v0.7 — masking disclosure: raised after every successful agent-context
  // copy so both entry points (TopBar / Inspector) share one toast.
  const [maskingToastAt, setMaskingToastAt] = useState(0);

  const handleCopyAgentContext = async () => {
    if (!repoId || !inspector.file) return;
    const query = inspector.file.split(/[\\/]/).pop() ?? inspector.file;
    const context = await client.getSubgraphContext(repoId, query);
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(context.text);
      setMaskingToastAt(Date.now());
      return;
    }
    const textarea = document.createElement('textarea');
    textarea.value = context.text;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    textarea.remove();
    setMaskingToastAt(Date.now());
  };

  const value: InspectorContextValue = {
    inspector,
    reverseDeps,
    subgraph,
    inspectorOpen,
    setInspectorOpen,
    paletteFocus,
    handlePaletteSelect,
    maskingToastAt,
    handleCopyAgentContext,
    canCopyAgentContext: repoId !== null && inspector.file !== null
  };

  return <InspectorContext.Provider value={value}>{children}</InspectorContext.Provider>;
}

export function useInspectorContext(): InspectorContextValue {
  const ctx = useContext(InspectorContext);
  if (!ctx) throw new Error('useInspectorContext must be used inside <InspectorProvider>');
  return ctx;
}
