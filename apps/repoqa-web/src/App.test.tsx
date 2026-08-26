import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from './App';
import { RepoQAClient } from './client/RepoQAClient';
import type { Repo, RepoDashboard, RepoSymbol, RepoTour } from './types';

// The Inspector's monaco wiring imports the ESM-only monaco-editor package,
// which vite-node cannot resolve; tests never create a real editor.
vi.mock('./client/monacoSetup', () => ({ monaco: {} }));

// TourPlayer renders MermaidDiagram; keep jsdom away from the real renderer.
vi.mock('./client/mermaidRenderer', () => ({
  renderMermaid: vi.fn(async (_uid: string) => '<svg id="d"><text>A</text></svg>')
}));

// Issue 14: stub the browser download side effect so tests can assert it.
vi.mock('./utils/download', () => ({
  downloadTextFile: vi.fn()
}));
import { downloadTextFile } from './utils/download';

const readyRepo: Repo = {
  id: 'repo-1',
  name: 'petclinic',
  repoUrl: undefined,
  localPath: 'C:/projects/spring-petclinic',
  branch: 'main',
  status: 'ready',
  fileCount: 120,
  symbolCount: 840,
  createdAt: '2026-08-21T00:00:00.000Z',
  updatedAt: '2026-08-21T00:00:00.000Z'
};

const roundDashboard: RepoDashboard = {
  repoId: 'repo-1',
  repoName: 'petclinic',
  techStack: { summary: [], highlights: ['Spring Boot'] },
  config: { topology: [], maskedValues: true },
  scale: {
    routes: 2,
    services: 1,
    repositories: 1,
    advices: 1,
    plainClasses: 4,
    interfaces: 2,
    methods: 10,
    fields: 6,
    configKeys: 4,
    files: 8
  },
  topApis: [
    {
      name: 'listOrders',
      controller: 'OrderController',
      filePath: 'src/main/java/OrderController.java',
      lineStart: 24,
      depth: 3,
      hops: ['listOrders', 'findOrders', 'findAll']
    }
  ]
};

const roundTours: RepoTour[] = [
  {
    id: 'auth-chain',
    title: 'Trace the auth filter chain',
    description: '从认证过滤器到受保护端点',
    steps: [
      { step: '1. AuthFilter', filePath: 'src/AuthFilter.java', lineNumber: 5, symbol: 'AuthFilter', kind: 'class' }
    ],
    mermaid: 'flowchart LR\n  AuthFilter --> Stop'
  },
  {
    id: 'main-flow',
    title: 'Follow the core business flow',
    description: '',
    steps: [
      { step: '1. listOrders', filePath: 'src/OrderController.java', lineNumber: 24, symbol: 'listOrders', kind: 'method' }
    ],
    mermaid: 'flowchart LR\n  Controller --> Service'
  },
  {
    id: 'error-handling',
    title: 'Where are exceptions handled?',
    description: '',
    steps: [
      { step: '1. GlobalExceptionHandler', filePath: 'src/GlobalExceptionHandler.java', lineNumber: 9, symbol: 'GlobalExceptionHandler', kind: 'advice' }
    ],
    mermaid: 'flowchart LR\n  Advice --> Stop'
  }
];

/** Minimal QueryStream-like double so a trace submission never crashes. */
const noopStream = {
  onEvent: () => () => undefined,
  onError: () => () => undefined,
  onDone: () => () => undefined,
  connect: () => undefined,
  close: () => undefined
};

/** Stream that immediately marks the query done so the input re-enables. */
function autoDoneStream() {
  let done = () => {};
  return {
    onEvent: () => () => undefined,
    onError: () => () => undefined,
    onDone: (fn: () => void) => {
      done = fn;
      return () => undefined;
    },
    connect: () => done(),
    close: () => undefined
  };
}

