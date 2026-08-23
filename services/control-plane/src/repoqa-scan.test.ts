import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { isIgnoredDir, scanRepo } from './repoqa-scan';

async function makeTree(root: string, dirs: string[]): Promise<void> {
  for (const dir of dirs) {
    await fs.mkdir(path.join(root, dir), { recursive: true });
    await fs.writeFile(path.join(root, dir, 'probe.txt'), 'probe\n');
  }
}

describe('isIgnoredDir', () => {
  it('ignores build and configuration directories', () => {
    for (const name of [
      'target',
      'build',
      '.idea',
      'node_modules',
      'dist',
      'out',
      '.git',
      '.gradle',
      '.mvn',
      '.vscode',
      'coverage',
      '__pycache__'
    ]) {
      expect(isIgnoredDir(name)).toBe(true);
    }
  });

  it('matches case-insensitively (Windows / macOS-Linux checkout drift)', () => {
    expect(isIgnoredDir('Target')).toBe(true);
    expect(isIgnoredDir('BUILD')).toBe(true);
    expect(isIgnoredDir('Node_Modules')).toBe(true);
  });

  it('does not ignore normal source directories', () => {
    expect(isIgnoredDir('src')).toBe(false);
    expect(isIgnoredDir('api')).toBe(false);
    expect(isIgnoredDir('target-utils')).toBe(false); // prefix only, not the dir
  });
});

describe('scanRepo exclusion', () => {
  it('skips nested build/config directories when counting files', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'repoqa-scan-'));
    await makeTree(root, ['target/classes', 'build/libs', '.idea', 'node_modules/dep']);
    await fs.mkdir(path.join(root, 'src', 'main', 'java'), { recursive: true });
    await fs.writeFile(path.join(root, 'src', 'main', 'java', 'App.java'), 'class App {}\n');

    const stats = await scanRepo(root);
    expect(stats.fileCount).toBe(1);
    expect(stats.files.join(path.sep)).toContain('App.java');
    expect(stats.files.join(path.sep)).not.toContain('probe.txt');
  });

  it('is case-insensitive on disk names as well', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'repoqa-scan-'));
    await makeTree(root, ['Target/classes']);
    await fs.mkdir(path.join(root, 'src'), { recursive: true });
    await fs.writeFile(path.join(root, 'src', 'App.java'), 'class App {}\n');

    const stats = await scanRepo(root);
    expect(stats.fileCount).toBe(1);
    expect(stats.files.some((f) => f.includes('App.java'))).toBe(true);
  });
});