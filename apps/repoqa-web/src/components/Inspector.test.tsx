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
  return {
    revealLineInCenter: vi.fn(),
    getModel: vi.fn(() => ({
      uri: { path: currentPath },
      getLineMaxColumn: vi.fn(() => 120)
    })),
    createDecorationsCollection: vi.fn(() => collection),
    lastCollection: () => collection,
    setPath: (p: string) => {
      currentPath = p;
    },
    clearAll: () => {
      currentPath = '';
      editorProbe.revealLineInCenter.mockClear();
      editorProbe.getModel.mockClear();
      editorProbe.createDecorationsCollection.mockClear();
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
});