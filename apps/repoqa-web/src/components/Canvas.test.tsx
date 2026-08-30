import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Canvas } from './Canvas';
import type { ChatMessage } from '../hooks/useChat';
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
      recovered={false}
      error={null}
      totalUsage={{ input: 0, output: 0, total: 0, source: 'estimate' }}
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

  it('defaults free questions to the call-chain mode (Round 2)', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    renderCanvas({ onSubmit });
    expect(screen.getByTestId('chat-mode-call-chain')).toHaveAttribute(
      'aria-pressed',
      'true'
    );

    await user.type(screen.getByTestId('chat-input'), 'createOwner 的调用链');
    await user.click(screen.getByTestId('chat-submit'));
    expect(onSubmit).toHaveBeenCalledWith('createOwner 的调用链', 'call-chain');
  });

  it('switches free questions to the architecture mode (Round 2)', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    renderCanvas({ onSubmit });
    await user.click(screen.getByTestId('chat-mode-architecture'));
    expect(screen.getByTestId('chat-mode-architecture')).toHaveAttribute(
      'aria-pressed',
      'true'
    );

    await user.type(screen.getByTestId('chat-input'), 'owner 相关架构');
    await user.click(screen.getByTestId('chat-submit'));
    expect(onSubmit).toHaveBeenCalledWith('owner 相关架构', 'architecture');
  });
});

describe('Canvas topology flow cards (Issue 31)', () => {
  it('renders Caller/Target/Callee cards from the latest trace anchors', () => {
    const messages: ChatMessage[] = [
      {
        id: 'msg-1',
        role: 'assistant',
        text: '',
        status: 'done',
        anchors: [
          { file: 'src/main/java/OrderController.java', line: 10, symbol: 'listOrders' },
          { file: 'src/main/java/OrderService.java', line: 20, symbol: 'findOrders' },
          { file: 'src/main/resources/OrderMapper.xml', line: 30, symbol: 'findAll' }
        ]
      }
    ];
    renderCanvas({ messages });

    expect(screen.getAllByTestId('flow-card')).toHaveLength(3);
    expect(screen.getByTestId('selected-node')).toHaveTextContent('listOrders');
    expect(screen.getByTestId('affected-count')).toHaveTextContent('3 波及');
    expect(screen.getAllByTestId('flow-arrow')).toHaveLength(2);
    expect(screen.getByText('Caller')).toBeInTheDocument();
    expect(screen.getByText('Callee')).toBeInTheDocument();
  });
});


describe('Canvas Top API focus flash (v0.7 issue 12)', () => {
  it('flashes the start flow card once when a trace lands', () => {
    const messages: ChatMessage[] = [
      {
        id: 'msg-focus',
        role: 'assistant',
        text: '',
        status: 'done',
        anchors: [
          { file: 'src/main/java/OrderController.java', line: 10, symbol: 'listOrders' },
          { file: 'src/main/java/OrderService.java', line: 20, symbol: 'findOrders' }
        ]
      }
    ];
    renderCanvas({ messages });
    const cards = screen.getAllByTestId('flow-card');
    expect(cards[0].className).toContain('focus-flash');
    expect(cards[1].className).not.toContain('focus-flash');
  });
});

describe('Canvas live trace strip (v0.11 Stage 4)', () => {
  it('hides the strip when the latest message has no trace steps', () => {
    const messages: ChatMessage[] = [
      {
        id: 'msg-plain',
        role: 'assistant',
        text: 'done',
        status: 'done',
        anchors: [{ file: 'A.java', line: 1, symbol: 'a' }]
      }
    ];
    renderCanvas({ messages });
    expect(screen.queryByTestId('trace-strip')).not.toBeInTheDocument();
  });

  it('steps through trace steps and navigates the Inspector', async () => {
    const user = userEvent.setup();
    const onNavigate = vi.fn();
    const messages: ChatMessage[] = [
      {
        id: 'msg-trace',
        role: 'assistant',
        text: 'done',
        status: 'done',
        anchors: [{ file: 'A.java', line: 1, symbol: 'a' }],
        traceSteps: [
          { file: 'src/main/java/Controller.java', line: 10, symbol: 'listOrders', status: 'VERIFIED' },
          {
            file: 'src/main/java/Service.java',
            line: 20,
            symbol: 'findOrders',
            status: 'VERIFIED',
            httpMethod: 'GET'
          },
          { file: 'src/main/java/Mapper.java', line: 30, symbol: 'findAll', status: 'BROKEN' }
        ]
      }
    ];
    renderCanvas({ messages, onNavigate });

    const strip = screen.getByTestId('trace-strip');
    expect(strip).toBeInTheDocument();
    // Starts at step 1 of 3.
    expect(screen.getByTestId('trace-step-label')).toHaveTextContent('Step 1/3');

    await user.click(screen.getByTestId('trace-step-next'));
    expect(screen.getByTestId('trace-step-label')).toHaveTextContent('Step 2/3');
    expect(screen.getByTestId('trace-step-label')).toHaveTextContent('GET');
    expect(onNavigate).toHaveBeenLastCalledWith('src/main/java/Service.java', 20, undefined, 'findOrders');

    await user.click(screen.getByTestId('trace-step-next'));
    expect(screen.getByTestId('trace-step-label')).toHaveTextContent('Step 3/3');
    expect(screen.getByTestId('trace-step-label')).toHaveTextContent('BROKEN');
    expect(onNavigate).toHaveBeenLastCalledWith('src/main/java/Mapper.java', 30, undefined, 'findAll');

    // The Next button is disabled at the final step.
    expect(screen.getByTestId('trace-step-next')).toBeDisabled();

    await user.click(screen.getByTestId('trace-step-prev'));
    expect(screen.getByTestId('trace-step-label')).toHaveTextContent('Step 2/3');
  });
});