function makeClient(overrides: Partial<RepoQAClient> = {}): RepoQAClient {
  return {
    listRepos: vi.fn().mockResolvedValue([readyRepo]),
    getRuntime: vi.fn().mockResolvedValue({ llm: { mode: 'none' } }),
    importRepo: vi.fn().mockResolvedValue(readyRepo),
    previewRepo: vi.fn().mockResolvedValue({
      path: 'C:/projects/spring-petclinic',
      fileCount: 120,
      javaFileCount: 30,
      xmlFileCount: 1,
      skippedDirCount: 2,
      skippedDirs: ['.git', 'node_modules']
    }),
    deleteRepo: vi.fn().mockResolvedValue(undefined),
    reindexRepo: vi.fn().mockResolvedValue(readyRepo),
    cloneRepo: vi.fn().mockResolvedValue(readyRepo),
    getRepo: vi.fn(),
    listSymbols: vi.fn().mockResolvedValue([]),
    getFileRaw: vi.fn(),
    queryRepo: vi.fn().mockReturnValue(noopStream),
    getDashboard: vi.fn().mockResolvedValue(roundDashboard),
    getTours: vi.fn().mockResolvedValue(roundTours),
    getSubgraphContext: vi.fn().mockResolvedValue({
      start: { name: 'listOrders', file: 'src/main/java/OrderController.java', line: 24 },
      nodes: [],
      tokenCount: 120,
      truncated: false,
      prunedCount: 0,
      text: '# Agent Context: listOrders'
    }),
    exportOnboarding: vi.fn().mockResolvedValue('# petclinic ONBOARDING\n'),
    baseUrl: 'http://localhost:43110',
    ...overrides
  } as unknown as RepoQAClient;
}

