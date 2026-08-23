import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Sidebar } from './Sidebar';
import type { RepoSymbol } from '../types';

vi.mock('../client/mermaidRenderer', () => ({
  renderMermaid: vi.fn(async () => '<svg />')
}));

function symbol(partial: Partial<RepoSymbol>): RepoSymbol {
  return {
    id: 0,
    repoId: 'repo-1',
    kind: 'method',
    name: 'noop',
    filePath: 'src/main/java/com/demo/App.java',
    lineStart: 10,
    lineEnd: 12,
    signature: null,
    calls: null,
    ...partial
  };
}

const symbols: RepoSymbol[] = [
  symbol({
    id: 1,
    kind: 'route',
    name: '/owners',
    displayPath: '/owners',
    filePath: 'src/main/java/com/demo/OwnerController.java',
    lineStart: 90,
    lineEnd: 95
  }),
  symbol({
    id: 2,
    kind: 'class',
    name: 'OwnerController',
    filePath: 'src/main/java/com/demo/OwnerController.java',
    lineStart: 14,
    lineEnd: 80
  }),
  symbol({
    id: 3,
    kind: 'method',
    name: 'createOwner',
    filePath: 'src/main/java/com/demo/OwnerController.java',
    lineStart: 30,
    lineEnd: 42
  })
];

function renderSidebar(onNavigate?: (file: string, line: number) => void) {
  return render(
    <Sidebar
      repoName="petclinic"
      symbols={symbols}
      loading={false}
      tours={[]}
      toursLoading={false}
      toursError={null}
      onRetryTours={() => {}}
      onPlayTour={() => {}}
      open
      onNavigate={onNavigate}
    />
  );
}

describe('Sidebar source browsing (Issue 18)', () => {
  it('opens a route item at its source line', async () => {
    const user = userEvent.setup();
    const onNavigate = vi.fn();
    renderSidebar(onNavigate);

    await user.click(screen.getAllByTestId('route-item')[0]);
    expect(onNavigate).toHaveBeenCalledWith('src/main/java/com/demo/OwnerController.java', 90);
  });

  it('opens a file, a type and a member symbol', async () => {
    const user = userEvent.setup();
    const onNavigate = vi.fn();
    renderSidebar(onNavigate);

    // Expand the symbol tree first.
    await user.click(screen.getByTestId('symbols-toggle'));

    await user.click(screen.getByTestId('symbol-file'));
    expect(onNavigate).toHaveBeenLastCalledWith('src/main/java/com/demo/OwnerController.java', 1);

    await user.click(screen.getByTestId('symbol-type'));
    expect(onNavigate).toHaveBeenLastCalledWith('src/main/java/com/demo/OwnerController.java', 14);

    await user.click(screen.getByTestId('symbol-member'));
    expect(onNavigate).toHaveBeenLastCalledWith('src/main/java/com/demo/OwnerController.java', 30);
  });

  it('member clicks do not bubble up to the file row', async () => {
    const user = userEvent.setup();
    const onNavigate = vi.fn();
    renderSidebar(onNavigate);
    await user.click(screen.getByTestId('symbols-toggle'));

    await user.click(screen.getByTestId('symbol-member'));
    // Only one call — the member's own handler, not the file row's.
    expect(onNavigate).toHaveBeenCalledTimes(1);
    expect(onNavigate).toHaveBeenCalledWith('src/main/java/com/demo/OwnerController.java', 30);
  });

  it('is a no-op without onNavigate', async () => {
    const user = userEvent.setup();
    renderSidebar(undefined);
    await user.click(screen.getByTestId('symbols-toggle'));
    await user.click(screen.getByTestId('symbol-member'));
    // renders without throwing
    expect(screen.getByTestId('sidebar')).toBeInTheDocument();
  });
});