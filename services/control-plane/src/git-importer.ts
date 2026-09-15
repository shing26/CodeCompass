import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';

/**
 * Issue 19 — secure remote-repo ingestion.
 *
 * `cloneGitRepo` shells out to `git clone` with an *argument array* (never a
 * shell string), a 60s timeout, and strict input validation so a malicious
 * `url`/`branch` can never inject options or escape the target directory.
 */

export const GIT_CLONE_TIMEOUT_MS = 60_000;

/** Schemes a clone may come from. SSH is accepted (git@host:path is handled
 * by git itself) but only when it uses an explicit ssh:// URL; scp-like
 * shorthand (`git@github.com:org/repo.git`) is rejected because it cannot be
 * parsed safely. */
const ALLOWED_SCHEMES = new Set(['https:', 'http:', 'git:', 'ssh:']);

/** Branch names may contain letters/digits/_/-/., plus `/` for nested names. */
const BRANCH_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/;

export type GitUrlValidation =
  | { ok: true; url: URL }
  | { ok: false; error: string };

/**
 * Validate a remote git URL. Safety rules:
 * - must parse as an absolute URL with an https/http/git/ssh scheme
 * - never file:, data:, javascript: or any local-path scheme
 * - no control characters / whitespace / credentials-in-path weirdness
 * - not an scp-like shorthand (no scheme prefix)
 */
export function validateGitUrl(rawUrl: string): GitUrlValidation {
  const url = rawUrl.trim();
  if (url === '') {
    return { ok: false, error: 'git URL is required' };
  }
  if (/[\u0000-\u001f\u007f\s]/.test(url)) {
    return { ok: false, error: 'git URL must not contain whitespace or control characters' };
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return {
      ok: false,
      error: 'git URL must be an absolute URL with a scheme (e.g. https://github.com/org/repo.git)'
    };
  }
  if (!ALLOWED_SCHEMES.has(parsed.protocol)) {
    return {
      ok: false,
      error: `unsupported scheme "${parsed.protocol}" — use https://, http://, git:// or ssh://`
    };
  }
  if (parsed.password) {
    return { ok: false, error: 'git URL must not embed credentials' };
  }
  // `git@` usernames are normal for ssh:// (and only there).
  if (parsed.username && parsed.protocol !== 'ssh:') {
    return { ok: false, error: 'git URL must not embed credentials' };
  }
  if (parsed.protocol === 'ssh:' && parsed.pathname === '' && parsed.hostname === '') {
    return { ok: false, error: 'scp-like ssh shorthand is not supported; use ssh://host/path' };
  }
  return { ok: true, url: parsed };
}

/**
 * Validate a branch/ref name accepted by `git clone --branch`.
 * Whitelisted charset plus no leading `-` so it can never be parsed as an
 * option; `/` allowed for feature branches (`feature/foo`); no `..`, no
 * trailing dot, no control characters.
 */
export function validateGitBranch(branch?: string): string | undefined {
  const value = branch?.trim();
  if (!value) return undefined;
  if (value.startsWith('-')) {
    throw new Error('branch must not start with "-"');
  }
  if (!BRANCH_PATTERN.test(value) || value.includes('..') || value.endsWith('.')) {
    throw new Error(
      'branch contains unsupported characters (letters, digits, _ . / - only)'
    );
  }
  return value;
}

/**
 * Derive a safe display name + directory basename from a git URL.
 * `https://github.com/octocat/Hello-World.git` → `Hello-World`.
 */
export function deriveCloneName(url: string): string {
  const parsed = new URL(url);
  const last = parsed.pathname.split('/').filter(Boolean).pop() ?? '';
  const bare = last.replace(/\.git$/i, '');
  const cleaned = bare
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^[.-]+|[.-]+$/g, '');
  return cleaned === '' ? 'remote-repo' : cleaned;
}

export interface CloneGitRepoInput {
  url: string;
  branch?: string;
  /** Absolute path where the shallow clone should land. */
  targetDir: string;
  /** Upper bound for the whole `git clone` subprocess (ms). */
  timeoutMs?: number;
  /** V27-18: backoff schedule (ms) between transient-failure retries.
   * Default CLONE_TRANSIENT_RETRY_BACKOFF_MS; tests pass [0]. */
  retryBackoffMs?: number[];
  /** V27-18: fired before each retry wait (progress stays auditable in
   * the server log — the clone endpoint is pre-202, there is no stream
   * to push to yet; see the import-202 ledger ticket for that half). */
  onRetry?: (info: { attempt: number; backoffMs: number; reason: string }) => void;
}