async function selectRepo(user: ReturnType<typeof userEvent.setup>) {
  await waitFor(() => expect(screen.getByTestId('repo-select')).toBeInTheDocument());
  await user.selectOptions(screen.getByTestId('repo-select'), 'repo-1');
  // Issue 13: the dashboard is the default view once a repo is selected.
  await waitFor(() => expect(screen.getByTestId('dashboard')).toBeInTheDocument());
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

  it('clones a remote repo through the GitHub tab and selects it (Issue 19)', async () => {
    const client = makeClient({
      cloneRepo: vi.fn().mockResolvedValue(readyRepo),
      listRepos: vi.fn().mockResolvedValue([readyRepo])
    });
    const user = userEvent.setup();
    render(<App client={client} />);
    await waitFor(() => expect(screen.getByTestId('open-import')).toBeInTheDocument());

    await user.click(screen.getByTestId('open-import'));
    await user.click(screen.getByTestId('import-tab-remote'));
    await user.type(screen.getByTestId('import-url'), 'https://github.com/org/petclinic.git');
    await user.type(screen.getByTestId('import-branch'), 'main');
    await user.click(screen.getByTestId('import-clone-submit'));

    await waitFor(() =>
      expect(client.cloneRepo).toHaveBeenCalledWith(
        'https://github.com/org/petclinic.git',
        'main'
      )
    );
    await waitFor(() => expect(screen.getByTestId('repo-select')).toHaveValue('repo-1'));
  });

  it('surfaces a clone failure without closing the dialog (Issue 19)', async () => {
    const client = makeClient({
      cloneRepo: vi.fn().mockRejectedValue(new Error('clone failed'))
    });
    const user = userEvent.setup();
    render(<App client={client} />);
    await waitFor(() => expect(screen.getByTestId('open-import')).toBeInTheDocument());

    await user.click(screen.getByTestId('open-import'));
    await user.click(screen.getByTestId('import-tab-remote'));
    await user.type(screen.getByTestId('import-url'), 'https://github.com/org/nope.git');
    await user.click(screen.getByTestId('import-clone-submit'));

    await waitFor(() =>
      expect(screen.getByTestId('import-dialog')).toHaveTextContent('clone failed')
    );
    expect(screen.getByTestId('import-dialog')).toBeInTheDocument();
  });

  it('shows the ready status stepper once a repo is selected', async () => {
    const user = userEvent.setup();
    render(<App client={makeClient()} />);
    await selectRepo(user);
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

describe('Issue 13 main-view switching (dashboard / tour / chat)', () => {
  it('lands on the dashboard after selecting a repo', async () => {
    const user = userEvent.setup();
    render(<App client={makeClient()} />);
    await selectRepo(user);
    expect(screen.getByTestId('highlight-badge')).toHaveTextContent('Spring Boot');
    expect(screen.queryByTestId('back-to-dashboard')).not.toBeInTheDocument();
  });

  it('plays a tour from the sidebar and returns to the dashboard with one click', async () => {
    const client = makeClient();
    client.getFileRaw = vi.fn().mockResolvedValue('class AuthFilter {}');
    const user = userEvent.setup();
    render(<App client={client} />);
    await selectRepo(user);

    await user.click(screen.getByTestId('tour-auth-chain'));
    await waitFor(() => expect(screen.getByTestId('tour-player')).toBeInTheDocument());
    expect(screen.getByTestId('tour-progress')).toHaveTextContent('Step 1 / 1');
    // First step auto-opens in the Inspector.
    await waitFor(() => expect(client.getFileRaw).toHaveBeenCalledWith('repo-1', 'src/AuthFilter.java'));

    await user.click(screen.getByTestId('back-to-dashboard'));
    await waitFor(() => expect(screen.getByTestId('dashboard')).toBeInTheDocument());
    expect(screen.queryByTestId('tour-player')).not.toBeInTheDocument();
  });

  it('starts a call-chain trace when a top API entry is clicked', async () => {
    const client = makeClient();
    const user = userEvent.setup();
    render(<App client={client} />);
    await selectRepo(user);

    await user.click(screen.getByTestId('api-entry'));
    await waitFor(() => expect(screen.getByTestId('chat-input')).toBeInTheDocument());
    expect(screen.getByTestId('user-message')).toHaveTextContent('listOrders 的完整调用链是怎样的？');
    expect(client.queryRepo).toHaveBeenCalledWith(
      'repo-1',
      'listOrders 的完整调用链是怎样的？',
      'call-chain',
      { name: 'listOrders', file: 'src/main/java/OrderController.java' }
    );
    expect(screen.getByTestId('back-to-dashboard')).toBeInTheDocument();
  });

  it('switches to the chat view from the dashboard 提问 button', async () => {
    const user = userEvent.setup();
    render(<App client={makeClient()} />);
    await selectRepo(user);

    await user.click(screen.getByTestId('open-chat'));
    await waitFor(() => expect(screen.getByTestId('chat-input')).toBeInTheDocument());
    await user.click(screen.getByTestId('back-to-dashboard'));
    await waitFor(() => expect(screen.getByTestId('dashboard')).toBeInTheDocument());
  });
});

describe('Issue 14 ONBOARDING.md export', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    // Bug-R2-02: selecting a repo persists `?repo=` via history.pushState;
    // reset the URL so the deep-link never leaks into the next test.
    window.history.replaceState(null, '', '/');
  });

  it('downloads {repoName}-ONBOARDING.md for the selected repo', async () => {
    const client = makeClient();
    const user = userEvent.setup();
    render(<App client={client} />);
    await selectRepo(user);

    await user.click(screen.getByTestId('export-onboarding'));
    await waitFor(() => expect(client.exportOnboarding).toHaveBeenCalledWith('repo-1'));
    await waitFor(() =>
      expect(downloadTextFile).toHaveBeenCalledWith(
        'petclinic-ONBOARDING.md',
        '# petclinic ONBOARDING\n'
      )
    );
  });

  it('hides the export button until a repo is selected', async () => {
    const user = userEvent.setup();
    render(<App client={makeClient()} />);
    await waitFor(() => expect(screen.getByTestId('repo-select')).toBeInTheDocument());
    expect(screen.queryByTestId('export-onboarding')).not.toBeInTheDocument();

    await selectRepo(user);
    expect(screen.getByTestId('export-onboarding')).toBeInTheDocument();
  });

  it('surfaces an export failure without leaving the dashboard', async () => {
    const client = makeClient({
      exportOnboarding: vi.fn().mockRejectedValue(new Error('export boom'))
    });
    const user = userEvent.setup();
    render(<App client={client} />);
    await selectRepo(user);

    await user.click(screen.getByTestId('export-onboarding'));
    await waitFor(() => expect(screen.getByText('export boom')).toBeInTheDocument());
    expect(screen.getByTestId('dashboard')).toBeInTheDocument();
    expect(downloadTextFile).not.toHaveBeenCalled();
  });
});

