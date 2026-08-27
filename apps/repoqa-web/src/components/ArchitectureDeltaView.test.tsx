import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ArchitectureDeltaView } from './ArchitectureDeltaView';
import type {
  ArchitectureDeltaReport,
  Repo
} from '../types';

const readyRepo: Repo = {
  id: 'repo-1',
  name: 'petclinic',
  localPath: 'C:/petclinic',
  branch: 'main',
  status: 'ready',
  fileCount: 47,
  symbolCount: 344,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z'
};

const delta: ArchitectureDeltaReport = {
  schemaVersion: 1,
  base: 'origin/main',
  head: 'HEAD',
  addedRoutes: [
    {
      name: 'GET /api/reports',
      file: 'src/api/reports.ts',
      lineStart: 4,
      lineEnd: 4,
      kind: 'route',
      displayPath: '/api/reports'
    }
  ],
  removedRoutes: [
    {
      name: 'GET /api/health',
      file: 'src/app.py',
      lineStart: 3,
      lineEnd: 3,
      kind: 'route',
      displayPath: '/api/health'
    }
  ],
  brokenEdges: [
    {
      from: { file: 'src/api/client.ts', method: 'loadOrders', line: 3 },
      to: { file: 'src/api/client.ts', method: 'missingThing', line: 3 }
    }
  ],
  impactedApis: [
    {
      routeSymbol: {
        name: 'listOrders',
        file: 'src/main/java/com/demo/OrdersController.java',
        lineStart: 5,
        lineEnd: 5,
        kind: 'route',
        parentType: 'OrdersController',
        displayPath: '/api/orders'
      },
      affectedBySymbols: ['findAll'],
      riskLevel: 'HIGH'
    }
  ],
  mermaid: '```mermaid\ngraph TD\n```'
};

describe('ArchitectureDeltaView (v0.6.0)', () => {
  it('runs the delta analysis and renders added/removed/broken/impact sections', async () => {
    const user = userEvent.setup();
    const getArchitectureDelta = vi.fn().mockResolvedValue(delta);
    render(
      <ArchitectureDeltaView
        repo={readyRepo}
        client={{ getArchitectureDelta }}
      />
    );

    await user.click(screen.getByTestId('delta-run'));
    await waitFor(() =>
      expect(getArchitectureDelta).toHaveBeenCalledWith(
        'repo-1',
        'origin/main',
        'HEAD'
      )
    );

    expect(screen.getByTestId('delta-added')).toHaveTextContent('1');
    expect(screen.getByTestId('delta-removed')).toHaveTextContent('1');
    expect(screen.getByTestId('delta-broken')).toHaveTextContent('1');
    expect(screen.getByTestId('delta-impact')).toHaveTextContent('1');
    expect(screen.getAllByText(/\/api\/reports/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/\/api\/health/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/missingThing/).length).toBeGreaterThan(0);
    expect(screen.getByText('HIGH')).toBeInTheDocument();
    expect(screen.getByTestId('delta-markdown')).toHaveTextContent('Architecture Delta');
  });

  it('shows an empty state before a repo is selected', () => {
    render(
      <ArchitectureDeltaView
        repo={null}
        client={{ getArchitectureDelta: vi.fn() }}
      />
    );
    expect(screen.getByTestId('architecture-delta-empty')).toBeInTheDocument();
  });
});
