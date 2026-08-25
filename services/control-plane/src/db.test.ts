import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { backupDb, openDb } from './db';

describe('SQLite startup backups', () => {
  it('skips in-memory and missing databases', async () => {
    expect(await backupDb(':memory:')).toBeNull();

    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'repoqa-backup-missing-'));
    try {
      expect(await backupDb(path.join(tempDir, 'missing.db'))).toBeNull();
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it('backs up an existing database and keeps its data readable', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'repoqa-backup-data-'));
    const dbPath = path.join(tempDir, 'mhw.db');
    try {
      const db = openDb(dbPath);
      const now = new Date().toISOString();
      db.prepare(
        `INSERT INTO repos (id, name, local_path, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)`
      ).run('repo-1', 'demo', 'C:/demo', now, now);
      db.close();

      const backupPath = await backupDb(dbPath);
      expect(backupPath).not.toBeNull();

      const restored = openDb(backupPath!);
      const row = restored
        .prepare('SELECT name FROM repos WHERE id = ?')
        .get('repo-1') as { name: string } | undefined;
      expect(row?.name).toBe('demo');
      restored.close();
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it('rotates backups to the newest five', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'repoqa-backup-rotate-'));
    const dbPath = path.join(tempDir, 'mhw.db');
    try {
      const db = openDb(dbPath);
      db.close();

      for (let index = 0; index < 6; index += 1) {
        await backupDb(dbPath);
      }

      const backups = (await fs.readdir(tempDir)).filter((name) =>
        name.startsWith('mhw.db.backup-')
      );
      expect(backups).toHaveLength(5);
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });
});
