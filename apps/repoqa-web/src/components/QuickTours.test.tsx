import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QuickTours } from './QuickTours';
import type { RepoSymbol } from '../types';

const symbol = (over: Partial<RepoSymbol>): RepoSymbol => ({
  id: 1,
  repo_id: 'repo-1',
  kind: 'route',
  name: '/owners',
  file_path: 'src/main/java/org/springframework/samples/petclinic/OwnerController.java',
  line_start: 42,
  line_end: 60,
  signature: null,
  calls: null,
  ...over
});

describe('QuickTours', () => {
  it('shows exactly one Recommended Flow derived from the first route', () => {
    render(
      <QuickTours
        repoName="petclinic"
        symbols={[symbol({ name: '/owners' }), symbol({ id: 2, name: '/vets' })]}
        onTour={() => {}}
      />
    );
    expect(screen.getByTestId('tour-recommended')).toBeInTheDocument();
    expect(screen.getByText(/Trace \/owners/)).toBeInTheDocument();
    expect(screen.getByTestId('more-tours-toggle')).toHaveTextContent('More Tours (2)');
  });

  it('expands hidden tours without showing a three-card row', async () => {
    const user = userEvent.setup();
    render(
      <QuickTours
        repoName="petclinic"
        symbols={[symbol({ name: '/owners' })]}
        onTour={() => {}}
      />
    );
    expect(screen.queryByTestId('tour-arch')).not.toBeInTheDocument();
    await user.click(screen.getByTestId('more-tours-toggle'));
    expect(screen.getByTestId('tour-arch')).toBeInTheDocument();
    expect(screen.getAllByTestId(/^tour-/)).toHaveLength(3);
  });

  it('submits the derived question when the recommended tour is clicked', async () => {
    const onTour = vi.fn();
    const user = userEvent.setup();
    render(
      <QuickTours repoName="petclinic" symbols={[symbol({ name: '/owners' })]} onTour={onTour} />
    );
    await user.click(screen.getByTestId('tour-recommended'));
    expect(onTour).toHaveBeenCalledWith('/owners 经过了哪些类');
  });
});