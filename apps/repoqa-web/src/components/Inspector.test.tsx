import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { Inspector, type InspectorProps } from './Inspector';

// Fake Monaco editor surface, shared between the mocked Editor component and
// the tests so we can assert reveal/decorations calls. The model's uri.path
// mirrors the wrapper's current `path` prop (simulating the model swap that
// real @monaco-editor/react performs when the file changes).
const editorProbe = vi.hoisted(() => {
  const collection = { clear: vi.fn(), dispose: vi.fn() };
  let currentPath = '';
  let simulateDelay = false;
  const modelListeners: Array<() => void> = [];
  return {
    revealLineInCenter: vi.fn(),
    onDidChangeModel: vi.fn((fn: () => void) => {
      modelListeners.push(fn);
      return { dispose: vi.fn() };
    }),
    getModel: vi.fn(() => ({
      uri: { path: currentPath },
      getLineMaxColumn: vi.fn(() => 120)
    })),
    createDecorationsCollection: vi.fn(() => collection),
    lastCollection: () => collection,
    setPath: (p: string) => {
      if (!simulateDelay) currentPath = p;
    },
    setDelayed: (v: boolean) => {
      simulateDelay = v;
    },
    emitModelChange: () => {
      for (const listener of [...modelListeners]) listener();
    },
    clearAll: () => {
      currentPath = '';
      simulateDelay = false;
      modelListeners.length = 0;
      editorProbe.revealLineInCenter.mockClear();
      editorProbe.getModel.mockClear();
      editorProbe.createDecorationsCollection.mockClear();
      editorProbe.onDidChangeModel.mockClear();
      collection.clear.mockClear();
      collection.dispose.mockClear();
    }
  };
});

