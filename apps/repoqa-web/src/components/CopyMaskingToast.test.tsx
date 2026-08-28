import { describe, expect, it, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { CopyMaskingToast } from './CopyMaskingToast';

describe('CopyMaskingToast (v0.7 issue 04)', () => {
  it('stays hidden until triggered', () => {
    render(<CopyMaskingToast trigger={0} />);
    expect(screen.queryByTestId('copy-masking-toast')).not.toBeInTheDocument();
  });

  it('discloses masking on copy and auto-dismisses', () => {
    vi.useFakeTimers();
    const { rerender } = render(<CopyMaskingToast trigger={0} />);
    rerender(<CopyMaskingToast trigger={Date.now()} />);

    const toast = screen.getByTestId('copy-masking-toast');
    expect(toast).toHaveTextContent('凭据已按 13 规则脱敏');

    act(() => {
      vi.advanceTimersByTime(2600);
    });
    expect(screen.queryByTestId('copy-masking-toast')).not.toBeInTheDocument();
    vi.useRealTimers();
  });
});
