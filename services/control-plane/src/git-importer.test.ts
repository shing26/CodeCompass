import { describe, expect, it, vi, beforeEach } from 'vitest';
import fsSync from 'node:fs';
import os from 'node:os';
import path from 'node:path';

vi.mock('node:child_process', () => ({ execFile: vi.fn() }));
import { execFile } from 'node:child_process';

import {
  cloneGitRepo,
  deriveCloneName,
  isTransientGitFailure,
  validateGitBranch,
  validateGitUrl
} from './git-importer';

const execFileMock = vi.mocked(execFile);

function mockExecSuccess(): void {
  execFileMock.mockImplementation((_file, args, _options, callback) => {
    // Mimic `git clone` actually producing the checkout.
    const targetDir = typeof args?.[args.length - 1] === 'string' ? args[args.length - 1] : null;
    if (targetDir) fsSync.mkdirSync(targetDir, { recursive: true });
    const cb = callback as (err: null, stdout: string, stderr: string) => void;
    cb(null, '', '');
    return undefined as never;
  });
}

function mockExecError(
  error: Error & { code?: unknown; killed?: boolean; signal?: unknown }
): void {
  execFileMock.mockImplementation((_file, _args, _options, callback) => {
    const cb = callback as (
      err: NodeJS.ErrnoException,
      stdout: string,
      stderr: string
    ) => void;
    cb(error as NodeJS.ErrnoException, '', 'fatal: repository not found');
    return undefined as never;
  });
}

describe('validateGitUrl', () => {
  it('accepts https, http, git and ssh URLs', () => {
    expect(validateGitUrl('https://github.com/octocat/Hello-World.git').ok).toBe(true);
    expect(validateGitUrl('https://github.com/octocat/Hello-World.git')).toEqual({
      ok: true,
      url: new URL('https://github.com/octocat/Hello-World.git')
    });
    expect(validateGitUrl('http://localhost:8080/repo.git').ok).toBe(true);
    expect(validateGitUrl('git://127.0.0.1:9418/demo.git').ok).toBe(true);
    expect(validateGitUrl('ssh://git@github.com/org/repo.git').ok).toBe(true);
  });

  it('rejects local-file and code-execution schemes', () => {
    expect(validateGitUrl('file:///C:/etc/passwd').ok).toBe(false);
    expect(validateGitUrl('file://./repo').ok).toBe(false);
    expect(validateGitUrl('data:text/html,oops').ok).toBe(false);
    expect(validateGitUrl('javascript:alert(1)').ok).toBe(false);
  });

  it('rejects relative paths and scp-like shorthand', () => {
    expect(validateGitUrl('foo/bar').ok).toBe(false);
    expect(validateGitUrl('/absolute/path').ok).toBe(false);
    expect(validateGitUrl('git@github.com:octocat/Hello-World.git').ok).toBe(false);
    expect(validateGitUrl('C:/projects/repo').ok).toBe(false);
  });

  it('rejects empty, whitespace, control chars and embedded credentials', () => {
    expect(validateGitUrl('').ok).toBe(false);
    expect(validateGitUrl('   ').ok).toBe(false);
    expect(validateGitUrl('https://github.com/a b/repo.git').ok).toBe(false);
    expect(validateGitUrl('https://user:secret@github.com/org/repo.git').ok).toBe(false);
    expect(validateGitUrl('https://github.com/org/repo.git\n-evil').ok).toBe(false);
  });
});

describe('validateGitBranch', () => {
  it('returns undefined for empty input', () => {
    expect(validateGitBranch(undefined)).toBeUndefined();
    expect(validateGitBranch('')).toBeUndefined();
    expect(validateGitBranch('   ')).toBeUndefined();
  });

  it('accepts plain and slashed branch names', () => {
    expect(validateGitBranch('main')).toBe('main');
    expect(validateGitBranch(' feature/x-1.2 ')).toBe('feature/x-1.2');
  });

  it('rejects option-like, dotdot and exotic branch names', () => {
    expect(() => validateGitBranch('-x')).toThrow(/not start with/);
    expect(() => validateGitBranch('a..b')).toThrow(/unsupported/);
    expect(() => validateGitBranch('a b')).toThrow(/unsupported/);
    expect(() => validateGitBranch('分支')).toThrow(/unsupported/);
  });
});

