/**
 * v1.2 票 02 — 体检面数据面：五桶渲染 / Inspector 跳转 / testOnly 徽章 /
 * 红线文案（v0.21：不出现「可安全删除/死代码」）/ 精度态势逐字段固定断言。
 * 票 01 的四态骨架（未选库 / 索引中 / error / 空态）继续钉住。
 */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ScanHealthView } from './ScanHealthView';
import type { PrecisionSummary, Repo, RepoChunkRow, ScanResult } from '../types';
import type { RepoQAClient } from '../client/RepoQAClient';

const readyRepo: Repo = {
  id: 'r1',
  name: 'demo',
  localPath: 'D:/demo',
  branch: 'main',
  status: 'ready',
  fileCount: 10,
  symbolCount: 100,
  createdAt: '2026-09-29T00:00:00Z',
  updatedAt: '2026-09-29T00:00:00Z'
};

const scanFixture: ScanResult = {
  schemaVersion: 1,
  repoId: 'r1',
  repoName: 'demo',
  cockpitDeepLink: 'http://127.0.0.1:43110/?repo=r1',
  buckets: [
    {
      id: 'orphanedPublic',
      title: 'Orphaned public code (zero static callers)',
      nextAction: 'x',
      total: 2,
      wiredExcluded: 5,
      items: [
        { symbol: 'lonelyHelper', kind: 'method', filePath: 'src/a.ts', line: 3, detail: 'no static callers' },
        { symbol: 'testOnlyThing', kind: 'method', filePath: 'src/b.ts', line: 9, detail: 'callers are all tests', testOnly: true }
      ]
    },
    {
      id: 'hubs',
      title: 'Change-impact hubs (highest PageRank)',
      nextAction: 'x',
      total: 1,
      items: [{ symbol: 'hubEntry', kind: 'method', filePath: 'src/c.ts', line: 1, detail: 'PageRank 0.42' }]
    },
    { id: 'oversized', title: 'Oversized methods (>=150 lines)', nextAction: 'x', total: 0, items: [] },
    { id: 'deepChains', title: 'Deep call chains', nextAction: 'x', total: 0, items: [] },
    { id: 'oversizedFiles', title: 'Oversized files (>=600 lines)', nextAction: 'x', total: 0, items: [] }
  ]
};

// 与 scripts/precision/ratchet-baseline.json 的字段族固定对照（后端测试另证端点
// 逐字段直读该文件；此处固定断言渲染层把它们原样展示）。
const precisionFixture: PrecisionSummary = {
  available: true,
  baseline: {
    metric_direction: 'inverse',
    sampling: 'top-n',
    samples: {
      self: {
        commit: '5700bbd',
        symbolCount: 1960,
        orphanTotal: 236,
        ratio: 0.12040816326530612,
        recordedAt: '2026-09-20T05:03:11.011Z'
      }
    }
  }
};

function makeClient(scan: ScanResult | null, precision: PrecisionSummary = precisionFixture) {
  return {
    getScan: vi.fn().mockResolvedValue(scan),
    getPrecisionSummary: vi.fn().mockResolvedValue(precision)
  } as unknown as RepoQAClient;
}

function renderView(
  repo: Repo | null,
  scan: ScanResult | null,
  precision?: PrecisionSummary,
  onNavigate: (file: string, line: number) => void = () => {}
) {
  render(
    <ScanHealthView
      repo={repo}
      client={makeClient(scan, precision)}
      onNavigate={onNavigate}
    />
  );
}

describe('ScanHealthView 骨架四态（v1.2 票 01，票 02 保留）', () => {
  it('no repo → 选库引导态', () => {
    renderView(null, null);
    expect(screen.getByTestId('scan-health')).toHaveTextContent('先在上方选择一个仓库');
  });

  it.each(['indexing', 'cloning', 'parsing'] as const)('%s → 索引进行中态', (status) => {
    renderView({ ...readyRepo, status }, null);
    expect(screen.getByTestId('scan-health')).toHaveTextContent('索引完成后即可体检');
  });

  it('error repo → 重新索引引导', () => {
    renderView({ ...readyRepo, status: 'error' }, null);
    expect(screen.getByTestId('scan-health')).toHaveTextContent('索引异常');
    expect(screen.getByTestId('scan-health')).toHaveTextContent('重新索引');
  });
});

