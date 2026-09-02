import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { EvidenceCard } from './EvidenceCard';
import { parseEvidenceFromAnswer } from './evidence';
import type { Anchor } from '../types';

// The answer text below mirrors the deterministic backend layout of
// buildIncidentStaticAnswer (repoqa-worker.ts): matched frames, an unresolved
// third-party frame, diagnose chain steps and a config key.
const STATIC_ANSWER = [
  '崩溃点定位到 DemoService.greet（src/main/java/com/demo/DemoService.java:4）。',
  '',
  '堆栈解析: 1 frames parsed, 1 resolved, 1 unmatched.',
  '',
  '已解析帧（VERIFIED）:',
  '- com.demo.DemoService.greet -> greet @ src/main/java/com/demo/DemoService.java:4 [VERIFIED]',
  '',
  '未解析帧（BREAK，不猜测）:',
  '- at com.acme.thirdparty.Missing.run(Missing.java:99) -> BREAK (no physical counterpart in the index)',
  '',
  '诊断链路（静态穿透）:',
  '- [VERIFIED] SERVICE greet @ src/main/java/com/demo/DemoService.java:4',
  '- [SUSPECT] SERVICE collect @ src/main/java/com/demo/MetricsCollector.java:8',
  '',
  '相关配置键:',
  '- server.port @ src/main/resources/application.yml:3'
].join('\n');

const COMMIT: Anchor[] = [
  { file: 'src/main/java/com/demo/DemoService.java', line: 4, symbol: 'greet', commit: 'a1b2c3d4e5f67890' }
];

describe('parseEvidenceFromAnswer (Issue 23)', () => {
  it('parses VERIFIED/BREAK/SUSPECT assertions and skips narrative lines', () => {
    const items = parseEvidenceFromAnswer(STATIC_ANSWER, []);
    expect(items.map((row) => row.status)).toEqual([
      'VERIFIED', // matched frame
      'BREAK', // unresolved frame
      'SUSPECT', // diagnose dead-end
      'VERIFIED' // config key
    ]);
    expect(items[0].label).toBe('greet');
    expect(items[0].location).toBe('DemoService.java:4');
    expect(items[0].file).toBe('src/main/java/com/demo/DemoService.java');
    expect(items[1].label).toContain('Missing.run');
    expect(items[1].location).toBe('Missing.java:99');
    expect(items[2].location).toBe('MetricsCollector.java:8');
    expect(items[3].label).toBe('server.port');
  });

  it('attaches the anchor commit to matching rows and appends extra anchors', () => {
    const items = parseEvidenceFromAnswer(STATIC_ANSWER, [
      ...COMMIT,
      { file: 'src/main/java/com/demo/OrderRepository.java', line: 20, symbol: 'saveOrder', commit: 'deadbeef000' }
    ]);
    const greet = items.find((row) => row.label === 'greet');
    expect(greet?.commit).toBe('a1b2c3d4e5f67890');
    const extra = items.find((row) => row.label === 'saveOrder');
    expect(extra?.status).toBe('VERIFIED');
    expect(extra?.commit).toBe('deadbeef000');
  });

  it('maps the diagnose BROKEN hop to the BREAK badge', () => {
    const items = parseEvidenceFromAnswer(
      '- [BROKEN] DATA_MAPPER saveOrder @ src/main/java/com/demo/OrderRepository.java:20',
      []
    );
    expect(items).toHaveLength(1);
    expect(items[0].status).toBe('BREAK');
    expect(items[0].label).toBe('saveOrder');
  });

  it('returns no rows for narrative-only answers (never invents assertions)', () => {
    const items = parseEvidenceFromAnswer('堆栈中的帧未能在索引中定位到物理符号。', []);
    expect(items).toHaveLength(0);
  });
});

describe('EvidenceCard (Issue 23)', () => {
  it('renders the three badge types with file:line and commit chips', () => {
    const evidence = parseEvidenceFromAnswer(STATIC_ANSWER, COMMIT);
    render(<EvidenceCard evidence={evidence} />);

    const statuses = screen.getAllByTestId(/^evidence-status-/).map((el) => el.textContent);
    expect(statuses).toContain('VERIFIED');
    expect(statuses).toContain('BREAK');
    expect(statuses).toContain('SUSPECT');
    expect(screen.getByText('DemoService.java:4')).toBeInTheDocument();
    expect(screen.getByText('Missing.java:99')).toBeInTheDocument();
    expect(screen.getByText('a1b2c3d')).toBeInTheDocument(); // commit short hash
    expect(screen.getByTestId('evidence-card')).toBeInTheDocument();
  });

  it('renders nothing when there is no evidence', () => {
    render(<EvidenceCard evidence={[]} />);
    expect(screen.queryByTestId('evidence-card')).not.toBeInTheDocument();
  });

  it('clicking a VERIFIED row navigates to the Inspector slice', () => {
    const onNavigate = vi.fn();
    const evidence = parseEvidenceFromAnswer(STATIC_ANSWER, COMMIT);
    render(<EvidenceCard evidence={evidence} onNavigate={onNavigate} />);

    fireEvent.click(screen.getByText('greet'));
    expect(onNavigate).toHaveBeenCalledWith(
      'src/main/java/com/demo/DemoService.java',
      4,
      undefined,
      'greet'
    );
  });

  it('BREAK rows are not clickable (no physical counterpart to open)', () => {
    const onNavigate = vi.fn();
    const evidence = parseEvidenceFromAnswer(STATIC_ANSWER, []);
    render(<EvidenceCard evidence={evidence} onNavigate={onNavigate} />);

    fireEvent.click(screen.getByText(/Missing\.run/));
    expect(onNavigate).not.toHaveBeenCalled();
  });
});