describe('Issue 16 cockpit deep link (?repo=<id>)', () => {
  afterEach(() => {
    window.history.replaceState(null, '', '/');
  });

  it('auto-selects the repo from the query param and lands on the dashboard', async () => {
    window.history.replaceState(null, '', '/?repo=repo-1');
    render(<App client={makeClient()} />);
    await waitFor(() => expect(screen.getByTestId('dashboard')).toBeInTheDocument());
  });

  it('keeps the manual selection flow when no query param is present', async () => {
    render(<App client={makeClient()} />);
    await waitFor(() => expect(screen.getByTestId('repo-select')).toBeInTheDocument());
    expect(screen.queryByTestId('dashboard')).not.toBeInTheDocument();
    expect(screen.getByTestId('empty-state')).toBeInTheDocument();
  });
});

describe('Bug-R2-02 browser history', () => {
  afterEach(() => {
    window.history.replaceState(null, '', '/');
  });

  it('restores the previous repo on back and the current repo on forward', async () => {
    const repo2: Repo = { ...readyRepo, id: 'repo-2', name: 'cc-self' };
    const client = makeClient({
      listRepos: vi.fn().mockResolvedValue([readyRepo, repo2]),
      getDashboard: vi.fn().mockResolvedValue(roundDashboard)
    });
    const user = userEvent.setup();
    window.history.replaceState(null, '', '/');
    render(<App client={client} />);

    await waitFor(() => expect(screen.getByTestId('repo-select')).toBeInTheDocument());
    await user.selectOptions(screen.getByTestId('repo-select'), 'repo-1');
    await waitFor(() => expect(window.location.search).toContain('repo=repo-1'));
    await user.selectOptions(screen.getByTestId('repo-select'), 'repo-2');
    await waitFor(() => expect(window.location.search).toContain('repo=repo-2'));

    window.history.back();
    await waitFor(() => expect(window.location.search).toContain('repo=repo-1'));
    expect(screen.getByTestId('repo-select')).toHaveValue('repo-1');

    window.history.forward();
    await waitFor(() => expect(window.location.search).toContain('repo=repo-2'));
    expect(screen.getByTestId('repo-select')).toHaveValue('repo-2');
  });
});

describe('Issue 30 repo_updated hot reload', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    window.history.replaceState(null, '', '/');
  });

  it('silently refreshes symbols and dashboard without leaving the view', async () => {
    class FakeWebSocket {
      static instances: FakeWebSocket[] = [];
      onmessage: ((event: MessageEvent) => void) | null = null;
      onopen: (() => void) | null = null;
      onclose: (() => void) | null = null;
      onerror: (() => void) | null = null;
      readyState = 0;
      constructor(public url: string) {
        FakeWebSocket.instances.push(this);
      }
      close() {}
      send() {}
      dispatch(payload: unknown) {
        this.onmessage?.({ data: JSON.stringify(payload) } as MessageEvent);
      }
    }
    vi.stubGlobal('WebSocket', FakeWebSocket as unknown as typeof WebSocket);

    const hotSymbol: RepoSymbol = {
      id: 1,
      repoId: 'repo-1',
      kind: 'method',
      name: 'hotReloaded',
      filePath: 'src/main/java/HotController.java',
      lineStart: 5,
      lineEnd: 7,
      signature: 'hotReloaded()',
      calls: null
    };
    const client = makeClient({
      listSymbols: vi.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([hotSymbol]),
      getDashboard: vi
        .fn()
        .mockResolvedValueOnce(roundDashboard)
        .mockResolvedValueOnce({ ...roundDashboard, repoName: 'petclinic-hot' })
    });
    const user = userEvent.setup();
    render(<App client={client} />);
    await selectRepo(user);
    expect(client.listSymbols).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(FakeWebSocket.instances.length).toBeGreaterThan(0));

    FakeWebSocket.instances[0].dispatch({
      type: 'repo_updated',
      payload: {
        repoId: 'repo-1',
        files: ['src/main/java/HotController.java'],
        action: 'update',
        ts: Date.now()
      }
    });

    await waitFor(() => expect(client.listSymbols).toHaveBeenCalledTimes(2));
    expect(client.getDashboard).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId('dashboard')).toBeInTheDocument();
    expect(screen.queryByTestId('back-to-dashboard')).not.toBeInTheDocument();
  });
});

