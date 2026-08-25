import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PrivacyPill } from './PrivacyPill';

describe('PrivacyPill (Sprint 1)', () => {
  it('shows the pure-local deterministic state when no LLM is configured', () => {
    render(<PrivacyPill mode="none" />);
    const pill = screen.getByTestId('privacy-pill');
    expect(pill).toHaveTextContent('纯本地确定性');
    expect(pill.querySelector('.bg-emerald-500')).toBeInTheDocument();
  });

  it('shows the local model state without a host label', () => {
    render(<PrivacyPill mode="local" host="127.0.0.1" />);
    const pill = screen.getByTestId('privacy-pill');
    expect(pill).toHaveTextContent('本地模型');
    expect(pill).not.toHaveTextContent('127.0.0.1');
    expect(pill.querySelector('.bg-amber-500')).toBeInTheDocument();
  });

  it('shows the masked remote host next to the remote model label', () => {
    render(<PrivacyPill mode="remote" host="api.***.com" />);
    const pill = screen.getByTestId('privacy-pill');
    expect(pill).toHaveTextContent('远程模型');
    expect(pill).toHaveTextContent('api.***.com');
    expect(pill.querySelector('.bg-red-500')).toBeInTheDocument();
  });
});
