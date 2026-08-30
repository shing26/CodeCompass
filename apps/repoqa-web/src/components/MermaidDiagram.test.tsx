import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MermaidDiagram, parseClickBindings, parseDeepLink } from './MermaidDiagram';
import type { TraceStep } from '../types';

vi.mock('../client/mermaidRenderer', () => ({
  renderMermaid: vi.fn(async (_uid: string, code: string) => {
    if (code.includes('INVALID')) throw new Error('parse error');
    return [
      '<svg id="diagram">',
      '<g class="node"><text class="label">OwnerController</text></g>',
      '<g class="node"><foreignObject><div class="label" xmlns="http://www.w3.org/1999/xhtml">OwnerRepository</div></foreignObject></g>',
      '</svg>'
    ].join('');
  })
}));

import { renderMermaid } from '../client/mermaidRenderer';
const mockedRender = vi.mocked(renderMermaid);

describe('parse helpers', () => {
  it('parses code:// deep links', () => {
    expect(parseDeepLink('code://src/A.java#12-20')).toEqual({ file: 'src/A.java', line: 12 });
    expect(parseDeepLink('code://src/A.java#12')).toEqual({ file: 'src/A.java', line: 12 });
    expect(parseDeepLink('https://example.com')).toBeNull();
  });

  it('extracts click bindings from mermaid code', () => {
    const code = [
      'flowchart LR',
      '  OwnerController --> OwnerRepository',
      '  click OwnerController "code://src/OwnerController.java#42-60"'
    ].join('\n');
    const bindings = parseClickBindings(code);
    expect(bindings.get('OwnerController')).toBe('code://src/OwnerController.java#42-60');
    expect(bindings.has('OwnerRepository')).toBe(false);
  });
});

