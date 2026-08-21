import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SourceTraceDrawer } from './SourceTraceDrawer';
import type { Anchor } from '../types';

const anchors: Anchor[] = [
  { file: 'src/main/java/OwnerController.java', line: 42, symbol: 'OwnerController' },
  { file: 'src/main/java/OwnerRepository.java', line: 12, symbol: 'findByLastName' }
];

describe('SourceTraceDrawer', () => {
  it('renders one code card per anchor with file:line and symbol', () => {
    render(<SourceTraceDrawer anchors={anchors} />);
    expect(screen.getByTestId('source-trace-drawer')).toBeInTheDocument();
    expect(screen.getByText(/OwnerController\.java/)).toBeInTheDocument();
    expect(screen.getByText('L42')).toBeInTheDocument();
    expect(screen.getByText('OwnerController')).toBeInTheDocument();
  });

  it('routes a card click through onNavigate', async () => {
    const onNavigate = vi.fn();
    const user = userEvent.setup();
    render(<SourceTraceDrawer anchors={anchors} onNavigate={onNavigate} />);
    await user.click(screen.getByTestId('anchor-card-1'));
    expect(onNavigate).toHaveBeenCalledWith('src/main/java/OwnerRepository.java', 12);
  });

  it('renders nothing for an empty anchor list', () => {
    render(<SourceTraceDrawer anchors={[]} />);
    expect(screen.queryByTestId('source-trace-drawer')).not.toBeInTheDocument();
  });
});