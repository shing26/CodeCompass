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
    listReverseDeps: vi.fn().mockResolvedValue({
      repoId: 'repo-1',
      target: { name: 'listOrders', file: 'src/main/java/OrderController.java', line: 24 },
      callers: [],
      count: 0,
      fallback: false
    }),
    exportOnboarding: vi.fn().mockResolvedValue('# petclinic ONBOARDING\n'),
    // v0.26-B ticket 02: CiGateView（gate tab）挂载即回放运行史。runGate 桩
    // 给合法 GateRunRow 形状——若有用例点「运行并记录」，prepend 消费的是
    // 真字段（{} 会在 isDirtyRun(run.commit) 上抛 TypeError，review h）。
    listGateRuns: vi.fn().mockResolvedValue({ runs: [], total: 0 }),
    runGate: vi.fn().mockResolvedValue({
      id: 'gate-echo',
      commit: 'a1b2c3d',
      base: 'origin/main',
      head: 'HEAD',
      options: { maxAffectedRoutes: 10, failOnBreak: true },
      status: 'PASS',
      violationsCount: 0,
      routesCount: 0,
      error: null,
      detail: null,
      durationMs: 1,
      source: 'workbench',
      createdAt: '2026-09-11 07:00:00'
    }),
    baseUrl: 'http://localhost:43110',
    chat: {
      listSessions: vi.fn().mockResolvedValue([]),
      createSession: vi
        .fn()
        .mockResolvedValue({ id: 'chat-s1', repoId: 'repo-1', title: '会话 09-07 10:00', createdAt: '' }),
      messages: vi.fn().mockResolvedValue([]),
      chatSend: vi.fn().mockResolvedValue({
        answer: '分析完成：orphanedPublic 共 3 项 [cite: 1]',
        citations: [{ n: 1, tool: 'codecompass_scan', args: { repoId: 'repo-1' }, ms: 3 }],
        steps: 2,
        fallback: false
      }),
      switchModel: vi.fn().mockResolvedValue(undefined),
      modelInfo: vi.fn().mockResolvedValue({ profiles: ['default'], active: 'default', configured: true })
    },
    ...overrides
  } as unknown as RepoQAClient;
}

async function selectRepo(user: ReturnType<typeof userEvent.setup>) {
  await waitFor(() => expect(screen.getByTestId('repo-select')).toBeInTheDocument());
  await user.selectOptions(screen.getByTestId('repo-select'), 'repo-1');
  // Issue 31: the topology workbench is the default view once a repo is selected.
  await waitFor(() => expect(screen.getByTestId('offline-hint')).toBeInTheDocument());
}

