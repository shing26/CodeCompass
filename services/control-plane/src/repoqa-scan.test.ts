import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  detectSuggestedSubdirs,
  isIgnoredDir,
  previewRepo,
  scanRepo
} from './repoqa-scan';

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
      '.venv',
      'venv',
      '.scratch',
      '.penguin',
      '.tmp',
      '.pytest_cache',
      '.ruff_cache',
      '.reasonix',
      '.opencode',
      '.codex',
      '.workbuddy',
      'coverage',
      '__pycache__',
      'test-results'
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

describe('scanRepo SLOC budget (v0.5.1 D1)', () => {
  it('counts source lines only and leaves data/doc files out of the line budget', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'repoqa-sloc-'));
    try {
      await fs.mkdir(path.join(root, 'src'), { recursive: true });
      await fs.writeFile(path.join(root, 'src', 'App.java'), 'class App {}\nclass B {}\n');
      await fs.writeFile(
        path.join(root, 'big.log'),
        Array.from({ length: 10_000 }, () => 'x').join('\n')
      );
      await fs.writeFile(
        path.join(root, 'data.json'),
        JSON.stringify({ items: Array.from({ length: 5000 }, () => 'x') })
      );

      const stats = await scanRepo(root);
      expect(stats.fileCount).toBe(3);
      expect(stats.lineCount).toBe(2);
      expect(stats.files.some((file) => file.endsWith('big.log'))).toBe(true);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('counts .mjs as web source in preview', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'repoqa-mjs-'));
    try {
      await fs.mkdir(path.join(root, 'src'), { recursive: true });
      await fs.writeFile(path.join(root, 'src', 'esm.mjs'), 'export const x = 1;\n');
      const preview = await previewRepo(root);
      expect(preview.webFileCount).toBe(1);
      expect(preview.fileCount).toBe(1);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});

describe('detectSuggestedSubdirs (v0.5.1 D1)', () => {
  it('returns only existing src/packages/apps roots', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'repoqa-suggest-'));
    try {
      await fs.mkdir(path.join(root, 'src'), { recursive: true });
      await fs.mkdir(path.join(root, 'packages', 'a'), { recursive: true });
      expect(await detectSuggestedSubdirs(root)).toEqual(['src', 'packages']);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});

describe('scanRepo exclusion', () => {
  it('skips nested build/config directories when counting files', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'repoqa-scan-'));
    await makeTree(root, [
      'target/classes',
      'build/libs',
      '.idea',
      'node_modules/dep',
      '.scratch/issue22-demo',
      '.penguin/cache',
      'test-results/playwright'
    ]);
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

describe('scanRepo XML resources (Issue 24)', () => {
  it('counts mapper XML files so MyBatis resources enter the evidence plane', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'repoqa-scan-xml-'));
    try {
      await fs.mkdir(path.join(root, 'src', 'main', 'resources', 'mapper'), {
        recursive: true
      });
      await fs.writeFile(
        path.join(root, 'src', 'main', 'resources', 'mapper', 'OrderMapper.xml'),
        '<mapper namespace="com.demo.OrderMapper"></mapper>\n'
      );
      await fs.mkdir(path.join(root, 'src', 'main', 'java'), { recursive: true });
      await fs.writeFile(
        path.join(root, 'src', 'main', 'java', 'App.java'),
        'class App {}\n'
      );

      const stats = await scanRepo(root);
      expect(stats.fileCount).toBe(2);
      expect(stats.xmlFileCount).toBe(1);
      expect(stats.files.some((file) => file.endsWith('OrderMapper.xml'))).toBe(true);

      const preview = await previewRepo(root);
      expect(preview.fileCount).toBe(2);
      expect(preview.xmlFileCount).toBe(1);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});

describe('previewRepo (Round 2 B4)', () => {
  it('counts indexable files, Java files, and ignored dirs before import', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'repoqa-preview-'));
    await makeTree(root, [
      '.git/objects',
      'node_modules/dep',
      '.scratch/demo',
      'target/classes'
    ]);
    await fs.mkdir(path.join(root, 'src', 'main', 'java'), { recursive: true });
    await fs.writeFile(path.join(root, 'src', 'main', 'java', 'App.java'), 'class App {}\n');
    await fs.mkdir(path.join(root, 'src', 'main', 'web'), { recursive: true });
    await fs.writeFile(path.join(root, 'src', 'main', 'web', 'app.ts'), 'export const x = 1;\n');
    await fs.writeFile(path.join(root, 'src', 'main', 'web', 'app.jsx'), 'export const y = 2;\n');
    await fs.mkdir(path.join(root, 'src', 'main', 'go'), { recursive: true });
    await fs.writeFile(path.join(root, 'src', 'main', 'go', 'app.go'), 'package main\n');
    await fs.mkdir(path.join(root, 'src', 'main', 'python'), { recursive: true });
    await fs.writeFile(path.join(root, 'src', 'main', 'python', 'app.py'), 'def main():\n    pass\n');
    await fs.writeFile(path.join(root, 'README.md'), '# Demo\n');

    const preview = await previewRepo(root);
    expect(preview.fileCount).toBe(6);
    expect(preview.javaFileCount).toBe(1);
    expect(preview.webFileCount).toBe(2);
    expect(preview.goFileCount).toBe(1);
    expect(preview.pythonFileCount).toBe(1);
    expect(preview.skippedDirCount).toBe(4);
    expect(preview.skippedDirs).toEqual(['.git', '.scratch', 'node_modules', 'target']);
  });

  it('rejects paths that are not a directory', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'repoqa-preview-missing-'));
    await expect(previewRepo(path.join(root, 'missing'))).rejects.toThrow(
      /not a directory/
    );
  });
});
