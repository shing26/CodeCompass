import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ImportRepoModal } from './ImportRepoModal';
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
  id: 'repo-clone-1',
  name: 'demo',
  repoUrl: 'git://127.0.0.1:19418/demo.git',
  localPath: 'C:/data/clones/demo-123',
  status: 'indexing',
  fileCount: 0,
  symbolCount: 0
};

const clonedIndexingRepo: Repo = {
  ...indexingRepo,
  fileCount: 12
};

function baseProps(overrides: Partial<Parameters<typeof ImportRepoModal>[0]> = {}) {
  return {
    open: true,
    onClose: vi.fn(),
    onImportLocal: vi.fn().mockResolvedValue(undefined),
    onPreviewLocal: vi.fn().mockResolvedValue({
      path: 'C:/projects/spring-petclinic',
      fileCount: 47,
      javaFileCount: 9,
      xmlFileCount: 2,
      skippedDirCount: 2,
      skippedDirs: ['.git', 'node_modules']
    }),
    onCloneRemote: vi.fn().mockResolvedValue(indexingRepo),
    repos: [] as Repo[],
    importingRepo: null,
    ...overrides
  };
}

function makeFile(name: string, path: string): File {
  const file = new File(['content'], name, { type: 'text/plain' });
  Object.defineProperty(file, 'webkitRelativePath', { value: path });
  return file;
}

