import { useEffect, useMemo, useRef, useState } from 'react';
import { renderMermaid } from '../client/mermaidRenderer';
import { trimMermaidGraph } from '../client/mermaidGraph';

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
  /** v0.7 — render cap; extra nodes collapse into an aggregate node. */
  maxNodes?: number;
  /** v0.7 (issue 12) — symbol name to flash once after render/trace landing. */
  highlightNode?: string;
}

const ZOOM_MIN = 0.4;
const ZOOM_MAX = 4;

interface View {
  scale: number;
  tx: number;
  ty: number;
}

const IDENTITY: View = { scale: 1, tx: 0, ty: 0 };

/**
 * Renders a mermaid diagram. On failure it degrades to a plain code block so
 * the page never blanks (spec NFR-1). Click bindings follow the `code://`
 * protocol and are routed through onNavigate.
 *
 * v0.7 — workbench layer around the static SVG: wheel/button zoom, drag pan,
 * double-click reset, node search with viewport centering, a simplified
 * MiniMap (click to jump), a node-count cap and one-shot node highlighting.
 * Implemented as CSS transforms over the mermaid SVG — deliberately dependency
 * free (svg-pan-zoom equivalent, recorded in issue 09).
 */
export function MermaidDiagram({
  code,
  onNavigate,
  maxNodes = 60,
  highlightNode
}: MermaidDiagramProps) {
  const trimmed = useMemo(() => trimMermaidGraph(code, maxNodes), [code, maxNodes]);
  const [svgHtml, setSvgHtml] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [view, setView] = useState<View>(IDENTITY);
  const [query, setQuery] = useState('');
  const [hitTotal, setHitTotal] = useState(0);
  const [hitIndex, setHitIndex] = useState(0);
  const [aggregateHit, setAggregateHit] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const minimapRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const naturalRef = useRef<{ w: number; h: number } | null>(null);
  const hitsRef = useRef<Element[]>([]);
  const dragRef = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  const uidRef = useRef(0);

  useEffect(() => {
    let cancelled = false;
    const uid = `mmd-${++uidRef.current}`;
    setSvgHtml(null);
    setFailed(false);
    setView(IDENTITY);
    naturalRef.current = null;
    renderMermaid(uid, trimmed.code)
      .then((svg) => {
        if (!cancelled) setSvgHtml(svg);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [trimmed.code]);

  const bindings = useRef(parseClickBindings(trimmed.code));
  bindings.current = parseClickBindings(trimmed.code);

  // Click delegation: match the clicked label against click bindings. mermaid
  // 11 renders node labels as <text> (htmlLabels:false) by default in some
  // setups, but with the default htmlLabels:true it renders them as
  // <foreignObject><div>. Accept both so code:// bindings always navigate.
  useEffect(() => {
    const el = containerRef.current;
    if (!el || svgHtml === null) return;
    const onClick = (ev: MouseEvent) => {
      // A pan gesture must not fire node navigation.
      if (dragRef.current?.moved) return;
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
      if (deepLink) {
        ev.preventDefault();
        const label = labelEl as Element;
        label.classList.add('mermaid-node-flash');
        window.setTimeout(() => label.classList.remove('mermaid-node-flash'), 200);
        onNavigate?.(deepLink.file, deepLink.line);
      }
    };
    el.addEventListener('click', onClick);
    return () => el.removeEventListener('click', onClick);
  }, [svgHtml, onNavigate]);

  // Wheel zoom (non-passive so preventDefault sticks); toolbar buttons cover
  // keyboard-only use.
  useEffect(() => {
    const el = viewportRef.current;
    if (!el || svgHtml === null) return;
    const onWheel = (ev: WheelEvent) => {
      ev.preventDefault();
      setView((v) => ({
        ...v,
        scale: Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, v.scale * (ev.deltaY < 0 ? 1.1 : 0.9)))
      }));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [svgHtml]);

  // Measure the natural (untransformed) diagram size once, for MiniMap math.
  useEffect(() => {
    if (svgHtml === null) return;
    const svg = containerRef.current?.querySelector('svg');
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      naturalRef.current = { w: rect.width, h: rect.height };
    }
  }, [svgHtml]);

  // MiniMap: clone the rendered SVG into a fixed-width thumbnail. Requires a
  // measurable natural size (jsdom reports 0x0 → minimap stays empty there);
  // otherwise duplicate labels would also confuse text queries.
  useEffect(() => {
    const host = minimapRef.current;
    const svg = containerRef.current?.querySelector('svg');
    if (!host || !svg || !naturalRef.current) return;
    host.replaceChildren();
    const clone = svg.cloneNode(true) as SVGElement;
    clone.style.width = '140px';
    clone.style.height = 'auto';
    host.appendChild(clone);
  }, [svgHtml]);

  const clearHits = () => {
    for (const el of hitsRef.current) {
      (el as HTMLElement).style.outline = '';
    }
    hitsRef.current = [];
  };

  const centerOn = (el: Element) => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const vpRect = viewport.getBoundingClientRect();
    const elRect = el.getBoundingClientRect();
    const dx = vpRect.left + vpRect.width / 2 - (elRect.left + elRect.width / 2);
    const dy = vpRect.top + vpRect.height / 2 - (elRect.top + elRect.height / 2);
    setView((v) => ({ ...v, tx: v.tx + dx, ty: v.ty + dy }));
  };

  // Node search: highlight every matching label inside the rendered SVG and
  // center the first hit. Falls back to an aggregate-hit hint when the only
  // matches live behind the node cap.
  useEffect(() => {
    const el = containerRef.current;
    if (!el || svgHtml === null) return;
    clearHits();
    const needle = query.trim().toLowerCase();
    if (!needle) {
      setHitTotal(0);
      setHitIndex(0);
      setAggregateHit(false);
      return;
    }
    const hits: Element[] = [];
    el.querySelectorAll('text, foreignObject').forEach((node) => {
      if ((node.textContent ?? '').toLowerCase().includes(needle)) hits.push(node);
    });
    for (const hit of hits) {
      (hit as HTMLElement).style.outline = '2px solid var(--color-accent, #f59e0b)';
    }
    hitsRef.current = hits;
    setHitTotal(hits.length);
    if (hits.length > 0) {
      setHitIndex(0);
      centerOn(hits[0]);
      setAggregateHit(false);
    } else {
      setHitIndex(-1);
      setAggregateHit(
        trimmed.hiddenLabels.some((label) => label.toLowerCase().includes(needle))
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, svgHtml, trimmed.hiddenLabels]);

  const cycleHit = (dir: 1 | -1) => {
    if (hitTotal === 0 || hitsRef.current.length === 0) return;
    const next = (hitIndex + dir + hitTotal) % hitTotal;
    setHitIndex(next);
    const el = hitsRef.current[next % hitsRef.current.length];
    if (el) centerOn(el);
  };

  // v0.7 (issue 12) — flash the highlighted node (trace start) once for 1.5s.
  useEffect(() => {
    const el = containerRef.current;
    if (!el || svgHtml === null || !highlightNode) return;
    const needle = highlightNode.toLowerCase();
    let target: Element | undefined;
    el.querySelectorAll('text, foreignObject').forEach((node) => {
      if (!target && (node.textContent ?? '').trim().toLowerCase() === needle) {
        target = node;
      }
    });
    if (!target) return;
    (target as HTMLElement).style.outline = '2px solid var(--color-accent, #f59e0b)';
    centerOn(target);
    const timer = window.setTimeout(() => {
      (target as HTMLElement).style.outline = '';
    }, 1500);
    return () => {
      window.clearTimeout(timer);
      (target as HTMLElement).style.outline = '';
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [svgHtml, highlightNode]);

  const zoomBy = (factor: number) =>
    setView((v) => ({
      ...v,
      scale: Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, v.scale * factor))
    }));

  const onPointerDown = (ev: React.PointerEvent) => {
    dragRef.current = { x: ev.clientX, y: ev.clientY, moved: false };
  };
  const onPointerMove = (ev: React.PointerEvent) => {
    const drag = dragRef.current;
    if (!drag) return;
    const dx = ev.clientX - drag.x;
    const dy = ev.clientY - drag.y;
    if (!drag.moved && Math.abs(dx) + Math.abs(dy) > 4) drag.moved = true;
    if (drag.moved) {
      drag.x = ev.clientX;
      drag.y = ev.clientY;
      setView((v) => ({ ...v, tx: v.tx + dx, ty: v.ty + dy }));
    }
  };
  const onPointerUp = () => {
    // Keep the moved flag until the click event has run; clear on next tick.
    window.setTimeout(() => {
      if (dragRef.current) dragRef.current.moved = false;
    }, 0);
  };

  // MiniMap click: center the viewport on the clicked fraction of the diagram.
  const onMinimapJump = (ev: React.MouseEvent<HTMLDivElement>) => {
    const natural = naturalRef.current;
    const viewport = viewportRef.current;
    const box = ev.currentTarget.getBoundingClientRect();
    if (!natural || !viewport || box.width === 0 || box.height === 0) return;
    const fracX = Math.max(0, Math.min(1, (ev.clientX - box.left) / box.width));
    const fracY = Math.max(0, Math.min(1, (ev.clientY - box.top) / box.height));
    const sourceX = fracX * natural.w;
    const sourceY = fracY * natural.h;
    setView((v) => ({
      ...v,
      tx: viewport.clientWidth / 2 - sourceX * v.scale,
      ty: viewport.clientHeight / 2 - sourceY * v.scale
    }));
  };

  // MiniMap viewport box: with transform-origin 0 0 the visible source region
  // starts at (-tx/scale, -ty/scale) and spans containerSize/scale.
  const minimapBox = (() => {
    const natural = naturalRef.current;
    const viewport = viewportRef.current;
    if (!natural || !viewport || view.scale <= 0) return null;
    const w = (viewport.clientWidth / view.scale / natural.w) * 100;
    const h = (viewport.clientHeight / view.scale / natural.h) * 100;
    const left = (-view.tx / view.scale / natural.w) * 100;
    const top = (-view.ty / view.scale / natural.h) * 100;
    if (!Number.isFinite(w + h + left + top)) return null;
    return {
      left: `${Math.max(0, Math.min(100, left))}%`,
      top: `${Math.max(0, Math.min(100, top))}%`,
      width: `${Math.max(0, Math.min(100, w))}%`,
      height: `${Math.max(0, Math.min(100, h))}%`
    };
  })();

  return (
    <div data-testid="mermaid-diagram" className="my-2">
      {svgHtml !== null && (
        <div
          data-testid="mermaid-toolbar"
          className="mb-1 flex items-center gap-1.5 rounded-md border border-line bg-subtle px-2 py-1 text-[11px] text-muted"
        >
          <button
            type="button"
            data-testid="mermaid-zoom-out"
            aria-label="缩小"
            onClick={() => zoomBy(1 / 1.2)}
            className="rounded border border-line bg-surface px-1.5 hover:border-accent/50"
          >
            −
          </button>
          <button
            type="button"
            data-testid="mermaid-zoom-in"
            aria-label="放大"
            onClick={() => zoomBy(1.2)}
            className="rounded border border-line bg-surface px-1.5 hover:border-accent/50"
          >
            ＋
          </button>
          <button
            type="button"
            data-testid="mermaid-zoom-reset"
            aria-label="重置视图"
            onClick={() => setView(IDENTITY)}
            className="rounded border border-line bg-surface px-1.5 hover:border-accent/50"
          >
            ⟳
          </button>
          <span className="font-mono">{Math.round(view.scale * 100)}%</span>
          <input
            data-testid="mermaid-search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === 'ArrowDown') cycleHit(1);
              else if (e.key === 'ArrowUp') cycleHit(-1);
            }}
            placeholder="搜索节点…"
            aria-label="搜索图内节点"
            className="h-6 min-w-0 flex-1 rounded border border-line bg-surface px-1.5 text-[11px] text-ink outline-none focus:border-accent"
          />
          {query.trim() !== '' && (
            <span data-testid="mermaid-hit-count" className="shrink-0 font-mono">
              {hitTotal === 0
                ? aggregateHit
                  ? '位于聚合节点内'
                  : '0/0'
                : `${hitIndex + 1}/${hitTotal}`}
            </span>
          )}
        </div>
      )}
      {trimmed.stats.hiddenNodes > 0 && (
        <p data-testid="mermaid-notice" className="mb-1 text-[10px] text-muted">
          已聚合 {trimmed.stats.hiddenNodes} 个深层节点、{trimmed.stats.collapsedEdges} 条边
          （提高 maxNodes 可展开）。
        </p>
      )}
      {svgHtml !== null && (
        <div
          ref={viewportRef}
          data-testid="mermaid-viewport"
          className="relative overflow-hidden rounded-md border border-line bg-surface"
          style={{ cursor: 'grab', touchAction: 'none' }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerLeave={onPointerUp}
          onDoubleClick={() => setView(IDENTITY)}
        >
          <div
            ref={containerRef}
            className="mermaid-embed"
            style={{
              transformOrigin: '0 0',
              transform: `translate(${view.tx}px, ${view.ty}px) scale(${view.scale})`
            }}
          >
            <div data-testid="mermaid-svg" dangerouslySetInnerHTML={{ __html: svgHtml }} />
          </div>
          <div
            data-testid="mermaid-minimap"
            title="点击跳转视口"
            className="absolute bottom-1 right-1 cursor-pointer rounded border border-line bg-surface/90 p-0.5"
            onClick={onMinimapJump}
          >
            <div ref={minimapRef} className="relative overflow-hidden" />
            {minimapBox && (
              <div
                data-testid="mermaid-viewport-box"
                className="pointer-events-none absolute border border-accent bg-accent/10"
                style={minimapBox}
              />
            )}
          </div>
        </div>
      )}
      {failed && (
        <pre
          data-testid="mermaid-fallback"
          className="overflow-x-auto rounded-md border border-line bg-code p-3 text-xs text-ink"
        >
          {code}
        </pre>
      )}
    </div>
  );
}
