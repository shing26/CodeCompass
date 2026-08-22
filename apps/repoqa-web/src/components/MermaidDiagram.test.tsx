import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MermaidDiagram, parseClickBindings, parseDeepLink } from './MermaidDiagram';

vi.mock('../client/mermaidRenderer', () => ({
  renderMermaid: vi.fn(async (_uid: string, code: string) => {
    if (code.includes('INVALID')) throw new Error('parse error');
    return [
      '<svg id="diagram">',
      '<text>OwnerController</text>',
      '<foreignObject><div xmlns="http://www.w3.org/1999/xhtml">OwnerRepository</div></foreignObject>',
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