describe('deriveCloneName', () => {
  it('strips .git and keeps the last path segment', () => {
    expect(deriveCloneName('https://github.com/octocat/Hello-World.git')).toBe('Hello-World');
    expect(deriveCloneName('https://github.com/org/deep/repo')).toBe('repo');
    expect(deriveCloneName('git://127.0.0.1:9418/demo.git')).toBe('demo');
  });

  it('sanitizes unsafe characters and falls back for empty paths', () => {
    expect(deriveCloneName('https://example.com/R 2/demo+repo.git')).toBe('demo-repo');
    expect(deriveCloneName('https://example.com/')).toBe('remote-repo');
  });
});

describe('cloneGitRepo', () => {
  beforeEach(() => {
    execFileMock.mockReset();
    mockExecSuccess();
  });

  it('runs a shallow clone with pinned branch as an argument array', async () => {
    const targetDir = path.join(os.tmpdir(), 'issue19-clone-a');
    const result = await cloneGitRepo({
      url: 'https://github.com/octocat/Hello-World.git',
      branch: 'main',
      targetDir
    });
    expect(execFileMock).toHaveBeenCalledTimes(1);
    const [, args] = execFileMock.mock.calls[0];
    expect(args).toEqual([
      'clone',
      '--depth',
      '1',
      '--branch',
      'main',
      'https://github.com/octocat/Hello-World.git',
      targetDir
    ]);
    expect(result.branch).toBe('main');
    expect(result.url).toBe('https://github.com/octocat/Hello-World.git');
    expect(result.targetDir).toBe(targetDir);
  });

  it('omits --branch when not requested (no injection surface)', async () => {
    const targetDir = path.join(os.tmpdir(), 'issue19-clone-b');
    await cloneGitRepo({ url: 'git://127.0.0.1:9418/demo.git', targetDir });
    const [, args] = execFileMock.mock.calls[0];
    expect(args).toEqual(['clone', '--depth', '1', 'git://127.0.0.1:9418/demo.git', targetDir]);
  });

  it('rejects invalid URLs before ever spawning git', async () => {
    await expect(
      cloneGitRepo({ url: 'file:///C:/etc/passwd', targetDir: path.join(os.tmpdir(), 'x') })
    ).rejects.toThrow(/unsupported scheme/);
    expect(execFileMock).not.toHaveBeenCalled();
  });

  it('rejects a non-absolute targetDir', async () => {
    await expect(
      cloneGitRepo({ url: 'https://example.com/repo.git', targetDir: 'relative/dir' })
    ).rejects.toThrow(/absolute path/);
    expect(execFileMock).not.toHaveBeenCalled();
  });

  it('surfaces git stderr and cleans up the partial checkout on failure', async () => {
    mockExecError(Object.assign(new Error('git failed'), { code: 128 }));
    const targetDir = path.join(os.tmpdir(), 'issue19-clone-c', 'partial');
    await expect(
      cloneGitRepo({ url: 'https://example.com/missing.git', targetDir })
    ).rejects.toThrow(/git clone failed/);
  });

  it('reports timeouts with the configured limit', async () => {
    mockExecError(
      Object.assign(new Error('timeout'), { killed: true, signal: 'SIGKILL' })
    );
    await expect(
      cloneGitRepo({ url: 'https://example.com/slow.git', targetDir: path.join(os.tmpdir(), 'slow'), timeoutMs: 60_000 })
    ).rejects.toThrow(/timed out after 60000ms/);
    // V27-18: a timeout burns the full budget — deliberately NOT retried.
    expect(execFileMock).toHaveBeenCalledTimes(1);
  });

  // V27-18 (v029/02): transient network blips retry twice (1s/2s), permanent
  // failures fail fast. retryBackoffMs=[0] keeps these instant.
  function mockTransientThenSuccess(): void {
    execFileMock.mockImplementationOnce((_file, _args, _opts, callback) => {
      const cb = callback as (err: Error, stdout: string, stderr: string) => void;
      cb(
        Object.assign(new Error('git failed'), { code: 128 }),
        '',
        'fatal: could not read from remote repository'
      );
      return undefined as never;
    });
    mockExecSuccess();
  }

  it('retries a transient clone failure once and succeeds', async () => {
    mockTransientThenSuccess();
    const targetDir = path.join(os.tmpdir(), 'issue19-retry-ok');
    const retries: number[] = [];
    const result = await cloneGitRepo({
      url: 'https://github.com/octocat/Hello-World.git',
      targetDir,
      retryBackoffMs: [0],
      onRetry: ({ attempt }) => retries.push(attempt)
    });
    expect(execFileMock).toHaveBeenCalledTimes(2);
    expect(retries).toEqual([2]);
    expect(result.targetDir).toBe(targetDir);
  });

  it('does NOT retry permanent failures (auth/not-found fail fast)', async () => {
    mockExecError(Object.assign(new Error('git failed'), { code: 128 }));
    const targetDir = path.join(os.tmpdir(), 'issue19-permanent');
    await expect(
      cloneGitRepo({
        url: 'https://example.com/missing.git',
        targetDir,
        retryBackoffMs: [0, 0],
        onRetry: () => {
          throw new Error('must not retry a permanent failure');
        }
      })
    ).rejects.toThrow(/git clone failed/);
    expect(execFileMock).toHaveBeenCalledTimes(1);
  });

  it('gives up after the backoff budget and reports the LAST failure', async () => {
    execFileMock.mockImplementation((_file, _args, _opts, callback) => {
      const cb = callback as (err: Error, stdout: string, stderr: string) => void;
      cb(
        Object.assign(new Error('git failed'), { code: 128 }),
        '',
        'fatal: connection reset by peer'
      );
      return undefined as never;
    });
    const targetDir = path.join(os.tmpdir(), 'issue19-exhaust');
    const onRetry = vi.fn();
    await expect(
      cloneGitRepo({
        url: 'https://github.com/octocat/Hello-World.git',
        targetDir,
        retryBackoffMs: [0, 0],
        onRetry
      })
    ).rejects.toThrow(/connection reset/);
    expect(execFileMock).toHaveBeenCalledTimes(3); // 1 + 2 retries
    expect(onRetry).toHaveBeenCalledTimes(2);
    expect(onRetry.mock.calls.map((c) => c[0].attempt)).toEqual([2, 3]);
  });
});

describe('isTransientGitFailure (V27-18 classifier)', () => {
  it('transient: network blips and DNS', () => {
    expect(isTransientGitFailure('git clone failed: fatal: could not read from remote repository')).toBe(true);
    expect(isTransientGitFailure('git clone failed: error: Could not resolve host: github.com')).toBe(true);
    expect(isTransientGitFailure('git clone failed: RPC failed; curl 56 OpenSSL read: Connection reset by peer')).toBe(true);
    expect(isTransientGitFailure('git clone failed: The requested URL returned error: 502')).toBe(true);
  });

  it('permanent: auth, not-found, and burned-timeout stay single-shot', () => {
    expect(isTransientGitFailure('git clone failed: fatal: authentication failed')).toBe(false);
    expect(isTransientGitFailure('git clone failed: fatal: repository not found')).toBe(false);
    expect(isTransientGitFailure('git clone timed out after 60000ms: fatal: early EOF')).toBe(false);
    // Auth-bearing messages win over transient substrings: never retry those.
    expect(isTransientGitFailure('unable to access: Authentication failed')).toBe(false);
  });
});