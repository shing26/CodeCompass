/**
 * 票 04 — Agent 活动视图：读数渲染 / 失败样本脱敏展示 / 空态 / 错误态 / 刷新。
 */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AgentActivityView } from './AgentActivityView';
import type { McpAuditSummary } from '../types';
import type { RepoQAClient } from '../client/RepoQAClient';

const fullSummary: McpAuditSummary = {
  logsPresent: true,
  window: { files: 2, sinceTs: '2026-11-01T01:00:00Z' },
  totals: { calls: 12, ok: 11, failed: 1, okRate: 11 / 12 },
  byTool: [
    { tool: 'codecompass_scan', calls: 8, ok: 8, failed: 0, okRate: 1, p50Ms: 100, p95Ms: 300 },
    { tool: 'codecompass_trace_call_chain', calls: 4, ok: 3, failed: 1, okRate: 0.75, p50Ms: 40, p95Ms: 60 }
  ],
  recentFailures: [
    { ts: '2026-11-01T02:00:02Z', tool: 'codecompass_trace_call_chain', repoId: 'r1', error: 'boom with ***' }
  ],
  recentCalls: [
    { ts: '2026-11-01T02:00:02Z', tool: 'codecompass_trace_call_chain', repoId: 'r1', ok: false, durationMs: 60 },
    { ts: '2026-11-01T02:00:00Z', tool: 'codecompass_scan', repoId: 'r1', ok: true, durationMs: 120 }
  ]
};

function makeClient(overrides: Partial<Record<'fetchAuditSummary', unknown>> = {}): RepoQAClient {
  return {
    fetchAuditSummary: vi.fn().mockResolvedValue(fullSummary),
    ...overrides
  } as unknown as RepoQAClient;
}

describe('AgentActivityView (票 04)', () => {
  it('renders totals, per-tool latencies and the failure sample', async () => {
    const client = makeClient();
    render(<AgentActivityView client={client} />);
    await waitFor(() => expect(screen.getByTestId('audit-totals')).toBeDefined());
    expect(client.fetchAuditSummary).toHaveBeenCalledTimes(1);
    expect(screen.getByText('12')).toBeDefined();
    expect(screen.getByText('91.7%')).toBeDefined();
    // 工具名同时出现在 byTool 表与最近调用流：两处都在即通过。
    expect(screen.getAllByText('codecompass_scan').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('p95')).toBeDefined();
    expect(screen.getByText('300ms')).toBeDefined();
    // 失败样本按服务端返回原文展示（服务端已脱敏，视图不二次加工）。
    expect(screen.getByText('boom with ***')).toBeDefined();
  });

  it('shows the no-logs empty state instead of tables', async () => {
    const client = makeClient({
      fetchAuditSummary: vi.fn().mockResolvedValue({ ...fullSummary, logsPresent: false })
    });
    render(<AgentActivityView client={client} />);
    await waitFor(() => expect(screen.getByTestId('audit-empty')).toBeDefined());
    expect(screen.queryByTestId('audit-bytool')).toBeNull();
  });

  it('renders the error state and recovers on refresh', async () => {
    const fetchAuditSummary = vi
      .fn<() => Promise<McpAuditSummary>>()
      .mockRejectedValueOnce(new Error('fetchAuditSummary failed: 500'))
      .mockResolvedValueOnce(fullSummary);
    const client = { fetchAuditSummary } as unknown as RepoQAClient;
    render(<AgentActivityView client={client} />);
    await waitFor(() => expect(screen.getByTestId('audit-error')).toBeDefined());
    expect(screen.getByText('fetchAuditSummary failed: 500')).toBeDefined();
    fireEvent.click(screen.getByTestId('audit-refresh'));
    await waitFor(() => expect(screen.getByTestId('audit-totals')).toBeDefined());
    expect(fetchAuditSummary).toHaveBeenCalledTimes(2);
  });
});
