import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CiGateView } from './CiGateView';
import type { Repo, RepoDashboard } from '../types';

const repo: Repo = {
  id: 'repo-1',
  name: 'petclinic',
  localPath: 'C:/projects/spring-petclinic',
  branch: 'main',
  status: 'ready',
  fileCount: 120,
  symbolCount: 840,
  createdAt: '2026-08-21T00:00:00.000Z',
  updatedAt: '2026-08-21T00:00:00.000Z'
};

const dashboard: RepoDashboard = {
  repoId: 'repo-1',
  repoName: 'petclinic',
  techStack: { summary: [], highlights: ['Spring Boot'] },
  config: { topology: [], maskedValues: true },
  scale: {
    routes: 3,
    services: 1,
    repositories: 1,
    advices: 0,
    plainClasses: 2,
    interfaces: 1,
    methods: 8,
    fields: 4,
    configKeys: 2,
    files: 6
  },
  topApis: []
};

describe('CiGateView (Issue 31)', () => {
  it('renders policy controls, baseline stats and a generated command', async () => {
    const user = userEvent.setup();
    render(<CiGateView repo={repo} dashboard={dashboard} />);

    expect(screen.getByTestId('ci-gate')).toBeInTheDocument();
    expect(screen.getByTestId('ci-baseline')).toHaveTextContent('3 Routes');
    expect(screen.getByTestId('ci-command')).toHaveTextContent(
      'npx codecompass pr-summary origin/main HEAD "C:/projects/spring-petclinic" --max-affected-routes 10 --fail-on-break'
    );

    await user.click(screen.getByTestId('ci-fail-on-auth-impact'));
    fireEvent.change(screen.getByTestId('ci-max-routes'), { target: { value: '5' } });
    expect(screen.getByTestId('ci-command')).toHaveTextContent('--max-affected-routes 5');
    expect(screen.getByTestId('ci-command')).toHaveTextContent('--fail-on-auth-impact');
  });

  it('shows an empty state without a repo', () => {
    render(<CiGateView repo={null} dashboard={null} />);
    expect(screen.getByTestId('ci-gate-empty')).toBeInTheDocument();
  });
});
