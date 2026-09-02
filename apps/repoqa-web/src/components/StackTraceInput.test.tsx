import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StackTraceInput } from './StackTraceInput';

function setup(streaming = false) {
  const onSubmit = vi.fn();
  const user = userEvent.setup();
  render(<StackTraceInput streaming={streaming} onSubmit={onSubmit} />);
  return { onSubmit, user };
}

describe('StackTraceInput (Issue 23)', () => {
  it('submits the question and the pasted stack via the button', async () => {
    const { onSubmit, user } = setup();
    await user.type(screen.getByTestId('incident-question'), '下单接口 500');
    await user.click(screen.getByTestId('incident-toggle-stack'));
    await user.type(screen.getByTestId('incident-stack'), 'java.lang.NullPointerException\n  at Demo.run(Demo.java:9)');
    await user.click(screen.getByTestId('incident-submit'));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith(
      '下单接口 500',
      'java.lang.NullPointerException\n  at Demo.run(Demo.java:9)'
    );
    // Inputs clear after a successful submit.
    expect(screen.getByTestId('incident-question')).toHaveValue('');
    expect(screen.getByTestId('incident-stack')).toHaveValue('');
  });

  it('submits with an undefined stack when only the symptom is typed', async () => {
    const { onSubmit, user } = setup();
    await user.type(screen.getByTestId('incident-question'), '服务随机 500');
    await user.click(screen.getByTestId('incident-submit'));
    expect(onSubmit).toHaveBeenCalledWith('服务随机 500', undefined);
  });

  it('submits on Enter in the question input', async () => {
    const { onSubmit, user } = setup();
    await user.type(screen.getByTestId('incident-question'), 'NPE 排查{enter}');
    expect(onSubmit).toHaveBeenCalledWith('NPE 排查', undefined);
  });

  it('does not submit while the IME composition is active (isComposing)', () => {
    const { onSubmit } = setup();
    const input = screen.getByTestId('incident-question');
    fireEvent.keyDown(input, { key: 'Enter', isComposing: true });
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('does not submit when Enter carries the legacy IME keyCode 229', () => {
    const { onSubmit } = setup();
    const input = screen.getByTestId('incident-question');
    fireEvent.keyDown(input, { key: 'Enter', keyCode: 229 });
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('does not submit an empty question', async () => {
    const { onSubmit, user } = setup();
    await user.click(screen.getByTestId('incident-submit'));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('disables the composer while streaming', async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(<StackTraceInput streaming onSubmit={onSubmit} />);
    expect(screen.getByTestId('incident-question')).toBeDisabled();
    expect(screen.getByTestId('incident-submit')).toBeDisabled();
    await user.click(screen.getByTestId('incident-submit'));
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
