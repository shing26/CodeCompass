import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QuickTours } from './QuickTours';
import type { RepoTour } from '../types';

const tour = (id: RepoTour['id'], title: string, description = ''): RepoTour => ({
  id,
  title,
  description,
  steps: [
    {
      step: `1. ${title}`,
      filePath: 'src/main/java/Step.java',
      lineNumber: 10,
      symbol: 'Step',
      kind: 'method'
    }
  ],
  mermaid: 'flowchart LR\n  A --> B'
});

const tours: RepoTour[] = [
  tour('auth-chain', 'Trace the auth filter chain', '从认证过滤器到受保护端点'),
  tour('main-flow', 'Follow the core business flow'),
  tour('error-handling', 'Where are exceptions handled?')
];

describe('QuickTours (issue 13 backend tours)', () => {
  it('shows the first tour as the recommended card and collapses the rest', () => {
    render(<QuickTours tours={tours} loading={false} error={null} onRetry={() => {}} onPlay={() => {}} />);
    expect(screen.getByTestId('tour-auth-chain')).toBeInTheDocument();
    expect(screen.getByTestId('tour-auth-chain')).toHaveTextContent('Trace the auth filter chain');
    expect(screen.queryByTestId('tour-main-flow')).not.toBeInTheDocument();
    expect(screen.getByTestId('more-tours-toggle')).toHaveTextContent('More Tours (2)');
  });

  it('expands hidden tours without showing a three-card row', async () => {
    const user = userEvent.setup();
    render(<QuickTours tours={tours} loading={false} error={null} onRetry={() => {}} onPlay={() => {}} />);
    expect(screen.queryByTestId('tour-main-flow')).not.toBeInTheDocument();
    await user.click(screen.getByTestId('more-tours-toggle'));
    expect(screen.getByTestId('tour-main-flow')).toBeInTheDocument();
    expect(screen.getByTestId('tour-error-handling')).toBeInTheDocument();
    expect(screen.getAllByTestId(/^tour-/)).toHaveLength(3);
  });

  it('starts playing the recommended tour with the full tour object', async () => {
    const onPlay = vi.fn();
    const user = userEvent.setup();
    render(<QuickTours tours={tours} loading={false} error={null} onRetry={() => {}} onPlay={onPlay} />);
    await user.click(screen.getByTestId('tour-auth-chain'));
    expect(onPlay).toHaveBeenCalledWith(tours[0]);
  });

  it('starts playing a tour from the expanded list', async () => {
    const onPlay = vi.fn();
    const user = userEvent.setup();
    render(<QuickTours tours={tours} loading={false} error={null} onRetry={() => {}} onPlay={onPlay} />);
    await user.click(screen.getByTestId('more-tours-toggle'));
    await user.click(screen.getByTestId('tour-main-flow'));
    expect(onPlay).toHaveBeenCalledWith(tours[1]);
  });

  it('shows a loading state while tours are fetched', () => {
    render(<QuickTours tours={[]} loading error={null} onRetry={() => {}} onPlay={() => {}} />);
    expect(screen.getByText(/Loading tours/)).toBeInTheDocument();
  });

  it('shows an error with a retry action when loading fails', async () => {
    const onRetry = vi.fn();
    const user = userEvent.setup();
    render(<QuickTours tours={[]} loading={false} error="boom" onRetry={onRetry} onPlay={() => {}} />);
    expect(screen.getByText(/Tours 加载失败/)).toBeInTheDocument();
    await user.click(screen.getByTestId('tours-retry'));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('renders an empty note when the repo has no tours', () => {
    render(<QuickTours tours={[]} loading={false} error={null} onRetry={() => {}} onPlay={() => {}} />);
    expect(screen.getByText('No tours available.')).toBeInTheDocument();
  });
});