describe('MermaidDiagram', () => {
  beforeEach(() => {
    mockedRender.mockClear();
  });

  it('renders the svg returned by the renderer', async () => {
    render(<MermaidDiagram code="flowchart LR\n  A --> B" />);
    await waitFor(() => expect(screen.getByTestId('mermaid-svg')).toBeInTheDocument());
    expect(mockedRender).toHaveBeenCalledTimes(1);
  });

  it('degrades to a code block when rendering fails', async () => {
    render(<MermaidDiagram code="flowchart INVALID" />);
    await waitFor(() => expect(screen.getByTestId('mermaid-fallback')).toBeInTheDocument());
    expect(screen.getByTestId('mermaid-fallback')).toHaveTextContent('flowchart INVALID');
    expect(screen.queryByTestId('mermaid-svg')).not.toBeInTheDocument();
  });

  it('routes a clicked bound node through onNavigate', async () => {
    const onNavigate = vi.fn();
    const code = [
      'flowchart LR',
      '  OwnerController --> OwnerRepository',
      '  click OwnerController "code://src/OwnerController.java#42-60"'
    ].join('\n');
    const user = userEvent.setup();
    render(<MermaidDiagram code={code} onNavigate={onNavigate} />);
    await waitFor(() => expect(screen.getByTestId('mermaid-svg')).toBeInTheDocument());

    // The mocked SVG contains a <text>OwnerController</text> which is clickable.
    await user.click(screen.getByText('OwnerController'));
    expect(onNavigate).toHaveBeenCalledWith('src/OwnerController.java', 42);
  });

  it('Bug-R2-08: prevents the browser default code:// navigation', async () => {
    const preventDefault = vi.spyOn(MouseEvent.prototype, 'preventDefault');
    const onNavigate = vi.fn();
    const code = [
      'flowchart LR',
      '  OwnerController --> OwnerRepository',
      '  click OwnerController "code://src/OwnerController.java#42-60"'
    ].join('\n');
    const user = userEvent.setup();
    render(<MermaidDiagram code={code} onNavigate={onNavigate} />);
    await waitFor(() => expect(screen.getByTestId('mermaid-svg')).toBeInTheDocument());
    try {
      await user.click(screen.getByText('OwnerController'));
      expect(preventDefault).toHaveBeenCalled();
    } finally {
      preventDefault.mockRestore();
    }
  });

  it('does not navigate for a node without a binding', async () => {
    const onNavigate = vi.fn();
    const user = userEvent.setup();
    render(
      <MermaidDiagram code="flowchart LR\n  OwnerController --> OwnerRepository" onNavigate={onNavigate} />
    );
    await waitFor(() => expect(screen.getByTestId('mermaid-svg')).toBeInTheDocument());
    await user.click(screen.getByText('OwnerRepository'));
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it('routes a click on a foreignObject/div label through onNavigate', async () => {
    const onNavigate = vi.fn();
    const code = [
      'flowchart LR',
      '  OwnerController --> OwnerRepository',
      '  click OwnerRepository "code://src/OwnerRepository.java#7-9"'
    ].join('\n');
    const user = userEvent.setup();
    render(<MermaidDiagram code={code} onNavigate={onNavigate} />);
    await waitFor(() => expect(screen.getByTestId('mermaid-svg')).toBeInTheDocument());

    // mermaid renders node labels as <foreignObject><div> by default; the
    // click delegation must resolve bindings for those labels too.
    await user.click(screen.getByText('OwnerRepository'));
    expect(onNavigate).toHaveBeenCalledWith('src/OwnerRepository.java', 7);
  });
});


describe('MermaidDiagram workbench layer (v0.7 issues 09-11)', () => {
  beforeEach(() => {
    mockedRender.mockClear();
  });

  it('renders the toolbar with zoom controls and a node search box', async () => {
    render(<MermaidDiagram code="flowchart LR" />);
    await waitFor(() => expect(screen.getByTestId('mermaid-svg')).toBeInTheDocument());
    expect(screen.getByTestId('mermaid-toolbar')).toBeInTheDocument();
    expect(screen.getByTestId('mermaid-zoom-in')).toBeInTheDocument();
    expect(screen.getByTestId('mermaid-zoom-out')).toBeInTheDocument();
    expect(screen.getByTestId('mermaid-zoom-reset')).toBeInTheDocument();
    expect(screen.getByTestId('mermaid-search')).toBeInTheDocument();
    expect(screen.getByTestId('mermaid-minimap')).toBeInTheDocument();
  });

  it('highlights matching nodes and shows the hit counter while searching', async () => {
    const user = userEvent.setup();
    render(<MermaidDiagram code="flowchart LR" />);
    await waitFor(() => expect(screen.getByTestId('mermaid-svg')).toBeInTheDocument());

    await user.type(screen.getByTestId('mermaid-search'), 'owner');
    expect(screen.getByTestId('mermaid-hit-count')).toHaveTextContent('1/2');

    await user.clear(screen.getByTestId('mermaid-search'));
    await user.type(screen.getByTestId('mermaid-search'), 'nothing-matches');
    expect(screen.getByTestId('mermaid-hit-count')).toHaveTextContent('0/0');
  });

  it('caps oversized graphs with an aggregate notice', async () => {
    const lines = ['flowchart LR'];
    for (let i = 1; i <= 70; i += 1) {
      lines.push('  n' + i + '[node ' + i + '] --> n' + (i + 1) + '[node ' + (i + 1) + ']');
    }
    render(<MermaidDiagram code={lines.join('\n')} />);
    await waitFor(() => expect(screen.getByTestId('mermaid-notice')).toBeInTheDocument());
    expect(screen.getByTestId('mermaid-notice')).toHaveTextContent(/70 .* 10 |已聚合/);
    expect(vi.mocked(renderMermaid)).toHaveBeenCalled();
    const passedCode = vi.mocked(renderMermaid).mock.calls[0][1] as string;
    expect(passedCode).toContain('ccx_aggregate');
    expect(passedCode).not.toContain('n70[');
  });
});

describe('MermaidDiagram trace injection (v0.10 Stage 1)', () => {
  beforeEach(() => {
    mockedRender.mockClear();
    // Override the mock SVG to include g.edgePath and g.node .label elements
    // that the trace injection effect queries.
    mockedRender.mockResolvedValue(
      [
        '<svg viewBox="0 0 400 200">',
        '<g class="edgePath"><path d="M10,10 L100,10" /></g>',
        '<g class="edgePath"><path d="M10,20 L100,20" /></g>',
        '<g class="node"><text class="label">OwnerController</text></g>',
        '<g class="node"><text class="label">OwnerRepository</text></g>',
        '</svg>'
      ].join('')
    );
  });

  it('injects broken edge class when the target hop is BROKEN', async () => {
    const traceSteps: TraceStep[] = [
      { file: 'A.java', line: 1, symbol: 'OwnerController', status: 'VERIFIED' },
      { file: 'B.java', line: 2, symbol: 'OwnerRepository', status: 'BROKEN' }
    ];
    render(<MermaidDiagram code="flowchart LR" traceSteps={traceSteps} />);
    await waitFor(() => expect(screen.getByTestId('mermaid-svg')).toBeInTheDocument());
    const container = screen.getByTestId('mermaid-diagram').querySelector('.mermaid-embed')!;
    const edges = container.querySelectorAll('g.edgePath');
    // First edge connects hop 0→1, whose target hop is BROKEN.
    expect(edges[0].classList.contains('ccx-edge-broken')).toBe(true);
    const node = container.querySelectorAll('g.node .label')[1]!.closest('g.node')!;
    expect(node.classList.contains('ccx-node-broken')).toBe(true);
  });

  it('injects HTTP edge and POST node classes from trace evidence', async () => {
    const traceSteps: TraceStep[] = [
      { file: 'A.java', line: 1, symbol: 'OwnerController', status: 'VERIFIED' },
      {
        file: 'B.java',
        line: 2,
        symbol: 'OwnerRepository',
        status: 'VERIFIED',
        httpMethod: 'POST'
      }
    ];
    render(<MermaidDiagram code="flowchart LR" traceSteps={traceSteps} />);
    await waitFor(() => expect(screen.getByTestId('mermaid-svg')).toBeInTheDocument());
    const container = screen.getByTestId('mermaid-diagram').querySelector('.mermaid-embed')!;
    const edges = container.querySelectorAll('g.edgePath');
    expect(edges[0].classList.contains('ccx-edge-http')).toBe(true);
    const node = container.querySelectorAll('g.node .label')[1]!.closest('g.node')!;
    expect(node.classList.contains('ccx-node-post')).toBe(true);
  });

  it('injects nothing for a single-hop trace', async () => {
    const traceSteps: TraceStep[] = [
      { file: 'A.java', line: 1, symbol: 'OwnerController', status: 'VERIFIED' }
    ];
    render(<MermaidDiagram code="flowchart LR" traceSteps={traceSteps} />);
    await waitFor(() => expect(screen.getByTestId('mermaid-svg')).toBeInTheDocument());
    const container = screen.getByTestId('mermaid-diagram').querySelector('.mermaid-embed')!;
    const edges = container.querySelectorAll('g.edgePath');
    expect(edges[0].classList.contains('ccx-edge-broken')).toBe(false);
    expect(edges[0].classList.contains('ccx-edge-http')).toBe(false);
  });

  it('keeps the canvas clean when traceSteps is undefined', async () => {
    render(<MermaidDiagram code="flowchart LR" />);
    await waitFor(() => expect(screen.getByTestId('mermaid-svg')).toBeInTheDocument());
    const container = screen.getByTestId('mermaid-diagram').querySelector('.mermaid-embed')!;
    const edges = container.querySelectorAll('g.edgePath');
    expect(edges[0].classList.contains('ccx-edge-broken')).toBe(false);
    expect(edges[0].classList.contains('ccx-edge-http')).toBe(false);
  });
});

describe('MermaidDiagram brand badges (v0.11 Stage 2)', () => {
  beforeEach(() => {
    mockedRender.mockClear();
  });

  it('injects a brand badge from the symbol catalog', async () => {
    const symbols = [
      {
        id: 1,
        repoId: 'repo-1',
        kind: 'service' as const,
        name: 'OwnerRepository',
        filePath: 'src/main/java/OwnerRepository.java',
        lineStart: 7,
        lineEnd: 12,
        signature: null,
        calls: null,
        annotations: ['@Service']
      }
    ];
    const code = [
      'flowchart LR',
      '  OwnerController --> OwnerRepository',
      '  click OwnerRepository "code://src/main/java/OwnerRepository.java#7"'
    ].join('\n');
    render(<MermaidDiagram code={code} symbols={symbols} />);
    await waitFor(() => expect(screen.getByTestId('mermaid-svg')).toBeInTheDocument());
    const container = screen.getByTestId('mermaid-diagram').querySelector('.mermaid-embed')!;
    await waitFor(() => {
      expect(container.querySelector('.ccx-brand-badge')).not.toBeNull();
    });
    const badge = container.querySelector('.ccx-brand-badge');
    expect(badge?.getAttribute('data-brand')).toBe('spring');
    expect(badge?.innerHTML).toContain('<svg');
  });

  it('falls back to file-extension hints from click bindings', async () => {
    const code = [
      'flowchart LR',
      '  OwnerController --> OwnerRepository',
      '  click OwnerRepository "code://src/main/java/OwnerRepository.java#7"'
    ].join('\n');
    // No symbols prop: brand inferred from the code:// file extension (.java → spring).
    render(<MermaidDiagram code={code} />);
    await waitFor(() => expect(screen.getByTestId('mermaid-svg')).toBeInTheDocument());
    const container = screen.getByTestId('mermaid-diagram').querySelector('.mermaid-embed')!;
    await waitFor(() => {
      expect(container.querySelector('.ccx-brand-badge')).not.toBeNull();
    });
    expect(container.querySelector('.ccx-brand-badge')?.getAttribute('data-brand')).toBe('spring');
  });

  it('skips badges when ?badges=0 is present', async () => {
    const originalSearch = window.location.search;
    try {
      window.history.replaceState(null, '', '/?badges=0');
      const symbols = [
        {
          id: 1,
          repoId: 'repo-1',
          kind: 'service' as const,
          name: 'OwnerRepository',
          filePath: 'src/main/java/OwnerRepository.java',
          lineStart: 7,
          lineEnd: 12,
          signature: null,
          calls: null,
          annotations: ['@Service']
        }
      ];
      render(
        <MermaidDiagram
          code="flowchart LR\n  OwnerController --> OwnerRepository"
          symbols={symbols}
        />
      );
      await waitFor(() => expect(screen.getByTestId('mermaid-svg')).toBeInTheDocument());
      const container = screen.getByTestId('mermaid-diagram').querySelector('.mermaid-embed')!;
      expect(container.querySelector('.ccx-brand-badge')).toBeNull();
    } finally {
      window.history.replaceState(null, '', originalSearch || '/');
    }
  });
});

describe('MermaidDiagram focusRequest (v0.11 Stage 3)', () => {
  beforeEach(() => {
    mockedRender.mockClear();
  });

  it('centers and flashes the matching node label', async () => {
    render(
      <MermaidDiagram
        code="flowchart LR\n  OwnerController --> OwnerRepository"
        focusRequest={{ symbol: 'OwnerController', requestId: 1 }}
      />
    );
    await waitFor(() => expect(screen.getByTestId('mermaid-svg')).toBeInTheDocument());
    await waitFor(() => {
      const label = screen.getByText('OwnerController');
      expect(label.style.outline).toContain('2px solid');
    });
  });

  it('ignores an empty focus symbol', async () => {
    render(
      <MermaidDiagram
        code="flowchart LR\n  OwnerController --> OwnerRepository"
        focusRequest={{ symbol: '', requestId: 1 }}
      />
    );
    await waitFor(() => expect(screen.getByTestId('mermaid-svg')).toBeInTheDocument());
    const label = screen.getByText('OwnerController');
    expect(label.style.outline).toBe('');
  });
});
