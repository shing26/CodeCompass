import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { StatusStepper } from './StatusStepper';

describe('StatusStepper (v0.6.0)', () => {
  it('renders nothing without progress', () => {
    const { container } = render(<StatusStepper progress={null} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders the four staged phases and the live percent', () => {
    render(
      <StatusStepper
        progress={{
          repoId: 'repo-1',
          phase: 'AST_EXTRACTION',
          phaseLabel: 'AST 提取',
          currentFile: 'src/App.java',
          processedFiles: 10,
          totalFiles: 131,
          percent: 15
        }}
      />
    );
    expect(screen.getByTestId('status-stepper')).toBeInTheDocument();
    expect(screen.getByTestId('status-step-DISCOVERY')).toBeInTheDocument();
    expect(screen.getByTestId('status-step-AST_EXTRACTION')).toBeInTheDocument();
    expect(screen.getByTestId('status-step-CROSS_LANG_BRIDGE')).toBeInTheDocument();
    expect(screen.getByTestId('status-step-FINALIZING')).toBeInTheDocument();
    expect(screen.getByTestId('status-progress')).toHaveAttribute('aria-valuenow', '15');
    expect(screen.getByTestId('status-current-file')).toHaveTextContent('src/App.java');
  });
});