describe('Sprint 1 remote LLM privacy consent', () => {
  afterEach(() => {
    window.history.replaceState(null, '', '/');
  });

  it('asks once per page session before the first remote question', async () => {
    const client = makeClient({
      getRuntime: vi.fn().mockResolvedValue({ llm: { mode: 'remote', host: 'api.***.com' } }),
      queryRepo: vi.fn().mockReturnValue(autoDoneStream())
    });
    const user = userEvent.setup();
    render(<App client={client} />);
    await waitFor(() =>
      expect(screen.getByTestId('privacy-pill')).toHaveTextContent('远程模型')
    );
    await selectRepo(user);
    await user.click(screen.getByTestId('open-chat'));

    await user.type(screen.getByTestId('chat-input'), 'architecture overview');
    await user.click(screen.getByTestId('chat-submit'));
    expect(client.queryRepo).not.toHaveBeenCalled();
    expect(screen.getByTestId('consent-modal')).toHaveTextContent('api.***.com');

    await user.click(screen.getByTestId('consent-confirm'));
    await waitFor(() => expect(client.queryRepo).toHaveBeenCalledTimes(1));
    expect(screen.queryByTestId('consent-modal')).not.toBeInTheDocument();

    // The consent is in-memory for the session: the second question submits
    // without reopening the modal.
    await user.type(screen.getByTestId('chat-input'), 'second question');
    await user.click(screen.getByTestId('chat-submit'));
    await waitFor(() => expect(client.queryRepo).toHaveBeenCalledTimes(2));
    expect(screen.queryByTestId('consent-modal')).not.toBeInTheDocument();
  });

  it('keeps the question unsent when consent is cancelled', async () => {
    const client = makeClient({
      getRuntime: vi.fn().mockResolvedValue({ llm: { mode: 'remote', host: 'api.***.com' } }),
      queryRepo: vi.fn().mockReturnValue(autoDoneStream())
    });
    const user = userEvent.setup();
    render(<App client={client} />);
    await waitFor(() =>
      expect(screen.getByTestId('privacy-pill')).toHaveTextContent('远程模型')
    );
    await selectRepo(user);
    await user.click(screen.getByTestId('open-chat'));

    await user.type(screen.getByTestId('chat-input'), 'architecture overview');
    await user.click(screen.getByTestId('chat-submit'));
    expect(screen.getByTestId('consent-modal')).toBeInTheDocument();

    await user.click(screen.getByTestId('consent-cancel'));
    expect(screen.queryByTestId('consent-modal')).not.toBeInTheDocument();
    expect(client.queryRepo).not.toHaveBeenCalled();

    // Asking again reopens the consent; it is still not permanently granted.
    await user.type(screen.getByTestId('chat-input'), 'another question');
    await user.click(screen.getByTestId('chat-submit'));
    expect(screen.getByTestId('consent-modal')).toBeInTheDocument();
    expect(client.queryRepo).not.toHaveBeenCalled();
  });
});
