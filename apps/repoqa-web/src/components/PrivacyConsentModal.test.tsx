import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { PrivacyConsentModal } from './PrivacyConsentModal';

describe('PrivacyConsentModal (Sprint 1)', () => {
  it('states the masked host and confirms the in-memory consent', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(
      <PrivacyConsentModal host="api.***.com" onConfirm={onConfirm} onCancel={vi.fn()} />
    );
    expect(screen.getByTestId('consent-modal')).toHaveTextContent('api.***.com');
    expect(screen.getByTestId('consent-modal')).toHaveTextContent('当前页面会话内生效');

    await user.click(screen.getByTestId('consent-confirm'));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('cancels without confirming', async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    render(<PrivacyConsentModal host="api.***.com" onConfirm={vi.fn()} onCancel={onCancel} />);

    await user.click(screen.getByTestId('consent-cancel'));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
