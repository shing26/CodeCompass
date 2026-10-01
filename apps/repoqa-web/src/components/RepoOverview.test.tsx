import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RepoOverview } from './RepoOverview';
import type { DomainRadarResult, Repo, RepoDashboard } from '../types';
import type { RepoQAClient } from '../client/RepoQAClient';

const readyRepo: Repo = {
  id: 'repo-1',
  name: 'petclinic',
  localPath: 'C:/projects/spring-petclinic',
  branch: 'main',
  status: 'ready',
  fileCount: 40,
  symbolCount: 2109,
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z'
};

const dashboard: RepoDashboard = {
  repoId: 'repo-1',
  repoName: 'petclinic',
  techStack: { summary: [], highlights: ['Spring Boot', 'Maven'] },
  config: { topology: [], maskedValues: true },
  scale: {
    routes: 42,
    services: 18,
    repositories: 12,
    advices: 3,
    plainClasses: 120,
    interfaces: 31,
    methods: 980,
    fields: 640,
    configKeys: 26,
    files: 187
  },
  topApis: Array.from({ length: 7 }, (_, i) => ({
    name: `handler${i}`,
    controller: 'OrderController',
    filePath: 'src/OrderController.ts',
    lineStart: 10 + i,
    depth: 3,
    hops: [`handler${i}`, 'service', 'mapper']
  }))
};

const radar: DomainRadarResult = {
  schemaVersion: 1,
  repoId: 'repo-1',
  matchedAnchors: [],
  hubNodes: [
    { symbol: 'OrderService', inDegree: 118, outDegree: 94, pagerank: 0.213, role: 'SERVICE' },
    { symbol: 'AuthFilter', inDegree: 64, outDegree: 71, pagerank: 0.147, role: 'SERVICE' },
    { symbol: 'OrderMapper', inDegree: 40, outDegree: 3, pagerank: 0.098, role: 'DATA_MAPPER' },
    { symbol: 'OrderController', inDegree: 2, outDegree: 41, pagerank: 0.081, role: 'CONTROLLER' },
    { symbol: 'OwnerRepository', inDegree: 22, outDegree: 1, pagerank: 0.05, role: 'SERVICE' },
    { symbol: 'LegacyAdapter', inDegree: 9, outDegree: 2, pagerank: 0.02, role: 'SERVICE' }
  ],
  topApis: [],
  persistenceEntities: ['Order', 'Owner', 'Visit']
};

function makeClient(over: Partial<RepoQAClient> = {}) {
  return { radar: vi.fn().mockResolvedValue(radar), ...over } as unknown as RepoQAClient;
}

function renderOverview(props: Partial<Parameters<typeof RepoOverview>[0]> = {}) {
  const onTraceApi = vi.fn();
  const onTraceSymbol = vi.fn();
  const onRetryDashboard = vi.fn();
  render(
    <RepoOverview
      repo={readyRepo}
      client={makeClient()}
      dashboard={dashboard}
      dashboardLoading={false}
      dashboardError={null}
      onRetryDashboard={onRetryDashboard}
      onTraceApi={onTraceApi}
      onTraceSymbol={onTraceSymbol}
      {...props}
    />
  );
  return { onTraceApi, onTraceSymbol, onRetryDashboard };
}

describe('v1.2 票 08（R4-7）拓扑概览层', () => {
  it('answers「这仓库是什么」from static facts: stack highlights + scale + hubs', async () => {
    renderOverview();
    expect(screen.getByTestId('repo-overview')).toBeInTheDocument();
    expect(screen.getByText('这仓库是什么')).toBeInTheDocument();
    expect(screen.getAllByTestId('highlight-badge')[0]).toHaveTextContent('Spring Boot');
    // 规模来自 dashboard（App 的 useDashboard 全局数据，本组件不重复请求）
    expect(screen.getByTestId('scale-routes')).toHaveTextContent('42');
    expect(screen.getByTestId('scale-methods')).toHaveTextContent('980');
    // 枢纽来自 radar：显示确定性度数，不显示 PageRank 小数
    const hubs = await screen.findByTestId('hub-nodes');
    expect(hubs).toHaveTextContent('OrderService');
    expect(hubs).toHaveTextContent('被调 118 · 调用 94');
    expect(hubs).toHaveTextContent('数据映射');
    expect(hubs).not.toHaveTextContent('0.2130');
  });

  it('caps hubs at five and states how many entries the Top API list hides', async () => {
    renderOverview();
    const hubs = await screen.findByTestId('hub-nodes');
    expect(hubs.querySelectorAll('[data-testid="hub-entry"]')).toHaveLength(5);
    expect(screen.getByTestId('top-apis').querySelectorAll('[data-testid="api-entry"]')).toHaveLength(5);
    expect(screen.getByTestId('top-apis-more')).toHaveTextContent('另有 2 个入口未展示');
  });

  it('reports the persistence layer size as a plain count', async () => {
    renderOverview();
    expect(await screen.findByTestId('persistence-line')).toHaveTextContent('持久层：3 个仓储 / 映射 / 模型类');
  });

  it('drills into a hub symbol through the shared call-chain entry', async () => {
    const user = userEvent.setup();
    const { onTraceSymbol, onTraceApi } = renderOverview();
    const hubs = await screen.findByTestId('hub-nodes');
    await user.click(hubs.querySelectorAll('[data-testid="hub-entry"]')[0] as HTMLElement);
    expect(onTraceSymbol).toHaveBeenCalledWith('OrderService');

    await user.click(screen.getAllByTestId('api-entry')[0]);
    expect(onTraceApi).toHaveBeenCalledWith(dashboard.topApis[0]);
  });

  it('keeps scale and entries usable when only the radar call fails', async () => {
    renderOverview({ client: makeClient({ radar: vi.fn().mockRejectedValue(new Error('boom')) }) });
    await waitFor(() => expect(screen.getByTestId('overview-hub-retry')).toBeInTheDocument());
    expect(screen.getByTestId('scale-routes')).toHaveTextContent('42');
    expect(screen.getByTestId('top-apis')).toBeInTheDocument();
  });

  it('keeps the hubs when only the dashboard call fails (two independent sources)', async () => {
    renderOverview({ dashboard: null, dashboardError: 'dashboard failed: 500' });
    await waitFor(() => expect(screen.getByTestId('hub-nodes')).toBeInTheDocument());
    expect(screen.getByTestId('hub-nodes')).toHaveTextContent('OrderService');
    expect(screen.queryByTestId('scale-routes')).not.toBeInTheDocument();
  });

  it('surfaces a dashboard failure with a retry instead of an empty stage', async () => {
    const { onRetryDashboard } = renderOverview({ dashboard: null, dashboardError: 'dashboard failed: 500' });
    expect(screen.getByTestId('overview-retry')).toBeInTheDocument();
    expect(screen.getByText('dashboard failed: 500')).toBeInTheDocument();
    // radar 仍在后台 resolve——等它落地再收尾，避免 act 警告掩盖真实断言。
    await waitFor(() => expect(screen.getByTestId('hub-nodes')).toBeInTheDocument());
    expect(onRetryDashboard).toBeDefined();
  });

  it('renders nothing for a repo that is not indexed yet (no empty shell)', () => {
    renderOverview({ repo: { ...readyRepo, status: 'indexing' } });
    expect(screen.queryByTestId('repo-overview')).not.toBeInTheDocument();
  });
});
