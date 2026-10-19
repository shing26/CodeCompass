import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TopApiBlock } from './TopApiBlock';
import type { TopApiEntry } from '../../types';

/**
 * R5-13 — an empty Top-API list is a deterministic fact, so it gets a
 * deterministic explanation instead of a bare dash. The copy must not guess a
 * cause: it names the registration forms the engine recognizes and leaves the
 * "why" to the reader.
 */
describe('TopApiBlock empty state (R5-13)', () => {
  it('explains a deterministic empty list instead of rendering a dash', () => {
    render(<TopApiBlock apis={[]} onTrace={vi.fn()} />);
    const empty = screen.getByTestId('top-apis-empty');
    expect(empty).toHaveTextContent('没有解析到 HTTP 入口');
    expect(empty).toHaveTextContent('Spring');
    expect(empty).toHaveTextContent('路由注册');
    expect(screen.queryByText('—')).not.toBeInTheDocument();
  });

  it('keeps rendering entries when the list is not empty', () => {
    const api: TopApiEntry = {
      name: 'GET /owners',
      controller: 'OwnerController',
      filePath: 'src/OwnerController.java',
      lineStart: 10,
      depth: 2,
      hops: ['listOwners', 'findAll']
    };
    render(<TopApiBlock apis={[api]} onTrace={vi.fn()} />);
    expect(screen.getByTestId('top-apis')).toHaveTextContent('GET /owners');
    expect(screen.queryByTestId('top-apis-empty')).not.toBeInTheDocument();
  });
});
