import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CommandPalette } from './CommandPalette';
import type { RepoQAClient } from '../client/RepoQAClient';
import type { DomainRadarResult } from '../types';

const mockRadarResult: DomainRadarResult = {
  schemaVersion: 1,
  repoId: 'repo-1',
  matchedAnchors: [
    {
      symbol: 'handleLike',
      type: 'SERVICE',
      relevanceScore: 85,
      filePath: 'src/main/java/PostService.java',
      line: 42,
      matchedBy: 'identifier',
      inDegree: 3,
      outDegree: 2
    }
  ],
  hubNodes: [],
  topApis: [],
  persistenceEntities: []
};

function makeClient(): RepoQAClient {
  return {
    radar: vi.fn().mockResolvedValue(mockRadarResult)
  } as unknown as RepoQAClient;
}

describe('CommandPalette (v0.11 Stage 3)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('renders nothing when closed', () => {
    const { container } = render(
      <CommandPalette
        open={false}
        client={makeClient()}
        repoId="repo-1"
        onClose={() => {}}
        onSelectSymbol={() => {}}
      />
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders the input and built-in commands when open', () => {
    render(
      <CommandPalette
        open={true}
        client={makeClient()}
        repoId="repo-1"
        onClose={() => {}}
        onSelectSymbol={() => {}}
      />
    );
    expect(screen.getByTestId('palette-input')).toBeInTheDocument();
    expect(screen.getByTestId('palette-cmd-toggle-theme')).toBeInTheDocument();
    expect(screen.getByTestId('palette-cmd-back-dashboard')).toBeInTheDocument();
  });

  it('searches symbols after 300ms debounce', async () => {
    const client = makeClient();
    const user = userEvent.setup();
    render(
      <CommandPalette
        open={true}
        client={client}
        repoId="repo-1"
        onClose={() => {}}
        onSelectSymbol={() => {}}
      />
    );
    await user.type(screen.getByTestId('palette-input'), 'handleLike');
    // Should not have called radar yet (debounce).
    expect(client.radar).not.toHaveBeenCalled();
    // Wait for the debounce to fire.
    await waitFor(() => expect(client.radar).toHaveBeenCalledWith('repo-1', 'handleLike'));
    await waitFor(() => expect(screen.getByTestId('palette-symbol-1')).toBeInTheDocument());
    expect(screen.getByTestId('palette-symbol-name')).toHaveTextContent('handleLike');
    expect(screen.getByTestId('palette-symbol-path')).toHaveTextContent('src/main/java/PostService.java');
  });

  it('calls onSelectSymbol and onClose when a symbol is chosen', async () => {
    const client = makeClient();
    const onSelectSymbol = vi.fn();
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(
      <CommandPalette
        open={true}
        client={client}
        repoId="repo-1"
        onClose={onClose}
        onSelectSymbol={onSelectSymbol}
      />
    );
    await user.type(screen.getByTestId('palette-input'), 'handleLike');
    await waitFor(() => expect(screen.getByTestId('palette-symbol-1')).toBeInTheDocument());
    await user.click(screen.getByTestId('palette-symbol-1'));
    expect(onSelectSymbol).toHaveBeenCalledWith('handleLike', 'src/main/java/PostService.java', 42);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('calls onToggleTheme and onClose when the toggle-theme command is clicked', async () => {
    const onToggleTheme = vi.fn();
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(
      <CommandPalette
        open={true}
        client={makeClient()}
        repoId="repo-1"
        onClose={onClose}
        onSelectSymbol={() => {}}
        onToggleTheme={onToggleTheme}
      />
    );
    await user.click(screen.getByTestId('palette-cmd-toggle-theme'));
    expect(onToggleTheme).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('shows empty state when no results match the query', async () => {
    const client = makeClient();
    vi.mocked(client.radar).mockResolvedValue({
      ...mockRadarResult,
      matchedAnchors: []
    });
    const user = userEvent.setup();
    render(
      <CommandPalette
        open={true}
        client={client}
        repoId="repo-1"
        onClose={() => {}}
        onSelectSymbol={() => {}}
      />
    );
    await user.type(screen.getByTestId('palette-input'), 'zzz');
    await waitFor(() => expect(screen.getByTestId('palette-empty')).toBeInTheDocument());
  });

  it('closes on Escape', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(
      <CommandPalette
        open={true}
        client={makeClient()}
        repoId="repo-1"
        onClose={onClose}
        onSelectSymbol={() => {}}
      />
    );
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