describe('ScanHealthView 数据面（v1.2 票 02）', () => {
  it('renders the five buckets with Chinese display labels and totals', async () => {
    renderView(readyRepo, scanFixture);
    for (const id of ['orphanedPublic', 'hubs', 'oversized', 'deepChains', 'oversizedFiles']) {
      expect(await screen.findByTestId(`scan-bucket-${id}`)).toBeInTheDocument();
    }
    expect(screen.getByTestId('scan-bucket-orphanedPublic')).toHaveTextContent('零静态调用者');
    expect(screen.getByTestId('scan-bucket-total-orphanedPublic')).toHaveTextContent('2');
    expect(screen.getByTestId('scan-bucket-total-oversized')).toHaveTextContent('0');
    expect(screen.getByTestId('scan-bucket-oversized')).toHaveTextContent('本桶无候选');
    // 外部装配排除数是事实披露，不是「死代码」结论
    expect(screen.getByTestId('scan-wired-excluded')).toHaveTextContent('另有 5 个零调用符号已按规则排除');
  });

  it('clicking a candidate navigates the Inspector with file and line', async () => {
    const onNavigate = vi.fn();
    const user = userEvent.setup();
    renderView(readyRepo, scanFixture, precisionFixture, onNavigate);
    const nodes = await screen.findAllByTestId('scan-item-node');
    await user.click(nodes[0]);
    expect(onNavigate).toHaveBeenCalledWith('src/a.ts', 3);
  });

  it('marks test-only callers with the dedicated badge', async () => {
    renderView(readyRepo, scanFixture);
    await screen.findByTestId('scan-bucket-orphanedPublic');
    const badge = screen.getByTestId('scan-test-only');
    expect(badge).toHaveTextContent('仅测试调用');
    expect(screen.getByText('testOnlyThing')).toBeInTheDocument();
  });

  it('copy red line: never claims deletability (v0.21 红线)', async () => {
    const { container } = render(
      <ScanHealthView repo={readyRepo} client={makeClient(scanFixture)} onNavigate={() => {}} />
    );
    await screen.findByTestId('scan-bucket-orphanedPublic');
    expect(container.textContent).not.toContain('可安全删除');
    expect(container.textContent).not.toContain('死代码');
    expect(screen.getByTestId('scan-redline')).toHaveTextContent('不代表可删除');
  });

  it('precision block renders baseline fields verbatim (固定断言，同 ratchet-baseline.json 字段)', async () => {
    renderView(readyRepo, scanFixture);
    await screen.findByTestId('scan-bucket-orphanedPublic');
    expect(screen.getByTestId('precision-ratio')).toHaveTextContent('12.0%');
    expect(screen.getByTestId('precision-ratio')).toHaveTextContent('236 / 1960');
    expect(screen.getByTestId('precision-commit')).toHaveTextContent('5700bbd');
    expect(screen.getByTestId('precision-meta')).toHaveTextContent('反向');
    expect(screen.getByTestId('precision-meta')).toHaveTextContent('top-n');
  });

  it('precision unavailable degrades honestly with the reason', async () => {
    renderView(readyRepo, scanFixture, {
      available: false,
      reason: 'ratchet-baseline.json 未在运行目录附近找到（该视图仅在仓库内运行时可用）'
    });
    await screen.findByTestId('scan-bucket-orphanedPublic');
    expect(screen.getByTestId('precision-unavailable')).toHaveTextContent('仅在仓库内运行时可用');
  });

  it('loading state shows while the scan request is in flight', async () => {
    const client = {
      getScan: vi.fn(() => new Promise((resolve) => setTimeout(() => resolve(scanFixture), 50))),
      getPrecisionSummary: vi.fn().mockResolvedValue(precisionFixture)
    } as unknown as RepoQAClient;
    render(<ScanHealthView repo={readyRepo} client={client} onNavigate={() => {}} />);
    expect(screen.getByTestId('scan-loading')).toHaveTextContent('正在扫描符号图谱');
    await waitFor(() => expect(screen.getByTestId('scan-bucket-orphanedPublic')).toBeInTheDocument());
    expect(screen.queryByTestId('scan-loading')).not.toBeInTheDocument();
  });
});

