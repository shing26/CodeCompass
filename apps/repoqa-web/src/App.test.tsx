import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from './App';
import { RepoQAClient } from './client/RepoQAClient';
import type { Repo } from './types';

// The Inspector's monaco wiring imports the ESM-only monaco-editor package,
// which vite-node cannot resolve; tests never create a real editor.
vi.mock('./client/monacoSetup', () => ({ monaco: {} }));

const readyRepo: Repo = {
  id: 'repo-1',
  name: 'petclinic',
  repo_url: null as unknown as undefined,
  local_path: 'C:/projects/spring-petclinic',
  branch: 'main',
  status: 'ready',
  file_count: 120,
  symbol_count: 840,
  created_at: '2026-08-21T00:00:00.000Z',
  updated_at: '2026-08-21T00:00:00.000Z'
};

function makeClient(overrides: Partial<RepoQAClient> = {}): RepoQAClient {
  return {
    listRepos: vi.fn().mockResolvedValue([readyRepo]),
    importRepo: vi.fn().mockResolvedValue(readyRepo),
    getRepo: vi.fn(),
    listSymbols: vi.fn().mockResolvedValue([]),
    getFileRaw: vi.fn(),
    queryRepo: vi.fn(),
    baseUrl: 'http://localhost:43110',
    ...overrides
  } as unknown as RepoQAClient;
}

describe('App scaffold and repo connect', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('renders the three-pane shell with TopBar, Sidebar, Canvas and Inspector', async () => {
    render(<App client={makeClient()} />);
    await waitFor(() => expect(screen.getByTestId('repo-select')).toBeInTheDocument());
    expect(screen.getByTestId('sidebar')).toBeInTheDocument();
    expect(screen.getByTestId('canvas')).toBeInTheDocument();
    expect(screen.getByTestId('inspector')).toBeInTheDocument();
  });

  it('shows empty-state guidance while no repo is selected', async () => {
    render(<App client={makeClient()} />);
    await waitFor(() =>
      expect(screen.getByText(/Start by connecting a repo/)).toBeInTheDocument()
    );
  });

  it('imports a repo through the dialog and selects it in the TopBar', async () => {
    const client = makeClient();
    const user = userEvent.setup();
    render(<App client={client} />);
    await waitFor(() => expect(screen.getByTestId('repo-select')).toBeInTheDocument());

    await user.click(screen.getByTestId('open-import'));
    await user.type(screen.getByTestId('import-name'), 'petclinic');
    await user.type(screen.getByTestId('import-path'), 'C:/projects/spring-petclinic');
    await user.click(screen.getByTestId('import-submit'));

    await waitFor(() => expect(client.importRepo).toHaveBeenCalledWith({ name: 'petclinic', localPath: 'C:/projects/spring-petclinic' }));
    // The shared mock list returns the same repo; selector gets the imported one.
    await waitFor(() => expect(screen.getByTestId('repo-select')).toHaveValue('repo-1'));
  });

  it('shows the ready status stepper once a repo is selected', async () => {
    const user = userEvent.setup();
    render(<App client={makeClient()} />);
    await waitFor(() => expect(screen.getByTestId('repo-select')).toBeInTheDocument());
    await user.selectOptions(screen.getByTestId('repo-select'), 'repo-1');
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('Graph Ready'));
  });

  it('shows an error badge when the selected repo failed to index', async () => {
    const erroredRepo: Repo = { ...readyRepo, status: 'error' };
    const client = makeClient({ listRepos: vi.fn().mockResolvedValue([erroredRepo]) });
    const user = userEvent.setup();
    render(<App client={client} />);
    await waitFor(() => expect(screen.getByTestId('repo-select')).toBeInTheDocument());
    await user.selectOptions(screen.getByTestId('repo-select'), 'repo-1');
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('Error'));
    expect(screen.getByTestId('status')).not.toHaveTextContent('Graph Ready');
  });

  it('surfaces an import failure without closing the dialog', async () => {
    const client = makeClient({
      importRepo: vi.fn().mockRejectedValue(new Error('import failed'))
    });
    const user = userEvent.setup();
    render(<App client={client} />);
    await waitFor(() => expect(screen.getByTestId('open-import')).toBeInTheDocument());

    await user.click(screen.getByTestId('open-import'));
    await user.type(screen.getByTestId('import-name'), 'bad');
    await user.type(screen.getByTestId('import-path'), 'C:/nope');
    await user.click(screen.getByTestId('import-submit'));

    await waitFor(() =>
      expect(screen.getByTestId('import-dialog')).toHaveTextContent('import failed')
    );
    expect(screen.getByTestId('import-dialog')).toBeInTheDocument();
  });
});