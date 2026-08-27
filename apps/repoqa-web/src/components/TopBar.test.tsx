import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TopBar } from './TopBar';
import type { Repo } from '../types';

const readyRepo: Repo = {
  id: 'repo-1',
  name: 'petclinic',
  localPath: 'C:/petclinic',
  branch: 'main',
  status: 'ready',
  fileCount: 47,
  symbolCount: 344,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z'
};

const indexingRepo: Repo = {
  ...readyRepo,
  id: 'repo-2',
  name: 'big-repo',
  status: 'indexing',
  fileCount: 131,
  symbolCount: 0
};

beforeEach(() => {
  window.localStorage.clear();
  document.documentElement.dataset.theme = 'clean';
});

function baseProps(overrides: Partial<Parameters<typeof TopBar>[0]> = {}) {
  return {
    repos: [readyRepo],
    currentRepo: null,
    loading: false,
    error: null,
    onSelectRepo: vi.fn(),
    onImportLocal: vi.fn(),
    onPreviewLocal: vi.fn().mockResolvedValue({
      path: 'C:/petclinic',
      fileCount: 47,
      javaFileCount: 9,
      skippedDirCount: 2,
      skippedDirs: ['.git', 'node_modules']
    }),
    onCloneRemote: vi.fn().mockResolvedValue(readyRepo),
    onExport: vi.fn(),
    onReindex: vi.fn(),
    onDelete: vi.fn(),
    onToggleSidebar: vi.fn(),
    sidebarOpen: false,
    importingRepo: null,
    llmMode: 'none' as const,
    activeView: 'topo' as const,
    onSelectView: vi.fn(),
    onCopyAgentContext: vi.fn(),
    canCopyAgentContext: false,
    ...overrides
  };
}

describe('TopBar import dialog', () => {
  it('closes the dialog on Escape (Bug-11)', async () => {
    const user = userEvent.setup();
    render(<TopBar {...baseProps()} />);
    await user.click(screen.getByTestId('open-import'));
    expect(screen.getByTestId('import-dialog')).toBeInTheDocument();

    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() =>
      expect(screen.queryByTestId('import-dialog')).not.toBeInTheDocument()
    );
  });

  it('only reacts to Escape while the dialog is open (Bug-11)', async () => {
    const user = userEvent.setup();
    render(<TopBar {...baseProps()} />);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByTestId('import-dialog')).not.toBeInTheDocument();

    await user.click(screen.getByTestId('open-import'));
    expect(screen.getByTestId('import-dialog')).toBeInTheDocument();
  });

  it('shows live indexing feedback while POST /api/repos is pending (Bug-12)', async () => {
    const user = userEvent.setup();
    let release: (repo: Repo) => void = () => {};
    const pending = new Promise<Repo>((resolve) => {
      release = resolve;
    });
    const onImportLocal = vi.fn().mockReturnValue(pending);

    render(
      <TopBar
        {...baseProps({ onImportLocal, importingRepo: indexingRepo })}
      />
    );
    await user.click(screen.getByTestId('open-import'));
    await user.type(screen.getByTestId('import-name'), 'big-repo');
    await user.type(
      screen.getByTestId('import-path'),
      'C:/projects/big-repo'
    );
    await user.click(screen.getByTestId('import-submit'));

    await waitFor(() =>
      expect(screen.getByTestId('import-progress')).toHaveTextContent('正在解析 AST…')
    );
    expect(screen.getByTestId('import-progress')).toHaveTextContent('131');

    // Import completes → dialog closes.
    release(readyRepo);
    await waitFor(() =>
      expect(screen.queryByTestId('import-dialog')).not.toBeInTheDocument()
    );
  });

  it('shows a bootstrapping hint before the first poll finds the repo (Bug-12)', async () => {
    const user = userEvent.setup();
    let release: (repo: Repo) => void = () => {};
    const pending = new Promise<Repo>((resolve) => {
      release = resolve;
    });

    render(
      <TopBar
        {...baseProps({
          onImportLocal: vi.fn().mockReturnValue(pending),
          importingRepo: null
        })}
      />
    );
    await user.click(screen.getByTestId('open-import'));
    await user.type(screen.getByTestId('import-name'), 'big-repo');
    await user.type(
      screen.getByTestId('import-path'),
      'C:/projects/big-repo'
    );
    await user.click(screen.getByTestId('import-submit'));

    await waitFor(() =>
      expect(screen.getByTestId('import-progress')).toHaveTextContent('正在启动导入…')
    );

    release(readyRepo);
    await waitFor(() =>
      expect(screen.queryByTestId('import-dialog')).not.toBeInTheDocument()
    );
  });

  it('exposes reindex and delete actions for the selected repo', async () => {
    const user = userEvent.setup();
    const onReindex = vi.fn();
    const onDelete = vi.fn();
    render(
      <TopBar
        {...baseProps({
          currentRepo: readyRepo,
          onReindex,
          onDelete
        })}
      />
    );

    await user.click(screen.getByTestId('more-actions'));
    await user.click(screen.getByTestId('reindex-repo'));
    expect(onReindex).toHaveBeenCalledWith(readyRepo);

    await user.click(screen.getByTestId('more-actions'));
    await user.click(screen.getByTestId('delete-repo'));
    expect(onDelete).toHaveBeenCalledWith(readyRepo);
  });
});

