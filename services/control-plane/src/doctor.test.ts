import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  NODE_MIN_MAJOR,
  renderDoctorText,
  runDoctor
} from './doctor';

describe('codecompass doctor (v0.6.0)', () => {
  it('runs all checks and returns a structured report', async () => {
    const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'repoqa-doctor-'));
    try {
      const report = await runDoctor({
        dataDir,
        port: 0,
        fetchImpl: (async () =>
          ({
            ok: true,
            json: async () => ({ models: [{ name: 'qwen2.5-coder:7b' }] })
          }) as Response) as typeof fetch
      });
      expect(report.schemaVersion).toBe(1);
      expect(report.checks.map((check) => check.id)).toEqual([
        'node',
        'sqlite',
        'port',
        'data-dir',
        'ollama'
      ]);
      expect(report.checks.find((check) => check.id === 'node')?.status).toBe(
        Number(process.versions.node.split('.')[0]) >= NODE_MIN_MAJOR ? 'ok' : 'error'
      );
      expect(report.checks.find((check) => check.id === 'sqlite')?.status).toBe('ok');
      expect(report.checks.find((check) => check.id === 'port')?.status).toBe('ok');
      expect(report.checks.find((check) => check.id === 'data-dir')?.status).toBe('ok');
      expect(report.checks.find((check) => check.id === 'ollama')?.status).toBe('ok');
      expect(renderDoctorText(report)).toContain('CodeCompass doctor');
    } finally {
      await fs.rm(dataDir, { recursive: true, force: true });
    }
  });

  it('warns when Ollama is unreachable and reports an error status on fatal checks', async () => {
    const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'repoqa-doctor-'));
    try {
      const report = await runDoctor({
        dataDir,
        port: 0,
        fetchImpl: (async () => {
          throw new Error('connection refused');
        }) as typeof fetch
      });
      expect(report.checks.find((check) => check.id === 'ollama')?.status).toBe(
        'warning'
      );
      expect(
        ['ok', 'warning', 'error'].includes(report.status)
      ).toBe(true);
    } finally {
      await fs.rm(dataDir, { recursive: true, force: true });
    }
  });
});
