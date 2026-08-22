import { useEffect, useRef, useState } from 'react';
import { renderMermaid } from '../client/mermaidRenderer';

export interface ParsedDeepLink {
  file: string;
  line: number;
}

/** Parse a `code://<FilePath>#<StartLine>-<EndLine>` deep link. */
export function parseDeepLink(url: string): ParsedDeepLink | null {
  const m = /^code:\/\/(.+?)#(\d+)(?:-(\d+))?$/.exec(url);
  if (!m) return null;
  return { file: m[1], line: Number(m[2]) };
}

/** Extract mermaid `click Node "code://..."` bindings into nodeName → url. */
export function parseClickBindings(code: string): Map<string, string> {
  const bindings = new Map<string, string>();
  const re = /click\s+([A-Za-z_][\w]*)\s+"(code:\/\/[^"]+)"/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(code)) !== null) {
    bindings.set(match[1], match[2]);
  }
  return bindings;
}

interface MermaidDiagramProps {
  code: string;
  onNavigate?: (file: string, line: number) => void;
}

/**
 * Renders a mermaid diagram. On failure it degrades to a plain code block so
 * the page never blanks (spec NFR-1). Click bindings follow the `code://`
 * protocol and are routed through onNavigate.
 */
export function MermaidDiagram({ code, onNavigate }: MermaidDiagramProps) {
  const [svgHtml, setSvgHtml] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const uidRef = useRef(0);

  useEffect(() => {
    let cancelled = false;
    const uid = `mmd-${++uidRef.current}`;
    setSvgHtml(null);
    setFailed(false);
    renderMermaid(uid, code)
      .then((svg) => {
        if (!cancelled) setSvgHtml(svg);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [code]);

  const bindings = useRef(parseClickBindings(code));
  bindings.current = parseClickBindings(code);

  // Click delegation: match the clicked label against click bindings. mermaid
  // 11 renders node labels as <text> (htmlLabels:false) by default in some
  // setups, but with the default htmlLabels:true it renders them as
  // <foreignObject><div>. Accept both so code:// bindings always navigate.
  useEffect(() => {
    const el = containerRef.current;
    if (!el || svgHtml === null) return;
    const onClick = (ev: MouseEvent) => {
      const target = ev.target as Element;
      const textEl =
        target.tagName === 'text' ? target : (target.closest('text') as Element | null);
      const foreignEl = textEl ? null : (target.closest('foreignObject') as Element | null);
      const labelEl = textEl ?? foreignEl;
      if (!labelEl || !labelEl.textContent) return;
      const name = labelEl.textContent.trim();
      const url = bindings.current.get(name);
      if (!url) return;
      const deepLink = parseDeepLink(url);
      if (deepLink) onNavigate?.(deepLink.file, deepLink.line);
    };
    el.addEventListener('click', onClick);
    return () => el.removeEventListener('click', onClick);
  }, [svgHtml, onNavigate]);

  return (
    <div data-testid="mermaid-diagram" className="my-2">
      {svgHtml !== null && (
        <div
          ref={containerRef}
          className="mermaid-embed overflow-x-auto"
          data-testid="mermaid-svg"
          dangerouslySetInnerHTML={{ __html: svgHtml }}
        />
      )}
      {failed && (
        <pre
          data-testid="mermaid-fallback"
          className="overflow-x-auto rounded-md bg-slate-900 p-3 text-xs text-slate-100"
        >
          {code}
        </pre>
      )}
    </div>
  );
}