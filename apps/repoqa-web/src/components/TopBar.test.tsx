import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
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

function baseProps(overrides: Partial<Parameters<typeof TopBar>[0]> = {}) {
  return {
    repos: [readyRepo],
    currentRepo: null,
    loading: false,
    error: null,
    onSelectRepo: vi.fn(),
    onImportLocal: vi.fn(),
    onCloneRemote: vi.fn().mockResolvedValue(readyRepo),
    onExport: vi.fn(),
    onToggleSidebar: vi.fn(),
    sidebarOpen: false,
    importingRepo: null,
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
});