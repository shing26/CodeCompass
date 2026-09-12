import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AskDock } from './AskDock';

describe('AskDock (v0.27-UI ticket 02)', () => {
  it('submits the trimmed question via Enter and clears the input for the next ask', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<AskDock repoName="petclinic" onSubmit={onSubmit} />);

    await user.type(screen.getByTestId('ask-dock-input'), '  这个仓库哪里最值得改？  ');
    await user.keyboard('{Enter}');

    expect(onSubmit).toHaveBeenCalledWith('这个仓库哪里最值得改？');
    expect(screen.getByTestId('ask-dock-input')).toHaveValue('');
  });

  it('send button mirrors the empty-guard: disabled until there is a question', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<AskDock repoName="petclinic" onSubmit={onSubmit} />);

    expect(screen.getByTestId('ask-dock-send')).toBeDisabled();
    await user.type(screen.getByTestId('ask-dock-input'), 'NPE at Demo.run');
    expect(screen.getByTestId('ask-dock-send')).toBeEnabled();
    await user.click(screen.getByTestId('ask-dock-send'));
    expect(onSubmit).toHaveBeenCalledWith('NPE at Demo.run');
  });

  it('anchors the read-side positioning sentence and the repo it applies to', () => {
    render(<AskDock repoName="petclinic" onSubmit={vi.fn()} />);
    // 「问现状」动词前置（A01 定位句的物理落点）+ placeholder 点名架构问答与当前库
    expect(screen.getByTestId('ask-dock')).toHaveTextContent('问现状');
    expect(screen.getByTestId('ask-dock-input')).toHaveAttribute(
      'placeholder',
      '问点什么…（架构问答 · petclinic）'
    );
  });
});