describe('ScanHealthView 检索分区（v1.2 票 06）', () => {
  const hitRows: RepoChunkRow[] = [
    {
      id: 1,
      repoId: 'r1',
      chunkType: 'docstring',
      content: '守护进程重启时会重放 WAL；密钥 [REDACTED AWS KEY] 只读。',
      filePath: 'src/daemon.ts',
      lineStart: 12
    },
    {
      id: 2,
      repoId: 'r1',
      chunkType: 'readme',
      content: '第二段说明文本',
      filePath: 'docs/ops.md',
      lineStart: 3
    }
  ];

  function clientWithSearch(searchChunks: ReturnType<typeof vi.fn>) {
    return {
      getScan: vi.fn().mockResolvedValue(scanFixture),
      getPrecisionSummary: vi.fn().mockResolvedValue(precisionFixture),
      searchChunks
    } as unknown as RepoQAClient;
  }

  it('renders chunk hits with type badge, anchor and masked content as-is', async () => {
    const searchChunks = vi.fn().mockResolvedValue(hitRows);
    const user = userEvent.setup();
    render(
      <ScanHealthView repo={readyRepo} client={clientWithSearch(searchChunks)} onNavigate={() => {}} />
    );
    await screen.findByTestId('scan-bucket-orphanedPublic');

    await user.type(screen.getByTestId('scan-search-input'), '重启');
    const rows = await screen.findAllByTestId('scan-search-hit');
    expect(rows).toHaveLength(2);
    expect(searchChunks).toHaveBeenCalledWith('r1', '重启');
    // 掩码占位符原样透传（入库前已掩码，展示层零二次处理）
    expect(rows[0].textContent).toContain('[REDACTED AWS KEY]');
    expect(rows[0].textContent).toContain('src/daemon.ts:12');
  });

  it('clicking a hit navigates the Inspector with file and line', async () => {
    const onNavigate = vi.fn();
    const user = userEvent.setup();
    render(
      <ScanHealthView
        repo={readyRepo}
        client={clientWithSearch(vi.fn().mockResolvedValue(hitRows))}
        onNavigate={onNavigate}
      />
    );
    await screen.findByTestId('scan-bucket-orphanedPublic');
    await user.type(screen.getByTestId('scan-search-input'), '重启');
    const nodes = await screen.findAllByTestId('scan-search-hit-node');
    fireEvent.click(nodes[0]);
    expect(onNavigate).toHaveBeenCalledWith('src/daemon.ts', 12);
  });

  it('no hits shows the honest empty state; a 1-char query never queries (debounced ≥2)', async () => {
    const searchChunks = vi.fn().mockResolvedValue([]);
    const user = userEvent.setup();
    render(
      <ScanHealthView repo={readyRepo} client={clientWithSearch(searchChunks)} onNavigate={() => {}} />
    );
    await screen.findByTestId('scan-bucket-orphanedPublic');

    await user.type(screen.getByTestId('scan-search-input'), 'x');
    await new Promise((resolve) => setTimeout(resolve, 400)); // 越过防抖窗
    expect(searchChunks).not.toHaveBeenCalled();

    await user.type(screen.getByTestId('scan-search-input'), 'y');
    await waitFor(() => expect(searchChunks).toHaveBeenCalledWith('r1', 'xy'));
    expect(await screen.findByTestId('scan-search-empty')).toHaveTextContent('无命中');
  });

  it('a failed search shows a distinct error state, never masquerades as 无命中 (v1.2 收口 评审 P2)', async () => {
    const searchChunks = vi.fn().mockRejectedValue(new Error('boom'));
    const user = userEvent.setup();
    render(
      <ScanHealthView repo={readyRepo} client={clientWithSearch(searchChunks)} onNavigate={() => {}} />
    );
    await screen.findByTestId('scan-bucket-orphanedPublic');
    await user.type(screen.getByTestId('scan-search-input'), '重试');
    expect(await screen.findByTestId('scan-search-error')).toHaveTextContent('检索失败');
    expect(screen.queryByTestId('scan-search-empty')).not.toBeInTheDocument();
  });

  it('copy red line: the retrieval section never says 语义检索 (v1.1 票 07 边界表述)', async () => {
    const { container } = render(
      <ScanHealthView
        repo={readyRepo}
        client={clientWithSearch(vi.fn().mockResolvedValue(hitRows))}
        onNavigate={() => {}}
      />
    );
    await screen.findByTestId('scan-search');
    expect(container.textContent).not.toContain('语义检索');
    expect(container.textContent).toContain('关键词/子串匹配');
    expect(container.textContent).toContain('不看语义相似度');
  });
});