/**
 * V27-18: transient vs permanent git clone failures.
 *
 * Only fast network blips retry (they fail within seconds and a second
 * attempt commonly succeeds). Timeouts are deliberately NOT transient: the
 * subprocess already burned the full 60s budget, and retrying blindly would
 * stretch this synchronous endpoint to 3x60s — worse than letting the user
 * see the error and decide. Auth/404-style failures are deterministic and
 * retried never.
 */
const TRANSIENT_PATTERNS: RegExp[] = [
  /could not read from remote repository/i,
  /connection (?:reset|aborted|refused|closed)/i,
  /failed to connect/i,
  /unable to access/i,
  /could not resolve host|name resolution|temporary failure in name resolution|\bdns\b/i,
  /early eof|rpc failed/i,
  /the requested url returned error: 5\d\d/i,
  /the requested url returned error: 429/i,
  /transaction (?:is|was) aborted/i
];
const PERMANENT_PATTERNS: RegExp[] = [
  /authentication failed/i,
  /permission denied \(i18n\)|invalid credentials/i,
  /\b403\b/,
  /repository.*not found|not found$|does not appear to be a git repository/i,
  /timed out/i
];

export function isTransientGitFailure(message: string): boolean {
  if (PERMANENT_PATTERNS.some((re) => re.test(message))) return false;
  return TRANSIENT_PATTERNS.some((re) => re.test(message));
}

/** Two retries: 1s then 2s (V27-18 "2 次指数退避"). */
export const CLONE_TRANSIENT_RETRY_BACKOFF_MS = [1_000, 2_000];

function sleep(ms: number): Promise<void> {
  return ms <= 0 ? Promise.resolve() : new Promise((resolve) => setTimeout(resolve, ms));
}

export interface CloneGitRepoResult {
  url: string;
  branch?: string;
  targetDir: string;
}

/**
 * Clone `url` into `targetDir` with `--depth 1` (optionally pinned to
 * `branch`). Throws on validation failure, git failure, or timeout. On any
 * failure the partially-cloned target directory is removed so the indexer
 * never sees a broken checkout.
 */
export async function cloneGitRepo(
  input: CloneGitRepoInput
): Promise<CloneGitRepoResult> {
  const validated = validateGitUrl(input.url);
  if (!validated.ok) {
    throw new Error(validated.error);
  }
  const branch = validateGitBranch(input.branch);
  if (!path.isAbsolute(input.targetDir)) {
    throw new Error('targetDir must be an absolute path');
  }

  await fs.rm(input.targetDir, { recursive: true, force: true });
  const args = ['clone', '--depth', '1'];
  if (branch) {
    args.push('--branch', branch);
  }
  args.push(validated.url.toString(), input.targetDir);

  const timeoutMs = input.timeoutMs ?? GIT_CLONE_TIMEOUT_MS;
  const backoff = input.retryBackoffMs ?? CLONE_TRANSIENT_RETRY_BACKOFF_MS;
  const maxAttempts = 1 + backoff.length;
  for (let attempt = 0; ; attempt += 1) {
    try {
      await runGit(args, timeoutMs);
      break;
    } catch (err) {
      // Every failure removes the partial checkout (V27-18: retried attempts
      // get a clean directory too — fs.rm force tolerates a missing path).
      await fs.rm(input.targetDir, { recursive: true, force: true }).catch(() => {});
      const message = err instanceof Error ? err.message : String(err);
      const transient = isTransientGitFailure(message);
      if (!transient || attempt >= maxAttempts - 1) {
        throw err;
      }
      input.onRetry?.({ attempt: attempt + 2, backoffMs: backoff[attempt]!, reason: message });
      await sleep(backoff[attempt]!);
    }
  }

  const stat = await fs.stat(input.targetDir).catch(() => null);
  if (!stat?.isDirectory()) {
    await fs.rm(input.targetDir, { recursive: true, force: true }).catch(() => {});
    throw new Error(`git clone finished but "${input.targetDir}" is missing`);
  }
  return { url: validated.url.toString(), branch, targetDir: input.targetDir };
}

function runGit(args: string[], timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(
      'git',
      args,
      { timeout: timeoutMs, windowsHide: true, maxBuffer: 2 * 1024 * 1024 },
      (error, _stdout, stderr) => {
        if (!error) {
          resolve();
          return;
        }
        const suffix =
          typeof stderr === 'string'
            ? stderr.trim().slice(0, 500)
            : '';
        if ((error as Error & { killed?: boolean }).killed) {
          reject(new Error(`git clone timed out after ${timeoutMs}ms${suffix ? `: ${suffix}` : ''}`));
          return;
        }
        reject(new Error(`git clone failed${suffix ? `: ${suffix}` : ''}`));
      }
    );
  });
}