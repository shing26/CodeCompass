import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { IncidentView } from './IncidentView';
import type { ChatMessage } from '../hooks/useChat';
import type { EvidenceItem } from '../types';

vi.mock('../client/mermaidRenderer', () => ({
  renderMermaid: vi.fn(async (_uid: string, code: string) => {
    if (code.includes('INVALID')) throw new Error('parse error');
    return [
      '<svg id="diagram">',
      '<g class="node"><text class="label">OrderService</text></g>',
      '</svg>'
    ].join('');
  })
}));

const evidence: EvidenceItem[] = [
  {
    status: 'VERIFIED',
    label: 'findById',
    file: 'src/main/java/com/demo/OrderService.java',
    line: 11,
    location: 'OrderService.java:11',
    commit: '942ae5a'
  },
  {
    status: 'BREAK',
    label: 'com.demo.ThirdParty-helper',
    file: 'com.demo.ThirdParty',
    line: 0,
    location: 'ThirdParty:0'
  }
];

function assistantMessage(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: 'a1',
    role: 'assistant',
    text: '业务概述\n\n证据\n\n结论',
    status: 'done',
    evidence,
    provenance: 'llm',
    usage: { input: 100, output: 50, total: 150, source: 'provider' },
    diagram: 'graph LR\n  A[A] --> B[B]\nclick A "code://src/A.java#5"',
    ...overrides
  } as ChatMessage;
}

beforeEach(() => {
  cleanup();
});

describe('IncidentView — copilot workbench integration (Issue 23)', () => {
  it('renders the answer diagram, evidence card and provenance meta', async () => {
    render(
      <IncidentView
        repoName="sample-java"
        messages={[assistantMessage()]}
        streaming={false}
        reconnecting={false}
        recovered={false}
        error={null}
        onSubmit={vi.fn()}
      />
    );
    expect(await screen.findByTestId('mermaid-diagram')).toBeTruthy();
    expect(screen.getByTestId('evidence-card')).toBeTruthy();
    expect(screen.getByTestId('incident-provenance').textContent).toBe('模型推理');
    expect(screen.getByTestId('incident-usage').textContent).toContain('150 tokens');
  });

  it('offers workbench actions on the last assistant message only', () => {
    const older = assistantMessage({ id: 'a0', text: '更早的回答' });
    render(
      <IncidentView
        repoName="sample-java"
        messages={[older, assistantMessage()]}
        streaming={false}
        reconnecting={false}
        recovered={false}
        error={null}
        symbols={[]}
        onSubmit={vi.fn()}
        onNavigate={vi.fn()}
        onOpenInWorkbench={vi.fn()}
        onTraceCrash={vi.fn()}
      />
    );
    const actionBars = screen.getAllByTestId('incident-actions');
    expect(actionBars.length).toBe(1);
    // 追踪按钮取最新回答的第一条 VERIFIED 证据(崩溃点)
    expect(screen.getByTestId('incident-trace-crash').textContent).toContain('findById');
  });

  it('traces the crash symbol and opens the workbench through App callbacks', async () => {
    const user = userEvent.setup();
    const onTraceCrash = vi.fn();
    const onOpenInWorkbench = vi.fn();
    render(
      <IncidentView
        repoName="sample-java"
        messages={[assistantMessage()]}
        streaming={false}
        reconnecting={false}
        recovered={false}
        error={null}
        onSubmit={vi.fn()}
        onTraceCrash={onTraceCrash}
        onOpenInWorkbench={onOpenInWorkbench}
      />
    );
    await user.click(screen.getByTestId('incident-trace-crash'));
    expect(onTraceCrash).toHaveBeenCalledWith('findById', 'src/main/java/com/demo/OrderService.java');
    await user.click(screen.getByTestId('incident-open-workbench'));
    expect(onOpenInWorkbench).toHaveBeenCalledTimes(1);
  });

  it('hides the trace action when the answer has no VERIFIED crash point', () => {
    render(
      <IncidentView
        repoName="sample-java"
        messages={[assistantMessage({ evidence: [evidence[1]] })]}
        streaming={false}
        reconnecting={false}
        recovered={false}
        error={null}
        onSubmit={vi.fn()}
        onTraceCrash={vi.fn()}
        onOpenInWorkbench={vi.fn()}
      />
    );
    expect(screen.queryByTestId('incident-trace-crash')).toBeNull();
    expect(screen.getByTestId('incident-open-workbench')).toBeTruthy();
  });
});
