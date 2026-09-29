/**
 * v1.2 票 01 — 体检面骨架的三态：未选库 / 索引中 / 就绪空态（数据面随票 02）。
 * 文案红线断言顺带钉住：scan 呈现不出现「可安全删除」类语义判断（v0.21 红线）。
 */
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ScanHealthView } from './ScanHealthView';
import type { Repo } from '../types';

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

describe('ScanHealthView (v1.2 票 01 骨架)', () => {
  it('no repo → 选库引导态', () => {
    render(<ScanHealthView repo={null} />);
    expect(screen.getByTestId('scan-health')).toHaveTextContent('先在上方选择一个仓库');
  });

  it('ready repo → 空态：数据面随票 02 接入的诚实占位', () => {
    render(<ScanHealthView repo={readyRepo} />);
    expect(screen.getByTestId('scan-health')).toHaveTextContent('体检面即将开放');
    expect(screen.getByTestId('scan-health')).toHaveTextContent('零静态调用者');
  });

  it.each(['indexing', 'cloning', 'parsing'] as const)('%s → 索引进行中态', (status) => {
    render(<ScanHealthView repo={{ ...readyRepo, status }} />);
    expect(screen.getByTestId('scan-health')).toHaveTextContent('索引完成后即可体检');
  });

  it('error repo → 重新索引引导', () => {
    render(<ScanHealthView repo={{ ...readyRepo, status: 'error' }} />);
    expect(screen.getByTestId('scan-health')).toHaveTextContent('索引异常');
    expect(screen.getByTestId('scan-health')).toHaveTextContent('重新索引');
  });

  it('copy red line: scan states never claim deletability (v0.21 红线)', () => {
    const { container } = render(<ScanHealthView repo={readyRepo} />);
    expect(container.textContent).not.toContain('可安全删除');
    expect(container.textContent).not.toContain('死代码');
  });
});
