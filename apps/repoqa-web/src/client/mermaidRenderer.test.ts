import { describe, expect, it, vi, beforeEach } from 'vitest';

// Mock mermaid before importing the test subject. vi.hoisted guarantees the
// fns exist before the module factory runs (vi.mock is hoisted by vitest).
const mocks = vi.hoisted(() => ({
  initialize: vi.fn(),
  render: vi.fn(async (_uid: string, _code: string) => ({ svg: '<svg />' }))
}));
vi.mock('mermaid', () => ({
  default: {
    initialize: mocks.initialize,
    render: mocks.render
  }
}));

describe('renderMermaid (v0.10 Stage 0)', () => {
  beforeEach(() => {
    mocks.initialize.mockClear();
    mocks.render.mockClear();
    // Re-import to reset module-level initializedTheme
    vi.resetModules();
  });

  it('injects clean theme variables on first call with default theme', async () => {
    const { renderMermaid: rm } = await import('./mermaidRenderer');
    await rm('mmd-1', 'flowchart LR A --> B');
    expect(mocks.initialize).toHaveBeenCalledTimes(1);
    const config = mocks.initialize.mock.calls[0][0];
    expect(config.themeVariables).toBeDefined();
    expect(config.themeVariables.primaryColor).toBe('#2563eb');
    expect(config.themeVariables.background).toBe('#f8fafc');
    expect(config.themeVariables.lineColor).toBe('#94a3b8');
    expect(config.themeVariables.fontFamily).toBe('system-ui');
  });

  it('injects cyber theme variables when theme is cyber', async () => {
    const { renderMermaid: rm } = await import('./mermaidRenderer');
    await rm('mmd-2', 'flowchart LR C --> D', 'cyber');
    expect(mocks.initialize).toHaveBeenCalledTimes(1);
    const config = mocks.initialize.mock.calls[0][0];
    expect(config.themeVariables.primaryColor).toBe('#22d3ee');
    expect(config.themeVariables.background).toBe('#0b1728');
    expect(config.themeVariables.lineColor).toBe('#64748b');
  });

  it('re-initializes to clean when called after a cyber call', async () => {
    const { renderMermaid: rm } = await import('./mermaidRenderer');
    await rm('mmd-3', 'flowchart LR E --> F', 'cyber');
    expect(mocks.initialize).toHaveBeenCalledTimes(1);
    mocks.initialize.mockClear();
    await rm('mmd-4', 'flowchart LR G --> H', 'clean');
    expect(mocks.initialize).toHaveBeenCalledTimes(1);
    expect(mocks.initialize.mock.calls[0][0].themeVariables.primaryColor).toBe('#2563eb');
  });

  it('does not re-initialize when theme stays the same', async () => {
    const { renderMermaid: rm } = await import('./mermaidRenderer');
    await rm('mmd-5', 'flowchart LR I --> J', 'cyber');
    expect(mocks.initialize).toHaveBeenCalledTimes(1);
    mocks.initialize.mockClear();
    await rm('mmd-6', 'flowchart LR K --> L', 'cyber');
    expect(mocks.initialize).not.toHaveBeenCalled();
  });

  it('calls mermaid.render with the given uid and code', async () => {
    const { renderMermaid: rm } = await import('./mermaidRenderer');
    await rm('mmd-7', 'flowchart LR M --> N', 'cyber');
    expect(mocks.render).toHaveBeenCalledWith('mmd-7', 'flowchart LR M --> N');
  });

  it('returns the svg from mermaid.render', async () => {
    const { renderMermaid: rm } = await import('./mermaidRenderer');
    const svg = await rm('mmd-8', 'flowchart LR', 'clean');
    expect(svg).toBe('<svg />');
  });
});
