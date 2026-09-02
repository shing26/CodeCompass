import fs from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { openDb } from './db';
import { EventBus } from './events';
import { createHttpApp } from './http';
import { RepoQARepos, resolveRepoCommitSync } from './repoqa-repos';
import { RepoQAWorker } from './repoqa-worker';
import { Repos } from './repos';

const tempDirs: string[] = [];

afterEach(async () => {
  for (const dir of tempDirs.splice(0)) {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

/** Create a real git repo with one commit; returns the commit hash. */
function gitCommit(dir: string): string {
  const run = (args: string[]) => {
    const result = spawnSync('git', args, { cwd: dir, encoding: 'utf8' });
    if (result.status !== 0) {
      throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`);
    }
    return result.stdout.trim();
  };
  run(['init', '-q']);
  run(['config', 'user.email', 'test@example.com']);
  run(['config', 'user.name', 'Test']);
  run(['add', '.']);
  run(['commit', '-q', '-m', 'init']);
  return run(['rev-parse', 'HEAD']);
}

describe('Issue 23 / ADR-0010 — resolveRepoCommitSync', () => {
  it('returns the commit hash for a clean git work tree', async () => {
    const dir = await makeTempDir('repoqa-commit-clean-');
    await fs.writeFile(path.join(dir, 'a.txt'), 'one\n');
    const hash = gitCommit(dir);
    expect(resolveRepoCommitSync(dir)).toBe(hash);
  });

  it('appends +dirty when the work tree has uncommitted changes', async () => {
    const dir = await makeTempDir('repoqa-commit-dirty-');
    await fs.writeFile(path.join(dir, 'a.txt'), 'one\n');
    const hash = gitCommit(dir);
    await fs.writeFile(path.join(dir, 'a.txt'), 'one\ntwo\n');
    expect(resolveRepoCommitSync(dir)).toBe(`${hash}+dirty`);
  });

  it('returns unversioned outside a git work tree', async () => {
    const dir = await makeTempDir('repoqa-commit-plain-');
    await fs.writeFile(path.join(dir, 'a.txt'), 'plain\n');
    expect(resolveRepoCommitSync(dir)).toBe('unversioned');
  });

  it('returns unversioned for a missing path instead of throwing', () => {
    expect(resolveRepoCommitSync(path.join(os.tmpdir(), 'repoqa-missing-zz'))).toBe('unversioned');
  });
});

describe('Issue 23 / ADR-0010 — repos.commit column', () => {
  it('migrates an existing pre-commit database without losing rows', () => {
    const tempDir = os.tmpdir();
    const dbPath = path.join(tempDir, `repoqa-commit-mig-${Date.now()}.db`);
    // Simulate an old database: repos table without the commit column.
    const legacy = new Database(dbPath);
    legacy.exec(
      `CREATE TABLE repos (
         id TEXT PRIMARY KEY, name TEXT NOT NULL, repo_url TEXT, local_path TEXT NOT NULL,
         branch TEXT DEFAULT 'main', status TEXT NOT NULL DEFAULT 'idle', error TEXT,
         file_count INTEGER NOT NULL DEFAULT 0, symbol_count INTEGER NOT NULL DEFAULT 0,
         created_at TEXT NOT NULL, updated_at TEXT NOT NULL
       );`
    );
    const now = new Date().toISOString();
    legacy
      .prepare(
        `INSERT INTO repos (id, name, local_path, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`
      )
      .run('repo-old', 'legacy', 'C:/legacy', now, now);
    legacy.close();

    try {
      const db = openDb(dbPath);
      const columns = (db.prepare('PRAGMA table_info(repos)').all() as Array<{ name: string }>).map(
        (column) => column.name
      );
      expect(columns).toContain('repo_commit');
      const repos = new RepoQARepos(db);
      const legacyRepo = repos.getRepo('repo-old');
      expect(legacyRepo?.name).toBe('legacy');
      db.close();
    } finally {
      fs.rm(dbPath, { force: true }).catch(() => undefined);
    }
  });

  it('createRepo persists the physical commit state', async () => {
    const db = openDb(':memory:');
    const repos = new RepoQARepos(db);
    try {
      const gitDir = await makeTempDir('repoqa-commit-create-');
      await fs.writeFile(path.join(gitDir, 'a.txt'), 'x\n');
      const hash = gitCommit(gitDir);

      const plainDir = await makeTempDir('repoqa-commit-create-plain-');

      expect(repos.createRepo({ id: 'r1', name: 'git', localPath: gitDir }).commit).toBe(hash);
      expect(repos.createRepo({ id: 'r2', name: 'plain', localPath: plainDir }).commit).toBe(
        'unversioned'
      );
    } finally {
      db.close();
    }
  });

  it('refreshRepoCommit re-pins after the work tree changes', async () => {
    const db = openDb(':memory:');
    const repos = new RepoQARepos(db);
    try {
      const dir = await makeTempDir('repoqa-commit-refresh-');
      await fs.writeFile(path.join(dir, 'a.txt'), 'one\n');
      const hash = gitCommit(dir);
      repos.createRepo({ id: 'r1', name: 'demo', localPath: dir });
      await fs.writeFile(path.join(dir, 'a.txt'), 'one\ntwo\n');
      repos.refreshRepoCommit('r1');
      expect(repos.getRepo('r1')?.commit).toBe(`${hash}+dirty`);
    } finally {
      db.close();
    }
  });
});

describe('Issue 23 / ADR-0010 — SSE anchors carry the physical commit', () => {
  it('stamps validated anchors and the done payload with the repo commit', async () => {
    const dir = await makeTempDir('repoqa-commit-sse-');
    const pkg = path.join(dir, 'src', 'main', 'java', 'com', 'demo');
    await fs.mkdir(pkg, { recursive: true });
    await fs.writeFile(path.join(dir, 'pom.xml'), '<project/>\n');
    await fs.writeFile(
      path.join(pkg, 'Controller.java'),
      'package com.demo;\n@RestController\npublic class Controller {\n  private final DemoService demoService = new DemoService();\n  public String hello() {\n    return demoService.greet();\n  }\n}\n'
    );
    await fs.writeFile(
      path.join(pkg, 'DemoService.java'),
      'package com.demo;\n@Service\npublic class DemoService {\n  public String greet() {\n    return "hello";\n  }\n}\n'
    );
    const hash = gitCommit(dir);

    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'repoqa-commit-http-'));
    const db = openDb(':memory:');
    const repos = new Repos(db);
    const repoqa = new RepoQARepos(db);
    const worker = new RepoQAWorker(repoqa, new EventBus());
    const app = createHttpApp({
      repos,
      orchestrator: undefined as never,
      harnessManager: undefined as never,
      repoqa,
      worker,
      eventBus: undefined as never,
      version: 'test',
      dataDir: tempDir,
      port: 0,
      exportDir: path.join(tempDir, 'exports')
    });
    const server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    try {
      const importResponse = await fetch(`${baseUrl}/api/repos`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ localPath: dir })
      });
      const importBody = (await importResponse.json()) as {
        repo?: { id: string; status: string };
      };
      const repoId = importBody.repo!.id;
      expect(importBody.repo!.status).toBe('ready');

      const response = await fetch(
        `${baseUrl}/api/repos/${repoId}/query?question=${encodeURIComponent('trace hello')}`
      );
      const text = await response.text();
      const blocks = text.split('\n\n').filter(Boolean);
      const anchorsBlock = blocks.find((block) => block.startsWith('event: repoqa.query.anchors'));
      const doneBlock = blocks.find((block) => block.startsWith('event: repoqa.query.done'));
      expect(anchorsBlock).toBeDefined();
      expect(doneBlock).toBeDefined();

      const anchorPayload = JSON.parse(anchorsBlock!.slice(anchorsBlock!.indexOf('data: ') + 6)) as {
        anchors: Array<{ commit?: string }>;
      };
      expect(anchorPayload.anchors.length).toBeGreaterThan(0);
      for (const anchor of anchorPayload.anchors) {
        expect(anchor.commit).toBe(hash);
      }

      const donePayload = JSON.parse(doneBlock!.slice(doneBlock!.indexOf('data: ') + 6)) as {
        commit?: string;
      };
      expect(donePayload.commit).toBe(hash);
      // The registered repo itself records the same physical state.
      expect(repoqa.getRepo(repoId)?.commit).toBe(hash);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      db.close();
    }
  });
});
