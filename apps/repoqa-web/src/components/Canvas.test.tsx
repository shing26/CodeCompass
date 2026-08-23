import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Canvas } from './Canvas';
import type { Repo } from '../types';

vi.mock('../client/mermaidRenderer', () => ({
  renderMermaid: vi.fn(async () => '<svg />')
}));

const readyRepo: Repo = {
  id: 'repo-1',
  name: 'petclinic',
  localPath: 'C:/projects/spring-petclinic',
  branch: 'main',
  status: 'ready',
  fileCount: 1,
  symbolCount: 1,
  createdAt: '2026-08-21T00:00:00.000Z',
  updatedAt: '2026-08-21T00:00:00.000Z'
};

function renderCanvas(props: Partial<Parameters<typeof Canvas>[0]> = {}) {
  return render(
    <Canvas
      repo={readyRepo}
      messages={[]}
      streaming={false}
      reconnecting={false}
      error={null}
      onSubmit={() => {}}
      onRetry={() => {}}
      {...props}
    />
  );
}

describe('Canvas offline UX (Issue 18)', () => {
  it('shows the offline-mode hint and guided input placeholder with a repo loaded', () => {
    renderCanvas();
    expect(screen.getByTestId('offline-hint')).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/createOwner 的调用链/)).toBeInTheDocument();
  });

  it('renders the pinned back-to-dashboard entry and invokes the callback', async () => {
    const user = userEvent.setup();
    const onBackToDashboard = vi.fn();
    renderCanvas({ onBackToDashboard });

    const back = screen.getByTestId('canvas-back-to-dashboard');
    expect(back).toBeInTheDocument();
    await user.click(back);
    expect(onBackToDashboard).toHaveBeenCalledTimes(1);
  });

  it('omits the pinned entry when no callback is given', () => {
    renderCanvas();
    expect(screen.queryByTestId('canvas-back-to-dashboard')).not.toBeInTheDocument();
  });

  it('does not show the hint before a repo is connected', () => {
    renderCanvas({ repo: null });
    expect(screen.queryByTestId('offline-hint')).not.toBeInTheDocument();
  });
});