describe('App scaffold and repo connect', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('renders the shell with TopBar, Sidebar and Canvas; Inspector is a drawer (hidden until a node is opened)', async () => {
    render(<App client={makeClient()} />);
    await waitFor(() => expect(screen.getByTestId('repo-select')).toBeInTheDocument());
    expect(screen.getByTestId('sidebar')).toBeInTheDocument();
    expect(screen.getByTestId('canvas')).toBeInTheDocument();
    // 改造 1: Inspector 按需滑出——未点节点时不在桌面布局占位（jsdom 按 display:none 判定不可见）
    expect(screen.getByTestId('inspector')).toBeInTheDocument();
  });

  it('shows empty-state guidance while no repo is selected', async () => {
    render(<App client={makeClient()} />);
    await waitFor(() => expect(screen.getByText(/三步开始代码架构分析/)).toBeInTheDocument());
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

  it('shows the Watcher Ready capsule once a repo is selected', async () => {
    const user = userEvent.setup();
    render(<App client={makeClient()} />);
    await selectRepo(user);
    expect(screen.getByTestId('watcher-status')).toHaveTextContent('Watcher: Ready');
  });

  it('shows a Watcher Offline capsule when the selected repo failed to index', async () => {
    const erroredRepo: Repo = { ...readyRepo, status: 'error' };
    const client = makeClient({ listRepos: vi.fn().mockResolvedValue([erroredRepo]) });
    const user = userEvent.setup();
    render(<App client={client} />);
    await waitFor(() => expect(screen.getByTestId('repo-select')).toBeInTheDocument());
    await user.selectOptions(screen.getByTestId('repo-select'), 'repo-1');
    await waitFor(() =>
      expect(screen.getByTestId('watcher-status')).toHaveTextContent('Watcher: Offline')
    );
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

describe('v0.27-UI ticket 02: AskDock global bar (问现状入口)', () => {
  beforeEach(() => {
    window.history.replaceState(null, '', '/');
  });
  afterEach(() => {
    window.history.replaceState(null, '', '/');
  });

  it('asks from the topology view: Enter prefills the chat composer WITHOUT auto-sending', async () => {
    const client = makeClient();
    const user = userEvent.setup();
    render(<App client={client} />);
    await selectRepo(user);

    // 主区下沿常驻对话条（topo 视图）
    await waitFor(() => expect(screen.getByTestId('ask-dock')).toBeInTheDocument());
    await user.type(screen.getByTestId('ask-dock-input'), '这个仓库哪里最值得改？');
    await user.keyboard('{Enter}');

    // 切进 chat 且问题已预填；chatSend 未被调用（发送权留给用户）
    await waitFor(() => expect(screen.getByTestId('chat-view')).toBeInTheDocument());
    expect(screen.getByTestId('chat-question')).toHaveValue('这个仓库哪里最值得改？');
    expect(client.chat.chatSend).not.toHaveBeenCalled();
    // chat 视图自带 composer → dock 让位
    expect(screen.queryByTestId('ask-dock')).not.toBeInTheDocument();
  });

  it('the draft is consumed once: leaving and re-entering chat shows an empty composer', async () => {
    const client = makeClient();
    const user = userEvent.setup();
    render(<App client={client} />);
    await selectRepo(user);

    await waitFor(() => expect(screen.getByTestId('ask-dock')).toBeInTheDocument());
    await user.type(screen.getByTestId('ask-dock-input'), '一次性草稿');
    await user.click(screen.getByTestId('ask-dock-send'));
    await waitFor(() => expect(screen.getByTestId('chat-question')).toHaveValue('一次性草稿'));

    // 返回工作台 → 再进 chat：草稿已被消费，不复注入
    await user.click(screen.getByTestId('chat-back'));
    await waitFor(() => expect(screen.getByTestId('ask-dock')).toBeInTheDocument());
    await user.click(screen.getByTestId('tab-chat'));
    await waitFor(() => expect(screen.getByTestId('chat-view')).toBeInTheDocument());
    expect(screen.getByTestId('chat-question')).toHaveValue('');
  });

  it('a draft asked in repo A never leaks into repo B chat (review P1-1 cross-repo)', async () => {
    const repoB = { ...readyRepo, id: 'repo-2', name: 'other-repo' };
    const client = makeClient({ listRepos: vi.fn().mockResolvedValue([readyRepo, repoB]) });
    const user = userEvent.setup();
    render(<App client={client} />);
    await selectRepo(user);

    await waitFor(() => expect(screen.getByTestId('ask-dock')).toBeInTheDocument());
    await user.type(screen.getByTestId('ask-dock-input'), 'A 库的问题');
    await user.click(screen.getByTestId('ask-dock-send'));
    await waitFor(() => expect(screen.getByTestId('chat-question')).toHaveValue('A 库的问题'));

    // chat 视图内切库：URL mode=incident→chat 使视图不离开 chat（RepoContext 语义），
    // 草稿带 repoId 归属 + key 重挂载——B 库 composer 必须干净。
    await user.selectOptions(screen.getByTestId('repo-select'), 'repo-2');
    await waitFor(() => expect(screen.getByTestId('chat-session-title')).toHaveTextContent('other-repo'));
    expect(screen.getByTestId('chat-question')).toHaveValue('');
  });

  it('no repo → no dock; dock returns on non-chat tabs', async () => {
    const user = userEvent.setup();
    render(<App client={makeClient()} />);
    // 未选库：无可问对象，dock 不渲染
    expect(screen.queryByTestId('ask-dock')).not.toBeInTheDocument();

    await selectRepo(user);
    await waitFor(() => expect(screen.getByTestId('ask-dock')).toBeInTheDocument());
    await user.click(screen.getByTestId('tab-metrics'));
    expect(screen.getByTestId('ask-dock')).toBeInTheDocument();
  });
});

describe('v0.26-A ticket 02: plan-digest bridge (chat answer → 方案摘要 → CTA → evolve)', () => {
  beforeEach(() => {
    window.history.replaceState(null, '', '/');
  });
  afterEach(() => {
    window.history.replaceState(null, '', '/');
  });

  it('routes the plan CTA into the evolution workbench with the bottom line pinned', async () => {
    const client = makeClient();
    Object.assign(client.chat, {
      chatSend: vi.fn().mockResolvedValue({
        answer: '拆解完成 [cite: 1]',
        citations: [{ n: 1, tool: 'codecompass_plan_evolution', args: { repoId: 'repo-1' }, ms: 4 }],
        planCards: [
          {
            intentType: 'DEPRECATE',
            target: 'LegacyOrderService',
            riskLevel: 'HIGH',
            items: [{ category: '删除清单', action: 'DELETE', filePath: 'src/Legacy.java', description: '待删' }]
          }
        ],
        steps: 2,
        fallback: false
      })
    });
    const user = userEvent.setup();
    render(<App client={client} />);
    await selectRepo(user);

    await user.click(screen.getByTestId('tab-chat'));
    await waitFor(() => expect(screen.getByTestId('chat-view')).toBeInTheDocument());
    await user.type(screen.getByTestId('chat-question'), '拆掉 LegacyOrderService');
    await user.click(screen.getByTestId('chat-send'));

    await waitFor(() => expect(screen.getByTestId('plan-cards')).toBeInTheDocument());
    // 底线句常驻（非角落）；CTA 是问答口→方案口的桥
    expect(screen.getByTestId('plan-bottomline')).toHaveTextContent('引擎只读，改动由你执行');
    await user.click(screen.getByTestId('plan-open-evolution'));
    await waitFor(() => expect(screen.getByTestId('evolution-view')).toBeInTheDocument());
  });
});

describe('v0.26-B ticket 03: gate impact tree → Inspector navigation', () => {
  beforeEach(() => {
    // tab-gate 的 replaceState ?mode= 会漏进后续用例（票 16 URL 真理源）——
    // 与 Issue 31 同款卫生措施。
    window.history.replaceState(null, '', '/');
  });
  afterEach(() => {
    window.history.replaceState(null, '', '/');
  });

  it('route node click opens the Inspector on the target file (ticket-11 drawer pattern)', async () => {
    const run = {
      id: 'g1', commit: 'a1b2c3d4e5f6', base: 'main', head: 'HEAD', options: {},
      status: 'FAIL', violationsCount: 1, routesCount: 1,
      error: null, detail: null, durationMs: 5, source: 'workbench', createdAt: '2026-09-11 07:00:00',
      payload: {
        impactedApis: [
          {
            routeSymbol: {
              name: 'getOwners', file: 'impact03/OwnerController.java', lineStart: 12, lineEnd: 15,
              kind: 'route', parentType: 'OwnerController', displayPath: '/owners'
            },
            affectedBySymbols: ['OwnerService.findOwners'],
            riskLevel: 'HIGH'
          }
        ]
      }
    };
    const client = makeClient({
      listGateRuns: vi.fn().mockResolvedValue({ runs: [run], total: 1 }),
      getFileRaw: vi.fn().mockResolvedValue('class OwnerController {}')
    });
    const user = userEvent.setup();
    render(<App client={client} />);
    await selectRepo(user);

    await user.click(screen.getByTestId('tab-gate'));
    await waitFor(() => expect(screen.getByTestId('gate-tree-toggle')).toBeInTheDocument());
    await user.click(screen.getByTestId('gate-tree-toggle'));
    await user.click(screen.getByTestId('gate-impact-node'));

    // 票 11 同款**状态级**抽屉断言：mask 渲染 ⇔ inspectorOpen（jsdom 默认视口
    // 1024px，本用例不模拟媒体查询——375px 的 CSS 兑现由 Inspector 的 md: 类
    // 在真实浏览器保证，与票 11 先例同一验证层级）。
    await waitFor(() => expect(screen.getByTestId('inspector-mask')).toBeInTheDocument());
    expect(screen.getByTestId('inspector')).toHaveClass('translate-x-0');
    // 面包屑显示目标文件（glow 行到位由 Inspector.test 的既有 glow 契约保证）
    await waitFor(() =>
      expect(screen.getByTestId('breadcrumb-file')).toHaveTextContent('impact03/OwnerController.java')
    );
    expect(client.getFileRaw).toHaveBeenCalledWith('repo-1', 'impact03/OwnerController.java');
  });
});

describe('Issue 31 workbench tab switching (topo / metrics / gate)', () => {
  // Ticket 16 made handleSelectRepo honor a pending ?mode= (URL-as-truth);
  // without this reset the delta tab's replaceState URL leaks into the next
  // test, auto-selects on mount and starves selectOptions (same-value → no
  // change event). Same hygiene the Issue 14 describe applies (Bug-R2-02).
  beforeEach(() => {
    window.history.replaceState(null, '', '/');
  });

  it('lands on the topology workbench after selecting a repo', async () => {
    const user = userEvent.setup();
    render(<App client={makeClient()} />);
    await selectRepo(user);
    expect(screen.getByTestId('offline-hint')).toBeInTheDocument();
    expect(screen.queryByTestId('dashboard')).not.toBeInTheDocument();
    expect(screen.queryByTestId('back-to-dashboard')).not.toBeInTheDocument();
  });

  it('switches to the metrics dashboard and the CI gate via the TopBar tabs', async () => {
    const user = userEvent.setup();
    render(<App client={makeClient()} />);
    await selectRepo(user);

    await user.click(screen.getByTestId('tab-metrics'));
    await waitFor(() => expect(screen.getByTestId('dashboard')).toBeInTheDocument());
    expect(screen.getByTestId('highlight-badge')).toHaveTextContent('Spring Boot');

    await user.click(screen.getByTestId('tab-gate'));
    await waitFor(() => expect(screen.getByTestId('ci-gate')).toBeInTheDocument());

    await user.click(screen.getByTestId('tab-topo'));
    await waitFor(() => expect(screen.getByTestId('offline-hint')).toBeInTheDocument());
    expect(screen.queryByTestId('dashboard')).not.toBeInTheDocument();
  });

  it('opens the evolution workbench from the TopBar tab and Sidebar entry (Ticket 04)', async () => {
    const user = userEvent.setup();
    const evolveStream = vi.fn(() => ({
      onEvent: () => () => undefined,
      onError: () => () => undefined,
      onDone: () => () => undefined,
      connect: async () => undefined,
      close: () => undefined
    }));
    render(<App client={makeClient({ evolveStream })} />);
    await selectRepo(user);

    await user.click(screen.getByTestId('tab-evolve'));
    await waitFor(() => expect(screen.getByTestId('evolution-view')).toBeInTheDocument());
    expect(screen.getByTestId('evolve-intent')).toBeInTheDocument();
    expect(evolveStream).not.toHaveBeenCalled();

    // Sidebar entry reaches the same view.
    await user.click(screen.getByTestId('tab-topo'));
    await user.click(screen.getByTestId('sidebar-evolution'));
    await waitFor(() => expect(screen.getByTestId('evolution-view')).toBeInTheDocument());
  });

  it('switches to the architecture delta workbench tab (v0.6.0)', async () => {
    const user = userEvent.setup();
    render(<App client={makeClient()} />);
    await selectRepo(user);

    await user.click(screen.getByTestId('tab-delta'));
    await waitFor(() =>
      expect(screen.getByTestId('architecture-delta')).toBeInTheDocument()
    );
  });

  it('plays a tour from the sidebar and returns to the workbench with one click', async () => {
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
    await waitFor(() => expect(screen.getByTestId('offline-hint')).toBeInTheDocument());
    expect(screen.queryByTestId('tour-player')).not.toBeInTheDocument();
  });

  it('starts a call-chain trace when a top API entry is clicked', async () => {
    const client = makeClient();
    const user = userEvent.setup();
    render(<App client={client} />);
    await selectRepo(user);

    await user.click(screen.getByTestId('tab-metrics'));
    await waitFor(() => expect(screen.getByTestId('api-entry')).toBeInTheDocument());
    await user.click(screen.getByTestId('api-entry'));
    // Issue 25 / Ticket 01 — the call-chain trace lands on the topology canvas
    // (derived from the chat stream); there is no free-input bubble anymore.
    await waitFor(() => expect(screen.getByTestId('canvas')).toBeInTheDocument());
    expect(client.queryRepo).toHaveBeenCalledWith(
      'repo-1',
      'listOrders 的完整调用链是怎样的？',
      'call-chain',
      { name: 'listOrders', file: 'src/main/java/OrderController.java' },
      undefined
    );
    expect(screen.queryByTestId('back-to-dashboard')).not.toBeInTheDocument();
  });

  it('switches to the topology workbench from the dashboard 查调用链 button (v0.26-A ticket 01 改名)', async () => {
    const user = userEvent.setup();
    render(<App client={makeClient()} />);
    await selectRepo(user);

    await user.click(screen.getByTestId('tab-metrics'));
    await waitFor(() => expect(screen.getByTestId('open-chat')).toBeInTheDocument());
    await user.click(screen.getByTestId('open-chat'));
    await waitFor(() => expect(screen.getByTestId('canvas')).toBeInTheDocument());
    expect(screen.queryByTestId('back-to-dashboard')).not.toBeInTheDocument();
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

    await user.click(screen.getByTestId('more-actions'));
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
    expect(screen.queryByTestId('more-actions')).not.toBeInTheDocument();

    await selectRepo(user);
    await user.click(screen.getByTestId('more-actions'));
    expect(screen.getByTestId('export-onboarding')).toBeInTheDocument();
  });

  it('surfaces an export failure without leaving the workbench', async () => {
    const client = makeClient({
      exportOnboarding: vi.fn().mockRejectedValue(new Error('export boom'))
    });
    const user = userEvent.setup();
    render(<App client={client} />);
    await selectRepo(user);

    await user.click(screen.getByTestId('more-actions'));
    await user.click(screen.getByTestId('export-onboarding'));
    await waitFor(() => expect(screen.getByText('export boom')).toBeInTheDocument());
    expect(screen.getByTestId('offline-hint')).toBeInTheDocument();
    expect(downloadTextFile).not.toHaveBeenCalled();
  });
});

describe('Issue 16 cockpit deep link (?repo=<id>)', () => {
  afterEach(() => {
    window.history.replaceState(null, '', '/');
  });

  it('auto-selects the repo from the query param and lands on the topology workbench', async () => {
    window.history.replaceState(null, '', '/?repo=repo-1');
    render(<App client={makeClient()} />);
    await waitFor(() => expect(screen.getByTestId('offline-hint')).toBeInTheDocument());
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
    expect(screen.getByTestId('offline-hint')).toBeInTheDocument();
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

    // Issue 25 / Ticket 01 — free-form questions ride the incident composer.
    await user.click(screen.getByTestId('tab-chat'));
    await waitFor(() => expect(screen.getByTestId('chat-view')).toBeInTheDocument());
    await user.type(screen.getByTestId('chat-question'), 'architecture overview');
    await user.click(screen.getByTestId('chat-send'));
    expect(screen.getByTestId('consent-modal')).toHaveTextContent('api.***.com');

    await user.click(screen.getByTestId('consent-confirm'));
    expect(screen.queryByTestId('consent-modal')).not.toBeInTheDocument();
    // Consent 已授权（chatGuardSend 仅在用户再点发送时走已授权通道）

    // The consent is in-memory for the session: the second question submits
    // without reopening the modal.
    await user.type(screen.getByTestId('chat-question'), 'second question');
    await user.click(screen.getByTestId('chat-send'));
    await waitFor(() => expect(client.chat.chatSend).toHaveBeenCalledTimes(1));
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

    await user.click(screen.getByTestId('tab-chat'));
    await waitFor(() => expect(screen.getByTestId('chat-view')).toBeInTheDocument());
    await user.type(screen.getByTestId('chat-question'), 'architecture overview');
    await user.click(screen.getByTestId('chat-send'));
    expect(screen.getByTestId('consent-modal')).toBeInTheDocument();

    await user.click(screen.getByTestId('consent-cancel'));
    expect(screen.queryByTestId('consent-modal')).not.toBeInTheDocument();
    expect(client.chat.chatSend).not.toHaveBeenCalled();

    // Asking again reopens the consent; it is still not permanently granted.
    await user.type(screen.getByTestId('chat-question'), 'another question');
    await user.click(screen.getByTestId('chat-send'));
    expect(screen.getByTestId('consent-modal')).toBeInTheDocument();
    expect(client.chat.chatSend).not.toHaveBeenCalled();
  });
});

describe('chat-merge: chat view replaces the incident copilot (v0.24.0)', () => {
  afterEach(() => {
    window.history.replaceState(null, '', '/');
  });

  it('opens the chat view from the TopBar tab and syncs mode=incident', async () => {
    const user = userEvent.setup();
    render(<App client={makeClient()} />);
    await selectRepo(user);

    await user.click(screen.getByTestId('tab-chat'));
    await waitFor(() => expect(screen.getByTestId('chat-view')).toBeInTheDocument());
    expect(screen.getByTestId('chat-session-list')).toBeInTheDocument();
    expect(window.location.search).toContain('mode=incident');
  });

  it('lands on the chat view via the legacy ?mode=incident deep link (B3: not 404)', async () => {
    window.history.replaceState(null, '', '/?repo=repo-1&mode=incident');
    render(<App client={makeClient()} />);
    await waitFor(() => expect(screen.getByTestId('chat-view')).toBeInTheDocument());
  });

  it('sends a chat turn through the client.chat stream (Q1 承接)', async () => {
    const client = makeClient();
    const user = userEvent.setup();
    render(<App client={client} />);
    await selectRepo(user);

    await user.click(screen.getByTestId('tab-chat'));
    await waitFor(() => expect(screen.getByTestId('chat-view')).toBeInTheDocument());
    await user.type(screen.getByTestId('chat-question'), 'NPE at Demo.run');
    await user.click(screen.getByTestId('chat-send'));
    await waitFor(() => expect(client.chat.chatSend).toHaveBeenCalled());
    // Regression (v0.25 批3 分片曾把 currentRepo.id 当 sessionId 传，真实前端全部
    // 404 unknown session)：首参必须是 ChatView 的 chat-s* 会话，不是 repo-*。
    const sendArgs = (client.chat.chatSend as unknown as ReturnType<typeof vi.fn>).mock
      .calls[0] as [string, string];
    expect(sendArgs[0]).not.toMatch(/^repo-/);
    expect(sendArgs[0]).toMatch(/^chat-s/);
    // cite 角标被拆分为独立元素，正文文本不含 "[cite: 1]" 字面量
    expect(screen.getByTestId('chat-messages')).toHaveTextContent('分析完成：orphanedPublic 共 3 项');
    expect(screen.getByTestId('chat-messages')).toHaveTextContent('NPE at Demo.run');
  });

  it('restores the draft when the consent gate withholds the send', async () => {
    const client = makeClient({
      getRuntime: vi.fn().mockResolvedValue({ llm: { mode: 'remote', host: 'api.***.com' } })
    });
    const user = userEvent.setup();
    render(<App client={client} />);
    await waitFor(() => expect(screen.getByTestId('privacy-pill')).toHaveTextContent('远程模型'));
    await selectRepo(user);

    await user.click(screen.getByTestId('tab-chat'));
    await waitFor(() => expect(screen.getByTestId('chat-view')).toBeInTheDocument());
    await user.type(screen.getByTestId('chat-question'), 'NPE at Demo.run');
    await user.click(screen.getByTestId('chat-send'));
    expect(screen.getByTestId('consent-modal')).toBeInTheDocument();
    expect(client.chat.chatSend).not.toHaveBeenCalled();

    await user.click(screen.getByTestId('consent-confirm'));
    expect(screen.queryByTestId('consent-modal')).not.toBeInTheDocument();
    // 草稿已恢复，再次发送直接走已授权通道
    expect(screen.getByTestId('chat-question')).toHaveValue('NPE at Demo.run');
    await user.click(screen.getByTestId('chat-send'));
    await waitFor(() => expect(client.chat.chatSend).toHaveBeenCalled());
  });
});

describe('ticket 11 (QA-02): mobile inspector drawer re-opens after mask close', () => {
  afterEach(() => {
    window.history.replaceState(null, '', '/');
  });

  // All navigation entries share the inspector.openFile contract; the sidebar
  // route rows are the jsdom-reachable stand-in for flow-cards / anchors.
  const drawerRoutes: RepoSymbol[] = [
    {
      id: 901,
      repoId: 'repo-1',
      kind: 'route',
      name: 'getOwners',
      filePath: 'drawer11/OwnerController.java',
      lineStart: 12,
      lineEnd: 15,
      signature: null,
      calls: null,
      displayPath: '/api/owners'
    },
    {
      id: 902,
      repoId: 'repo-1',
      kind: 'route',
      name: 'postOwners',
      filePath: 'drawer11/OwnerController.java',
      lineStart: 30,
      lineEnd: 33,
      signature: null,
      calls: null,
      displayPath: '/api/owners'
    }
  ];

  function drawerClient() {
    return makeClient({
      listSymbols: vi.fn().mockResolvedValue(drawerRoutes),
      getFileRaw: vi.fn().mockResolvedValue('class OwnerController {}'),
      radar: vi.fn().mockResolvedValue({
        schemaVersion: 1,
        repoId: 'repo-1',
        matchedAnchors: [
          {
            symbol: 'getOwners',
            type: 'API',
            relevanceScore: 90,
            filePath: 'drawer11/OwnerController.java',
            line: 12,
            matchedBy: 'identifier',
            inDegree: 1,
            outDegree: 1
          }
        ],
        hubNodes: [],
        topApis: [],
        persistenceEntities: []
      })
    });
  }

  async function selectAndRevealRows(user: ReturnType<typeof userEvent.setup>) {
    render(<App client={drawerClient()} />);
    await selectRepo(user);
    await waitFor(() => expect(screen.getAllByTestId('route-item')).toHaveLength(2));
  }

  async function openDrawerViaRow(
    user: ReturnType<typeof userEvent.setup>,
    index: number
  ) {
    await user.click(screen.getAllByTestId('route-item')[index]);
    await waitFor(() => expect(screen.getByTestId('inspector-mask')).toBeInTheDocument());
    expect(screen.getByTestId('inspector')).toHaveClass('translate-x-0');
  }

  it('re-clicking the SAME route row after closing via the mask re-opens the drawer', async () => {
    const user = userEvent.setup();
    await selectAndRevealRows(user);

    await openDrawerViaRow(user, 0);

    await user.click(screen.getByTestId('inspector-mask'));
    await waitFor(() => expect(screen.queryByTestId('inspector-mask')).not.toBeInTheDocument());
    expect(screen.getByTestId('inspector')).toHaveClass('translate-x-full');

    // QA-02 repro: same file, same row — before the fix the [file] effect
    // never re-fired and the drawer stayed closed forever.
    await openDrawerViaRow(user, 0);
  });

  it('same file via the OTHER route row (different line/symbol) re-opens too', async () => {
    const user = userEvent.setup();
    await selectAndRevealRows(user);

    await openDrawerViaRow(user, 0);
    await user.click(screen.getByTestId('inspector-mask'));
    await waitFor(() => expect(screen.queryByTestId('inspector-mask')).not.toBeInTheDocument());

    await openDrawerViaRow(user, 1);
  });

  it('command-palette jump to the same file re-opens the drawer after mask close', async () => {
    const user = userEvent.setup();
    await selectAndRevealRows(user);

    // NB: `^k` shorthand does not resolve to Ctrl+K under this userEvent
    // platform detection; use the explicit modifier syntax.
    await user.keyboard('{Control>}k{/Control}');
    await waitFor(() => expect(screen.getByTestId('command-palette')).toBeInTheDocument());
    await user.type(screen.getByTestId('palette-input'), 'getOwners');
    await waitFor(() => expect(screen.getByTestId('palette-symbol-1')).toBeInTheDocument());
    await user.click(screen.getByTestId('palette-symbol-1'));
    await waitFor(() => expect(screen.getByTestId('inspector-mask')).toBeInTheDocument());
    expect(screen.getByTestId('inspector')).toHaveClass('translate-x-0');

    await user.click(screen.getByTestId('inspector-mask'));
    await waitFor(() => expect(screen.queryByTestId('inspector-mask')).not.toBeInTheDocument());

    await user.keyboard('{Control>}k{/Control}');
    await waitFor(() => expect(screen.getByTestId('command-palette')).toBeInTheDocument());
    await user.type(screen.getByTestId('palette-input'), 'getOwners');
    await waitFor(() => expect(screen.getByTestId('palette-symbol-1')).toBeInTheDocument());
    await user.click(screen.getByTestId('palette-symbol-1'));
    await waitFor(() => expect(screen.getByTestId('inspector-mask')).toBeInTheDocument());
    expect(screen.getByTestId('inspector')).toHaveClass('translate-x-0');
  });
});

describe('tickets 13+16 (QA-04 / QA-07): URL is the single source of truth', () => {
  afterEach(() => {
    window.history.replaceState(null, '', '/');
  });

  const urlTruthRoutes: RepoSymbol[] = [
    {
      id: 951,
      repoId: 'repo-1',
      kind: 'route',
      name: 'getOwners',
      filePath: 'urltruth13/OwnerController.java',
      lineStart: 12,
      lineEnd: 15,
      signature: null,
      calls: null,
      displayPath: '/api/owners'
    }
  ];

  it('back to a repo-less URL deselects the repo, resets the inspector and closes the drawer', async () => {
    const client = makeClient({
      listSymbols: vi.fn().mockResolvedValue(urlTruthRoutes),
      getFileRaw: vi.fn().mockResolvedValue('class OwnerController {}')
    });
    const user = userEvent.setup();
    window.history.replaceState(null, '', '/');
    render(<App client={client} />);
    await selectRepo(user);

    // Load a file into the inspector, then switch to the Diff tab (pushes
    // ?repo=repo-1&mode=diff via replaceState on top of the selection entry).
    await waitFor(() => expect(screen.getByTestId('route-item')).toBeInTheDocument());
    await user.click(screen.getByTestId('route-item'));
    await waitFor(() => expect(screen.getByTestId('inspector-mask')).toBeInTheDocument());
    await user.click(screen.getByTestId('tab-delta'));
    await waitFor(() => expect(window.location.search).toContain('mode=diff'));

    // QA-04 repro: back to the repo-less history entry.
    window.history.back();
    await waitFor(() => expect(window.location.search).toBe(''));

    // URL truth: selection cleared, main area back to the guide/empty state,
    // inspector holding no slice of the previous repo, drawer closed.
    expect(screen.getByTestId('repo-select')).toHaveValue('');
    await waitFor(() => expect(screen.getByTestId('empty-state')).toBeInTheDocument());
    expect(screen.getByTestId('inspector-file')).toHaveTextContent('No file open');
    expect(screen.queryByTestId('inspector-mask')).not.toBeInTheDocument();

    // Ticket 13 acceptance: forward re-loads the repo and restores the tab.
    window.history.forward();
    await waitFor(() => expect(window.location.search).toContain('repo=repo-1'));
    expect(screen.getByTestId('repo-select')).toHaveValue('repo-1');
    await waitFor(() => expect(screen.getByTestId('architecture-delta')).toBeInTheDocument());
    expect(screen.getByTestId('tab-delta')).toHaveAttribute('aria-pressed', 'true');
    // The restored repo still shows no stale inspector content.
    expect(screen.getByTestId('inspector-file')).toHaveTextContent('No file open');
  });

  it('repo-less ?mode=diff deep link: topo stays highlighted while the guide renders, mode is kept, and selecting a repo applies it', async () => {
    window.history.replaceState(null, '', '/?mode=diff');
    const user = userEvent.setup();
    render(<App client={makeClient()} />);
    await waitFor(() => expect(screen.getByTestId('repo-select')).toBeInTheDocument());

    // Ticket 16 (QA-07): highlight must match content — topo, not delta.
    expect(screen.getByTestId('empty-state')).toBeInTheDocument();
    expect(screen.getByTestId('tab-topo')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('tab-delta')).toHaveAttribute('aria-pressed', 'false');
    // URL keeps the mode param (no error, no silent drop before a repo exists).
    expect(window.location.search).toContain('mode=diff');

    // Selecting a repo makes the pending mode take effect.
    await user.selectOptions(screen.getByTestId('repo-select'), 'repo-1');
    await waitFor(() => expect(screen.getByTestId('architecture-delta')).toBeInTheDocument());
    expect(screen.getByTestId('tab-delta')).toHaveAttribute('aria-pressed', 'true');
  });

  it('?mode=chat cold load lands on the chat view and normalizes the URL to incident', async () => {
    window.history.replaceState(null, '', '/?repo=repo-1&mode=chat');
    render(<App client={makeClient()} />);
    await waitFor(() => expect(screen.getByTestId('chat-view')).toBeInTheDocument());
    // Alias normalization is established behavior (maintainer ruling): the
    // shared viewFromMode map accepts chat, the URL converges to incident.
    await waitFor(() => expect(window.location.search).toContain('mode=incident'));
    expect(screen.getByTestId('tab-chat')).toHaveAttribute('aria-pressed', 'true');
  });
});
