// ChatView tests (v0.24.0 chat-merge): sessions, streaming, cite deep-links
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ChatView } from './ChatView';
import type { RepoQAClient, ChatTurnResult } from '../client/RepoQAClient';

function makeChatClient(overrides: Partial<RepoQAClient['chat']> = {}): RepoQAClient['chat'] {
  const defaults = {
    listSessions: vi.fn().mockResolvedValue([
      { id: 'chat-s1', repoId: 'repo-1', title: '会话 A', createdAt: '2026-09-07T00:00:00Z' }
    ]),
    createSession: vi
      .fn()
      .mockResolvedValue({ id: 'chat-s2', repoId: 'repo-1', title: '会话 B', createdAt: '' }),
    messages: vi.fn().mockResolvedValue([
      { id: 1, sessionId: 'chat-s1', role: 'user', content: '上一问', citations: null },
      {
        id: 2,
        sessionId: 'chat-s1',
        role: 'assistant',
        content: '结论 [cite: 1]',
        citations: JSON.stringify([
          { n: 1, tool: 'codecompass_diagnose', args: { repoId: 'repo-1', symbolOrMethod: 'OwnerRepository.findAll' }, ms: 3 }
        ])
      }
    ]),
    chatSend: vi.fn().mockResolvedValue({
      answer: '本轮结论 [cite: 1]',
      citations: [{ n: 1, tool: 'codecompass_scan', args: { repoId: 'repo-1' }, ms: 4 }],
      steps: 2,
      fallback: false
    }),
    switchModel: vi.fn().mockResolvedValue(undefined),
    modelInfo: vi.fn().mockResolvedValue({ profiles: ['default'], active: 'default', configured: true })
  };
  return { ...defaults, ...overrides } as unknown as RepoQAClient['chat'];
}

function renderChat(
  chatClientOverrides: Partial<RepoQAClient['chat']> = {},
  onSendImpl?: (message: string, handlers: { onDelta: (t: string) => void }) => Promise<ChatTurnResult>
) {
  const chatClient = makeChatClient(chatClientOverrides);
  const client = { chat: chatClient } as unknown as RepoQAClient;
  const onNavigate = vi.fn();
  render(
    <ChatView
      client={client}
      repoId="repo-1"
      repoName="petclinic"
      onNavigate={onNavigate}
      onBackToWorkbench={vi.fn()}
      onSend={
        onSendImpl ??
        (async (message, handlers) => {
          handlers.onDelta('流式前缀 ');
          return chatClient.chatSend('chat-s1', message, handlers);
        })
      }
    />
  );
  return { chatClient, onNavigate };
}

describe('ChatView (chat-merge Q4)', () => {
  it('renders persisted messages with clickable cite badges after opening a session', async () => {
    const user = userEvent.setup();
    const { onNavigate } = renderChat();
    await waitFor(() => expect(screen.getByText('会话 A')).toBeInTheDocument());
    await user.click(screen.getByText('会话 A'));
    await waitFor(() => expect(screen.getByText('上一问')).toBeInTheDocument());
    expect(screen.getByText('结论')).toBeInTheDocument();
    await user.click(screen.getByText('1', { selector: '.chat-cite' }));
    expect(screen.getByTestId('chat-cite-detail').textContent).toContain('codecompass_diagnose');
    await user.click(screen.getByText('在拓扑中查看 →'));
    expect(onNavigate).toHaveBeenCalledWith('OwnerRepository.findAll');
  });

  it('streams a new turn and swaps in the sanitized done.answer (QA-01 回写)', async () => {
    const user = userEvent.setup();
    const { chatClient } = renderChat(
      {},
      async (_message, handlers) => {
        handlers.onDelta('正在分析…（流式残片）');
        return { answer: '最终干净结论', citations: [], steps: 3, fallback: false };
      }
    );
    await waitFor(() => expect(screen.getByTestId('chat-new-session')).toBeInTheDocument());
    await user.click(screen.getByTestId('chat-new-session'));
    await user.type(screen.getByTestId('chat-question'), 'scan 一下');
    await user.click(screen.getByTestId('chat-send'));
    await waitFor(() => expect(screen.getByText('最终干净结论')).toBeInTheDocument());
    // R2-03 + QA-01：流式残片被净化后的 done.answer 回写覆盖；
    // onSend 直连替换（本测绕过 chatSend）——chatClient 仅断言未被旁路调用
    expect(screen.queryByText('正在分析…')).not.toBeInTheDocument();
    expect(chatClient.chatSend).not.toHaveBeenCalled();
  });

  it('creates a session from the sidebar button when none is active', async () => {
    const user = userEvent.setup();
    const chatClientOverrides: Partial<RepoQAClient['chat']> = {
      listSessions: vi.fn().mockResolvedValue([])
    };
    const { chatClient } = renderChat(chatClientOverrides);
    await waitFor(() => expect(screen.getByTestId('chat-new-session')).toBeInTheDocument());
    await user.click(screen.getByTestId('chat-new-session'));
    await waitFor(() => expect(chatClient.createSession).toHaveBeenCalledWith('repo-1'));
  });
});