// Render a fake @monaco-editor/react Editor: surface props as data attributes
// and hand the probe editor to the real onMount so the glow effect can run.
vi.mock('@monaco-editor/react', async () => {
  const React = await import('react');
  const MockEditor = (props: {
    value?: string;
    defaultLanguage?: string;
    path?: string;
    onMount?: (ed: unknown) => void;
  }) => {
    // Simulate the model swap synchronously: the current model's uri.path
    // follows the `path` prop on every render.
    editorProbe.setPath(props.path ?? '');
    React.useEffect(() => {
      props.onMount?.(editorProbe);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    return React.createElement('div', {
      'data-testid': 'monaco-editor',
      'data-value': props.value,
      'data-language': props.defaultLanguage,
      'data-path': props.path
    });
  };
  return {
    loader: { config: vi.fn() },
    // Inspector imports Editor as the default export.
    default: MockEditor,
    Editor: MockEditor
  };
});

// The side-effect import pulls in the real monaco-worker wiring; tests never
// instantiate an editor, so stub it out.
vi.mock('../client/monacoSetup', () => ({ monaco: {} }));

function baseProps(overrides: Partial<InspectorProps> = {}): InspectorProps {
  return {
    file: null,
    text: null,
    loading: false,
    error: null,
    glow: null,
    onBack: vi.fn(),
    onForward: vi.fn(),
    canGoBack: false,
    canGoForward: false,
    // Bug-04: drawer props introduced with the responsive layout.
    open: true,
    onClose: vi.fn(),
    ...overrides
  };
}

describe('Inspector (ticket 05)', () => {
  beforeEach(() => {
    editorProbe.clearAll();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows guidance while no file is open', () => {
    render(<Inspector {...baseProps()} />);
    expect(screen.getByTestId('inspector-file')).toHaveTextContent('No file open');
    expect(screen.getByText(/Click a diagram node or source card/)).toBeInTheDocument();
    expect(screen.queryByTestId('monaco-editor')).not.toBeInTheDocument();
  });

  it('shows a loading indicator while a file is loading', () => {
    render(<Inspector {...baseProps({ loading: true, file: 'A.java' })} />);
    expect(screen.getByText(/Loading file/)).toBeInTheDocument();
    expect(screen.queryByTestId('monaco-editor')).not.toBeInTheDocument();
  });

  it('shows a friendly error instead of the editor when loading fails', () => {
    render(<Inspector {...baseProps({ error: '404 path not found', file: 'A.java' })} />);
    expect(screen.getByTestId('inspector-error')).toHaveTextContent('404 path not found');
    expect(screen.queryByTestId('monaco-editor')).not.toBeInTheDocument();
  });

  it('renders the Monaco editor with the right language and contents', () => {
    render(
      <Inspector
        {...baseProps({ file: 'src/main/java/OwnerController.java', text: 'public class OwnerController {' })}
      />
    );
    const editor = screen.getByTestId('monaco-editor');
    expect(editor).toHaveAttribute('data-language', 'java');
    expect(editor).toHaveAttribute('data-value', 'public class OwnerController {');
    expect(editor).toHaveAttribute('data-path', 'src/main/java/OwnerController.java');
  });

  it('reveals the target line and adds a glow decoration when glow is active', () => {
    vi.useFakeTimers();
    render(<Inspector {...baseProps({ file: 'A.java', text: 'content', glow: { line: 12, lineEnd: 15 } })} />);
    // The mock Editor calls onMount from its own effect; the Inspector's glow
    // effect then waits one tick for the model swap.
    act(() => {
      vi.advanceTimersByTime(0);
    });
    expect(editorProbe.revealLineInCenter).toHaveBeenCalledWith(12);
    expect(editorProbe.createDecorationsCollection).toHaveBeenCalledTimes(1);

    act(() => {
      vi.advanceTimersByTime(1500);
    });
    expect(editorProbe.lastCollection().clear).toHaveBeenCalled();
  });

  it('does not glow when the target line is inactive (no navigation yet)', () => {
    vi.useFakeTimers();
    render(<Inspector {...baseProps({ file: 'A.java', text: 'content' })} />);
    act(() => {
      vi.advanceTimersByTime(0);
    });
    expect(editorProbe.revealLineInCenter).not.toHaveBeenCalled();
    expect(editorProbe.createDecorationsCollection).not.toHaveBeenCalled();
  });

  it('re-glows when navigating to a new line (effect depends on glow, not mount)', () => {
    vi.useFakeTimers();
    const { rerender } = render(
      <Inspector {...baseProps({ file: 'A.java', text: 'content', glow: { line: 3 } })} />
    );
    act(() => {
      vi.advanceTimersByTime(0);
    });
    expect(editorProbe.revealLineInCenter).toHaveBeenCalledWith(3);

    rerender(
      <Inspector
        {...baseProps({
          file: 'B.java',
          text: 'more',
          glow: { line: 99 },
          canGoBack: true
        })}
      />
    );
    act(() => {
      vi.advanceTimersByTime(0);
    });
    expect(editorProbe.revealLineInCenter).toHaveBeenCalledWith(99);
  });

  it('Bug-R2-03: delayed Monaco model swap still glows once the model changes', () => {
    vi.useFakeTimers();
    editorProbe.setDelayed(true);
    render(
      <Inspector
        {...baseProps({ file: 'B.java', text: 'more', glow: { line: 99 } })}
      />
    );
    act(() => {
      vi.advanceTimersByTime(0);
    });
    expect(editorProbe.revealLineInCenter).not.toHaveBeenCalled();

    editorProbe.setDelayed(false);
    editorProbe.setPath('B.java');
    act(() => {
      editorProbe.emitModelChange();
    });
    expect(editorProbe.revealLineInCenter).toHaveBeenCalledWith(99);
    expect(editorProbe.createDecorationsCollection).toHaveBeenCalledTimes(1);
  });

  it('Bug-R2-03: matches Monaco model paths that carry a leading slash', () => {
    vi.useFakeTimers();
    editorProbe.setDelayed(true);
    render(
      <Inspector
        {...baseProps({ file: 'B.java', text: 'more', glow: { line: 99 } })}
      />
    );
    act(() => {
      vi.advanceTimersByTime(0);
    });
    expect(editorProbe.revealLineInCenter).not.toHaveBeenCalled();

    editorProbe.setDelayed(false);
    editorProbe.setPath('/B.java');
    act(() => {
      editorProbe.emitModelChange();
    });
    expect(editorProbe.revealLineInCenter).toHaveBeenCalledWith(99);
    expect(editorProbe.createDecorationsCollection).toHaveBeenCalledTimes(1);
  });

  it('Bug-R2-03: bounded timer still glows when the model path never matches', () => {
    vi.useFakeTimers();
    editorProbe.setDelayed(true);
    render(
      <Inspector
        {...baseProps({ file: 'B.java', text: 'more', glow: { line: 99 } })}
      />
    );
    act(() => {
      vi.advanceTimersByTime(0);
    });
    expect(editorProbe.revealLineInCenter).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(editorProbe.revealLineInCenter).toHaveBeenCalledWith(99);
    expect(editorProbe.createDecorationsCollection).toHaveBeenCalledTimes(1);
  });

  it('routes back/forward clicks and disables buttons by stack position', () => {
    const onBack = vi.fn();
    const onForward = vi.fn();
    render(
      <Inspector
        {...baseProps({ file: 'A.java', text: 'content', canGoBack: true, canGoForward: false, onBack, onForward })}
      />
    );
    const back = screen.getByTestId('inspector-back');
    const forward = screen.getByTestId('inspector-forward');
    expect(back).not.toBeDisabled();
    expect(forward).toBeDisabled();

    fireEvent.click(back);
    expect(onBack).toHaveBeenCalledTimes(1);
    fireEvent.click(forward);
    expect(onForward).not.toHaveBeenCalled();
  });

  it('Issue 28: copies the agent context through the callback when a file is open', async () => {
    const onCopyAgentContext = vi.fn().mockResolvedValue(undefined);
    render(
      <Inspector
        {...baseProps({
          file: 'src/main/java/OrderController.java',
          text: 'content',
          onCopyAgentContext
        })}
      />
    );
    const button = screen.getByTestId('copy-agent-context');
    await act(async () => {
      fireEvent.click(button);
    });
    expect(onCopyAgentContext).toHaveBeenCalledTimes(1);
  });

  it('Issue 28: hides the copy button until a file is open', () => {
    render(<Inspector {...baseProps()} />);
    expect(screen.queryByTestId('copy-agent-context')).not.toBeInTheDocument();
  });

  it('Issue 31: shows the token budget progress and line range in the header', () => {
    render(
      <Inspector
        {...baseProps({
          file: 'src/main/java/OwnerController.java',
          text: 'public class OwnerController {',
          glow: { line: 88, lineEnd: 112 },
          usage: { input: 1600, output: 1820, total: 3420, source: 'provider' }
        })}
      />
    );
    expect(screen.getByTestId('inspector-line')).toHaveTextContent('88 ~ 112');
    expect(screen.getByTestId('inspector-token-budget')).toHaveTextContent('3,420 / 6,000 Tokens');
  });
});

describe('Inspector reverse-deps panel (v0.6 closeout)', () => {
  beforeEach(() => {
    editorProbe.clearAll();
  });

  const openFileProps = (overrides: Partial<InspectorProps> = {}): InspectorProps =>
    baseProps({
      file: 'src/main/java/OwnerController.java',
      text: 'content',
      symbolName: 'addOwner',
      ...overrides
    });

  it('hides the panel when the navigation carries no symbol name', () => {
    render(<Inspector {...baseProps({ file: 'A.java', text: 'content' })} />);
    expect(screen.queryByTestId('inspector-reverse-deps')).not.toBeInTheDocument();
  });

  it('shows a loading hint while callers resolve', () => {
    render(
      <Inspector
        {...openFileProps({
          reverseDeps: { result: null, loading: true, error: null }
        })}
      />
    );
    expect(screen.getByTestId('reverse-deps-loading')).toBeInTheDocument();
  });

  it('renders caller chips with the call-site line and a count badge', () => {
    render(
      <Inspector
        {...openFileProps({
          reverseDeps: {
            result: {
              repoId: 'r1',
              target: { name: 'addOwner', file: 'src/OwnerController.java', line: 30 },
              callers: [
                {
                  file: 'src/main/java/OwnerUi.java',
                  method: 'openAddForm',
                  line: 12,
                  callLine: 44
                }
              ],
              count: 1,
              fallback: false
            },
            loading: false,
            error: null
          }
        })}
      />
    );
    expect(screen.getByTestId('reverse-deps-count')).toHaveTextContent('1');
    const chip = screen.getByTestId('reverse-deps-caller');
    expect(chip).toHaveTextContent('openAddForm');
    expect(chip).toHaveTextContent('OwnerUi.java L44');
  });

  it('shows an explicit empty state when the symbol has no static callers', () => {
    render(
      <Inspector
        {...openFileProps({
          reverseDeps: {
            result: {
              repoId: 'r1',
              target: { name: 'main', file: 'src/App.java', line: 1 },
              callers: [],
              count: 0,
              fallback: false
            },
            loading: false,
            error: null
          }
        })}
      />
    );
    expect(screen.getByTestId('reverse-deps-empty')).toBeInTheDocument();
  });

  it('falls back to a muted hint when the symbol cannot be resolved', () => {
    render(
      <Inspector
        {...openFileProps({
          reverseDeps: {
            result: null,
            loading: false,
            error: 'listReverseDeps failed: 400 : Start symbol not found: nope'
          }
        })}
      />
    );
    expect(screen.getByTestId('reverse-deps-error')).toBeInTheDocument();
    expect(screen.queryByTestId('reverse-deps-count')).not.toBeInTheDocument();
  });

  it('navigates to the call site (callLine) with the caller method as symbol', () => {
    const onOpenFile = vi.fn();
    render(
      <Inspector
        {...openFileProps({
          reverseDeps: {
            result: {
              repoId: 'r1',
              target: { name: 'addOwner', file: 'src/OwnerController.java', line: 30 },
              callers: [
                { file: 'src/main/java/OwnerUi.java', method: 'openAddForm', line: 12, callLine: 44 }
              ],
              count: 1,
              fallback: false
            },
            loading: false,
            error: null
          },
          onOpenFile
        })}
      />
    );
    fireEvent.click(screen.getByTestId('reverse-deps-caller'));
    expect(onOpenFile).toHaveBeenCalledWith(
      'src/main/java/OwnerUi.java',
      44,
      undefined,
      'openAddForm'
    );
  });
});