describe('TopBar workbench header (Issue 31)', () => {
  it('shows the watcher state capsule for a ready repo', () => {
    render(<TopBar {...baseProps({ currentRepo: readyRepo })} />);
    expect(screen.getByTestId('watcher-status')).toHaveTextContent('Watcher: Ready');
    expect(screen.getByTestId('masked-badge')).toHaveTextContent('13-Rules Masked');
  });

  it('switches the active segmented tab', async () => {
    const user = userEvent.setup();
    const onSelectView = vi.fn();
    render(<TopBar {...baseProps({ currentRepo: readyRepo, onSelectView })} />);
    expect(screen.getByTestId('tab-topo')).toHaveAttribute('aria-pressed', 'true');

    await user.click(screen.getByTestId('tab-metrics'));
    expect(onSelectView).toHaveBeenCalledWith('metrics');
    await user.click(screen.getByTestId('tab-gate'));
    expect(onSelectView).toHaveBeenCalledWith('gate');
    await user.click(screen.getByTestId('tab-delta'));
    expect(onSelectView).toHaveBeenCalledWith('delta');
  });

  it('renders the staged indexing progress stepper (v0.6.0)', () => {
    render(
      <TopBar
        {...baseProps({
          currentRepo: indexingRepo,
          indexingProgress: {
            repoId: 'repo-2',
            phase: 'AST_EXTRACTION',
            phaseLabel: 'AST 提取',
            currentFile: 'src/App.java',
            processedFiles: 10,
            totalFiles: 131,
            percent: 15
          }
        })}
      />
    );
    expect(screen.getByTestId('status-stepper')).toBeInTheDocument();
    expect(screen.getByTestId('status-step-AST_EXTRACTION')).toBeInTheDocument();
    expect(screen.getByTestId('status-progress')).toHaveAttribute('aria-valuenow', '15');
    expect(screen.getByTestId('status-current-file')).toHaveTextContent('src/App.java');
  });

  it('disables the TopBar agent-context copy button until a file is open', async () => {
    const user = userEvent.setup();
    const onCopyAgentContext = vi.fn();
    render(
      <TopBar
        {...baseProps({
          currentRepo: readyRepo,
          onCopyAgentContext,
          canCopyAgentContext: false
        })}
      />
    );
    const copy = screen.getByTestId('topbar-copy-context');
    expect(copy).toBeDisabled();
    await user.click(copy);
    expect(onCopyAgentContext).not.toHaveBeenCalled();
  });
});

describe('TopBar theme toggle', () => {
  it('switches the document between clean and cyber themes', async () => {
    const user = userEvent.setup();
    render(<TopBar {...baseProps()} />);
    const button = screen.getByTestId('theme-toggle');
    expect(document.documentElement.dataset.theme).toBe('clean');
    expect(button).toHaveTextContent('Cyber');

    await user.click(button);
    expect(document.documentElement.dataset.theme).toBe('cyber');
    expect(button).toHaveTextContent('Clean');

    await user.click(button);
    expect(document.documentElement.dataset.theme).toBe('clean');
    expect(button).toHaveTextContent('Cyber');
  });
});