describe('ImportRepoModal — repository ingestion hub (Issue 19)', () => {
  it('switches between the local and GitHub tabs', async () => {
    const user = userEvent.setup();
    render(<ImportRepoModal {...baseProps()} />);

    expect(screen.getByTestId('import-name')).toBeInTheDocument();
    expect(screen.queryByTestId('import-url')).not.toBeInTheDocument();

    await user.click(screen.getByTestId('import-tab-remote'));
    expect(screen.getByTestId('import-url')).toBeInTheDocument();
    expect(screen.queryByTestId('import-name')).not.toBeInTheDocument();

    await user.click(screen.getByTestId('import-tab-local'));
    expect(screen.getByTestId('import-name')).toBeInTheDocument();
  });

  it('submits a local import with name + path and closes on success', async () => {
    const user = userEvent.setup();
    const onImportLocal = vi.fn().mockResolvedValue(undefined);
    const onClose = vi.fn();
    render(<ImportRepoModal {...baseProps({ onImportLocal, onClose })} />);

    await user.type(screen.getByTestId('import-name'), 'petclinic');
    await user.type(screen.getByTestId('import-path'), 'C:/projects/spring-petclinic');
    await user.click(screen.getByTestId('import-submit'));

    await waitFor(() =>
      expect(onImportLocal).toHaveBeenCalledWith(
        'petclinic',
        'C:/projects/spring-petclinic'
      )
    );
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('shows bootstrapping then live indexing feedback while local import is pending (Bug-12)', async () => {
    const user = userEvent.setup();
    let release: (value: unknown) => void = () => {};
    const pending = new Promise((resolve) => {
      release = resolve;
    });
    const onImportLocal = vi.fn().mockReturnValue(pending);
    const onClose = vi.fn();
    const { rerender } = render(
      <ImportRepoModal
        {...baseProps({ onImportLocal, onClose, importingRepo: null })}
      />
    );

    await user.type(screen.getByTestId('import-name'), 'big-repo');
    await user.type(screen.getByTestId('import-path'), 'C:/projects/big-repo');
    await user.click(screen.getByTestId('import-submit'));

    await waitFor(() =>
      expect(screen.getByTestId('import-progress')).toHaveTextContent('正在启动导入…')
    );

    rerender(
      <ImportRepoModal
        {...baseProps({ onImportLocal, onClose, importingRepo: clonedIndexingRepo })}
      />
    );
    await waitFor(() =>
      expect(screen.getByTestId('import-progress')).toHaveTextContent('正在解析 AST…')
    );
    expect(screen.getByTestId('import-progress')).toHaveTextContent('12');

    release(undefined);
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('shows live parsed/total AST progress when the backend reports counts', async () => {
    const user = userEvent.setup();
    let release: (value: unknown) => void = () => {};
    const pending = new Promise((resolve) => {
      release = resolve;
    });
    const onImportLocal = vi.fn().mockReturnValue(pending);
    const onClose = vi.fn();
    const { rerender } = render(
      <ImportRepoModal
        {...baseProps({ onImportLocal, onClose, importingRepo: null })}
      />
    );

    await user.type(screen.getByTestId('import-name'), 'big-repo');
    await user.type(screen.getByTestId('import-path'), 'C:/projects/big-repo');
    await user.click(screen.getByTestId('import-submit'));

    rerender(
      <ImportRepoModal
        {...baseProps({
          onImportLocal,
          onClose,
          importingRepo: {
            ...indexingRepo,
            fileCount: 0,
            indexParsed: 45,
            indexTotal: 120
          }
        })}
      />
    );
    await waitFor(() =>
      expect(screen.getByTestId('import-progress')).toHaveTextContent(
        '正在解析 AST…（45/120）'
      )
    );

    release(undefined);
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('pre-fills the name from the picked folder and asks for its path', async () => {
    render(<ImportRepoModal {...baseProps()} />);
    fireEvent.change(screen.getByTestId('import-folder'), {
      target: { files: [makeFile('App.java', 'demo/src/main/App.java')] }
    });

    expect(screen.getByTestId('import-name')).toHaveValue('demo');
    expect(screen.getByTestId('import-folder-hint')).toHaveTextContent(
      '已选择文件夹「demo」'
    );
    expect(screen.getByTestId('import-folder-hint')).toHaveTextContent('完整路径');
  });

  it('shows a pre-import preview with file and skipped-dir counts (Round 2 B4)', async () => {
    const user = userEvent.setup();
    const onPreviewLocal = vi.fn().mockResolvedValue({
      path: 'C:/projects/spring-petclinic',
      fileCount: 47,
      javaFileCount: 9,
      xmlFileCount: 3,
      skippedDirCount: 2,
      skippedDirs: ['.git', 'node_modules']
    });
    render(<ImportRepoModal {...baseProps({ onPreviewLocal })} />);

    await user.type(
      screen.getByTestId('import-path'),
      'C:/projects/spring-petclinic'
    );
    await waitFor(() => expect(onPreviewLocal).toHaveBeenCalled());
    await waitFor(() =>
      expect(screen.getByTestId('import-preview')).toHaveTextContent('将索引 47 个文件')
    );
    expect(screen.getByTestId('import-preview')).toHaveTextContent(
      '含 9 个 Java 文件、3 个 XML 资源'
    );
    expect(screen.getByTestId('import-preview')).toHaveTextContent('跳过 2 个目录');
    expect(screen.getByTestId('import-preview')).toHaveTextContent('.git');
    expect(screen.getByTestId('import-preview')).toHaveTextContent('node_modules');
  });

  it('surfaces a preview failure without blocking the local import flow', async () => {
    const user = userEvent.setup();
    const onPreviewLocal = vi
      .fn()
      .mockRejectedValue(new Error('local path is not a directory'));
    render(<ImportRepoModal {...baseProps({ onPreviewLocal })} />);

    await user.type(screen.getByTestId('import-name'), 'demo');
    await user.type(screen.getByTestId('import-path'), 'C:/nope');
    await waitFor(() =>
      expect(screen.getByTestId('import-preview-error')).toHaveTextContent(
        'local path is not a directory'
      )
    );
    expect(screen.getByTestId('import-submit')).toBeEnabled();
  });

  it('clones a remote repo with url + branch (cloning → indexing → auto-close)', async () => {
    const user = userEvent.setup();
    let releaseClone: (repo: Repo) => void = () => {};
    const onCloneRemote = vi.fn().mockReturnValue(
      new Promise<Repo>((resolve) => {
        releaseClone = resolve;
      })
    );
    const onClose = vi.fn();
    const { rerender } = render(<ImportRepoModal {...baseProps({ onCloneRemote, onClose })} />);

    await user.click(screen.getByTestId('import-tab-remote'));
    await user.type(
      screen.getByTestId('import-url'),
      'https://github.com/org/demo.git'
    );
    await user.type(screen.getByTestId('import-branch'), 'main');
    await user.click(screen.getByTestId('import-clone-submit'));

    // Phase 1: cloning.
    await waitFor(() =>
      expect(screen.getByTestId('import-clone-progress')).toHaveTextContent(
        '正在克隆仓库…'
      )
    );
    expect(onCloneRemote).toHaveBeenCalledWith(
      'https://github.com/org/demo.git',
      'main'
    );

    // Clone lands → repo flips to indexing (async server-side index).
    releaseClone(indexingRepo);
    await waitFor(() =>
      expect(screen.getByTestId('import-clone-progress')).toHaveTextContent(
        '正在索引并分析…'
      )
    );
    expect(onClose).not.toHaveBeenCalled();

    // Catalog polling reports indexed file counts while still indexing.
    rerender(<ImportRepoModal {...baseProps({ onCloneRemote, onClose, repos: [clonedIndexingRepo] })} />);
    await waitFor(() =>
      expect(screen.getByTestId('import-clone-progress')).toHaveTextContent(
        '（12 个文件）'
      )
    );

    // Repo becomes ready → dialog auto-closes.
    rerender(
      <ImportRepoModal
        {...baseProps({ onCloneRemote, onClose, repos: [{ ...readyRepo, id: indexingRepo.id }] })}
      />
    );
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('calls onCloneRemote without a branch when the field is empty', async () => {
    const user = userEvent.setup();
    const onCloneRemote = vi.fn().mockResolvedValue(indexingRepo);
    render(<ImportRepoModal {...baseProps({ onCloneRemote })} />);

    await user.click(screen.getByTestId('import-tab-remote'));
    await user.type(screen.getByTestId('import-url'), 'https://github.com/org/demo.git');
    await user.click(screen.getByTestId('import-clone-submit'));

    await waitFor(() =>
      expect(onCloneRemote).toHaveBeenCalledWith(
        'https://github.com/org/demo.git',
        undefined
      )
    );
  });

  it('surfaces a clone failure without closing the dialog', async () => {
    const user = userEvent.setup();
    const onCloneRemote = vi.fn().mockRejectedValue(new Error('clone failed'));
    const onClose = vi.fn();
    render(<ImportRepoModal {...baseProps({ onCloneRemote, onClose })} />);

    await user.click(screen.getByTestId('import-tab-remote'));
    await user.type(screen.getByTestId('import-url'), 'https://github.com/org/nope.git');
    await user.click(screen.getByTestId('import-clone-submit'));

    await waitFor(() =>
      expect(screen.getByTestId('import-dialog')).toHaveTextContent('clone failed')
    );
    expect(screen.getByTestId('import-dialog')).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('surfaces a local import failure without closing the dialog', async () => {
    const user = userEvent.setup();
    const onImportLocal = vi.fn().mockRejectedValue(new Error('path not found'));
    render(<ImportRepoModal {...baseProps({ onImportLocal })} />);

    await user.type(screen.getByTestId('import-name'), 'bad');
    await user.type(screen.getByTestId('import-path'), 'C:/nope');
    await user.click(screen.getByTestId('import-submit'));

    await waitFor(() =>
      expect(screen.getByTestId('import-dialog')).toHaveTextContent('path not found')
    );
    expect(screen.getByTestId('import-dialog')).toBeInTheDocument();
  });

  it('v0.6 closeout: offers suggested subdirs after an over-limit reject and re-imports on click', async () => {
    const user = userEvent.setup();
    const overLimitRepo: Repo = {
      ...readyRepo,
      status: 'error',
      error: 'repo exceeds 3000 files (found 4200); import a submodule or repo root instead',
      suggestedSubdirs: ['packages', 'apps']
    };
    const onImportLocal = vi
      .fn()
      .mockResolvedValueOnce(overLimitRepo)
      .mockResolvedValueOnce(readyRepo);
    const onClose = vi.fn();
    render(<ImportRepoModal {...baseProps({ onImportLocal, onClose })} />);

    await user.type(screen.getByTestId('import-name'), 'monorepo');
    await user.type(screen.getByTestId('import-path'), 'C:/big');
    await user.click(screen.getByTestId('import-submit'));

    await waitFor(() =>
      expect(screen.getByTestId('import-suggested-subdirs')).toBeInTheDocument()
    );
    // The dialog stays open and shows the backend's real error.
    expect(screen.getByTestId('import-dialog')).toHaveTextContent(/repo exceeds 3000 files/);
    expect(onClose).not.toHaveBeenCalled();

    await user.click(screen.getAllByTestId('import-suggested-subdir')[0]);
    await waitFor(() => expect(onImportLocal).toHaveBeenCalledTimes(2));
    expect(onImportLocal).toHaveBeenLastCalledWith('monorepo', 'C:/big/packages');
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('reports an indexing error once the cloned repo flips to error', async () => {
    const user = userEvent.setup();
    let releaseClone: (repo: Repo) => void = () => {};
    const onCloneRemote = vi.fn().mockReturnValue(
      new Promise<Repo>((resolve) => {
        releaseClone = resolve;
      })
    );
    const onClose = vi.fn();
    const { rerender } = render(<ImportRepoModal {...baseProps({ onCloneRemote, onClose })} />);

    await user.click(screen.getByTestId('import-tab-remote'));
    await user.type(screen.getByTestId('import-url'), 'https://github.com/org/demo.git');
    await user.click(screen.getByTestId('import-clone-submit'));
    releaseClone(indexingRepo);

    await waitFor(() =>
      expect(screen.getByTestId('import-clone-progress')).toHaveTextContent(
        '正在索引并分析…'
      )
    );

    rerender(
      <ImportRepoModal
        {...baseProps({
          onCloneRemote,
          onClose,
          repos: [{ ...indexingRepo, status: 'error', error: 'parser exploded' }]
        })}
      />
    );
    await waitFor(() =>
      expect(screen.getByTestId('import-dialog')).toHaveTextContent('parser exploded')
    );
    expect(onClose).not.toHaveBeenCalled();
  });

  it('closes on Escape (Bug-11)', async () => {
    const onClose = vi.fn();
    render(<ImportRepoModal {...baseProps({ onClose })} />);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });
});
