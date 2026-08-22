import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DashboardView } from './DashboardView';
import type { RepoDashboard } from '../types';

const dashboard: RepoDashboard = {
  repoId: 'repo-1',
  repoName: 'petclinic',
  techStack: {
    summary: [
      {
        category: 'framework',
        label: 'Framework',
        count: 2,
        items: [
          { name: 'spring-boot', category: 'framework', filePath: 'pom.xml', lineStart: 12 },
          { name: 'spring-web', category: 'framework', filePath: 'pom.xml', lineStart: 18 }
        ]
      },
      {
        category: 'security',
        label: 'Security',
        count: 1,
        items: [{ name: 'spring-security', category: 'security', filePath: 'pom.xml', lineStart: 25 }]
      }
    ],
    highlights: ['Spring Boot', 'Spring Security']
  },
  config: {
    topology: [
      {
        key: 'server.port',
        filePath: 'src/main/resources/application.yml',
        lineStart: 3,
        group: 'server',
        sensitive: false
      },
      {
        key: 'spring.datasource.password',
        filePath: 'src/main/resources/application.yml',
        lineStart: 11,
        group: 'datasource',
        sensitive: true
      }
    ],
    maskedValues: true
  },
  scale: {
    routes: 3,
    services: 2,
    repositories: 1,
    advices: 1,
    classes: 5,
    interfaces: 2,
    methods: 12,
    fields: 8,
    configKeys: 6,
    files: 9
  },
  topApis: [
    {
      name: 'listOrders',
      controller: 'OrderController',
      filePath: 'src/main/java/OrderController.java',
      lineStart: 24,
      depth: 3,
      hops: ['listOrders', 'findOrders', 'findAll']
    }
  ]
};

const noop = () => {};

describe('DashboardView (issue 13)', () => {
  it('renders highlights, tech stack, scale, config topology and top APIs', () => {
    render(
      <DashboardView
        repoName="petclinic"
        dashboard={dashboard}
        loading={false}
        error={null}
        onRetry={noop}
        onTrace={noop}
        onNavigate={noop}
        onOpenChat={noop}
      />
    );
    expect(screen.getByTestId('dashboard')).toBeInTheDocument();
    expect(screen.getAllByTestId('highlight-badge')).toHaveLength(2);
    expect(screen.getAllByTestId('tech-chip')).toHaveLength(3);
    expect(screen.getAllByTestId('tech-category')[1]).toHaveTextContent('Security');
    expect(screen.getByTestId('scale-routes')).toHaveTextContent('3');
    expect(screen.getByTestId('scale-methods')).toHaveTextContent('12');
    expect(screen.getAllByTestId('config-item')[0]).toBeInTheDocument();
    expect(screen.getByTestId('top-apis')).toHaveTextContent('listOrders');
    expect(screen.getByText('spring.datasource.password')).toBeInTheDocument();
    expect(screen.getByText('sensitive')).toBeInTheDocument();
    expect(screen.getByText('值已脱敏')).toBeInTheDocument();
  });

  it('navigates to source when a tech stack chip is clicked', async () => {
    const onNavigate = vi.fn();
    const user = userEvent.setup();
    render(
      <DashboardView
        repoName="petclinic"
        dashboard={dashboard}
        loading={false}
        error={null}
        onRetry={noop}
        onTrace={noop}
        onNavigate={onNavigate}
        onOpenChat={noop}
      />
    );
    await user.click(screen.getAllByTestId('tech-chip')[0]);
    expect(onNavigate).toHaveBeenCalledWith('pom.xml', 12);
  });

  it('navigates to source when a config topology key is clicked', async () => {
    const onNavigate = vi.fn();
    const user = userEvent.setup();
    render(
      <DashboardView
        repoName="petclinic"
        dashboard={dashboard}
        loading={false}
        error={null}
        onRetry={noop}
        onTrace={noop}
        onNavigate={onNavigate}
        onOpenChat={noop}
      />
    );
    await user.click(screen.getAllByTestId('config-item')[0]);
    expect(onNavigate).toHaveBeenCalledWith('src/main/resources/application.yml', 3);
  });

  it('starts a call-chain trace when a top API entry is clicked', async () => {
    const onTrace = vi.fn();
    const user = userEvent.setup();
    render(
      <DashboardView
        repoName="petclinic"
        dashboard={dashboard}
        loading={false}
        error={null}
        onRetry={noop}
        onTrace={onTrace}
        onNavigate={noop}
        onOpenChat={noop}
      />
    );
    await user.click(screen.getByTestId('api-entry'));
    expect(onTrace).toHaveBeenCalledWith('listOrders 的完整调用链是怎样的？');
  });

  it('opens the chat view from the 提问 button', async () => {
    const onOpenChat = vi.fn();
    const user = userEvent.setup();
    render(
      <DashboardView
        repoName="petclinic"
        dashboard={dashboard}
        loading={false}
        error={null}
        onRetry={noop}
        onTrace={noop}
        onNavigate={noop}
        onOpenChat={onOpenChat}
      />
    );
    await user.click(screen.getByTestId('open-chat'));
    expect(onOpenChat).toHaveBeenCalledTimes(1);
  });

  it('shows a loading state while the dashboard is being fetched', () => {
    render(
      <DashboardView
        repoName="petclinic"
        dashboard={null}
        loading
        error={null}
        onRetry={noop}
        onTrace={noop}
        onNavigate={noop}
        onOpenChat={noop}
      />
    );
    expect(screen.getByTestId('dashboard-loading')).toHaveTextContent('Loading dashboard…');
  });

  it('shows an error with a retry action when the fetch fails', async () => {
    const onRetry = vi.fn();
    const user = userEvent.setup();
    render(
      <DashboardView
        repoName="petclinic"
        dashboard={null}
        loading={false}
        error="dashboard failed"
        onRetry={onRetry}
        onTrace={noop}
        onNavigate={noop}
        onOpenChat={noop}
      />
    );
    expect(screen.getByTestId('dashboard-error')).toHaveTextContent('dashboard failed');
    await user.click(screen.getByTestId('dashboard-retry'));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});