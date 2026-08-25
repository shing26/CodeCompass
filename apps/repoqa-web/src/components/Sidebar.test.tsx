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

function renderSidebar(
  onNavigate?: (file: string, line: number) => void,
  customSymbols: RepoSymbol[] = symbols
) {
  return render(
    <Sidebar
      repoName="petclinic"
      symbols={customSymbols}
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

describe('Sidebar instant search (Issue 24)', () => {
  const searchableSymbols: RepoSymbol[] = [
    ...symbols,
    symbol({
      id: 4,
      kind: 'route',
      name: '/pets',
      displayPath: '/pets',
      filePath: 'src/main/java/com/demo/PetController.java',
      lineStart: 10,
      lineEnd: 14
    }),
    symbol({
      id: 5,
      kind: 'method',
      name: 'listPets',
      filePath: 'src/main/java/com/demo/PetController.java',
      lineStart: 11,
      lineEnd: 13
    })
  ];

  it('filters routes and symbols while auto-expanding matched nodes', async () => {
    const user = userEvent.setup();
    renderSidebar(undefined, searchableSymbols);

    await user.type(screen.getByTestId('sidebar-search'), 'owner');

    expect(screen.getByText('/owners')).toBeInTheDocument();
    expect(screen.queryByText('/pets')).not.toBeInTheDocument();
    // The symbol tree is expanded by the search, without clicking the toggle.
    expect(screen.getByText('createOwner')).toBeInTheDocument();
    expect(screen.queryByText('listPets')).not.toBeInTheDocument();
  });

  it('filters symbols by parent type and file path', async () => {
    const user = userEvent.setup();
    renderSidebar(undefined, searchableSymbols);

    await user.type(screen.getByTestId('sidebar-search'), 'OwnerController');

    expect(screen.getByText('OwnerController')).toBeInTheDocument();
    expect(screen.getByText('createOwner')).toBeInTheDocument();
    expect(screen.queryByText('listPets')).not.toBeInTheDocument();
  });

  it('shows an empty state for unmatched searches and restores on clear', async () => {
    const user = userEvent.setup();
    renderSidebar(undefined, searchableSymbols);

    await user.type(screen.getByTestId('sidebar-search'), 'zzzz-no-match');
    expect(screen.getByText('无匹配符号')).toBeInTheDocument();

    await user.clear(screen.getByTestId('sidebar-search'));
    expect(screen.getByText('2 files — expand to browse')).toBeInTheDocument();
  });
});

describe('Sidebar / shortcut (Sprint 2)', () => {
  it('focuses the search box from outside any text field', async () => {
    const user = userEvent.setup();
    renderSidebar();
    expect(screen.getByTestId('sidebar-search')).not.toHaveFocus();

    await user.keyboard('/');
    expect(screen.getByTestId('sidebar-search')).toHaveFocus();
  });

  it('lets / type normally when the search box already has focus', async () => {
    const user = userEvent.setup();
    renderSidebar();
    await user.click(screen.getByTestId('sidebar-search'));

    await user.keyboard('/');
    expect(screen.getByTestId('sidebar-search')).toHaveValue('/');
  });
});
