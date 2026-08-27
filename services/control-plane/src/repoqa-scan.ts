import fs from 'node:fs/promises';
import path from 'node:path';
import { parsePomModules } from './repoqa-parser';

export const MAX_FILES = 3000;
export const MAX_LINES = 500_000;

/** v0.6.0 (D-BE-1) — files beyond these limits degrade to Tier 3 extraction. */
export const LARGE_FILE_LINE_LIMIT = 3000;
export const LARGE_FILE_LINE_LENGTH_LIMIT = 1000;

/** v0.5.1 — source extensions whose SLOC counts toward the line budget. */
export const SOURCE_EXTENSIONS = new Set([
  '.java',
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.py',
  '.go'
]);

/** Issue 25: web-family files parsed by the TypeScript/JavaScript adapter. */
export const WEB_FILE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs']);

/** Issue 26: Go source files parsed by the Go adapter. */
export const GO_FILE_EXTENSIONS = new Set(['.go']);

/** Issue 27: Python source files parsed by the Python adapter. */
export const PYTHON_FILE_EXTENSIONS = new Set(['.py']);

/**
 * Issue 18 — directories that are never indexed. Matching is case-insensitive
 * (`Target` ≡ `target`) because the same repo is often checked out on macOS
 * (exact case) and Windows (case-insensitive filesystem).
 */
const IGNORED_DIRS = new Set([
  '.git',
  '.gradle',
  '.mvn',
  '.idea',
  '.vscode',
  '.cache',
  '.next',
  '.venv',
  '.scratch',
  '.penguin',
  '.tmp',
  '.pytest_cache',
  '.ruff_cache',
  '.reasonix',
  '.opencode',
  '.codex',
  '.workbuddy',
  'venv',
  '__pycache__',
  'test-results',
  'node_modules',
  'dist',
  'build',
  'target',
  'out',
  'coverage'
]);

/** True when a directory entry name must be skipped by the scan. */
export function isIgnoredDir(name: string): boolean {
  return IGNORED_DIRS.has(name.toLowerCase());
}

export interface RepoScanStats {
  fileCount: number;
  lineCount: number;
  files: string[];
  /** Issue 24: XML resources are indexed for MyBatis mapper extraction. */
  xmlFileCount: number;
  /** v0.6.0: source files classified as LARGE_GENERATED_FILE. */
  largeFiles: string[];
}

/**
 * A Maven module declared by the parent pom.xml `<modules>` block, verified to
 * actually exist under the repo root.
 */
export interface MavenModule {
  name: string;
  /** Module directory relative to the repo root, e.g. `api` (forward slashes). */
  dir: string;
  /** The module's own pom, e.g. `api/pom.xml` (relative, forward slashes). */
  pomPath: string;
}

function exists(filePath: string): Promise<boolean> {
  return fs.access(filePath).then(
    () => true,
    () => false
  );
}

/**
 * Issue 15 — detect the Maven multi-module layout of a repo root:
 * read `pom.xml`, parse its `<modules>` declarations, and return, in declared
 * order, every module whose `<root>/<name>/pom.xml` actually exists. A declared
 * module without its own pom is skipped (e.g. a file-based `pom` artifact).
 */
export async function detectMavenModules(root: string): Promise<MavenModule[]> {
  const rootPom = path.join(root, 'pom.xml');
  if (!(await exists(rootPom))) return [];
  let source: string;
  try {
    source = await fs.readFile(rootPom, 'utf8');
  } catch {
    return [];
  }
  const declared = parsePomModules(source);
  if (declared.length === 0) return []; // single-module repo → not a reactor root

  const modules: MavenModule[] = [];
  for (const module of declared) {
    if (!/^[^/\\]+$/.test(module.name)) continue; // reject path traversal-ish names
    const pomPath = path.join(module.name, 'pom.xml');
    if (await exists(path.join(root, pomPath))) {
      modules.push({
        name: module.name,
        dir: module.name,
        pomPath: pomPath.split(path.sep).join('/')
      });
    }
  }
  return modules;
}

/**
 * Issue 15 — the standard Maven source roots of every detected module:
 * `<module>/src/main/java` and `<module>/src/main/resources` that exist on disk,
 * as relative paths (forward slashes). Mirrors the layout `scanRepo` already
 * indexes recursively, made explicit for module-level bookkeeping and tests.
 */
export async function mavenSourceRoots(
  root: string,
  modules: MavenModule[]
): Promise<Array<{ module: string; path: string }>> {
  const out: Array<{ module: string; path: string }> = [];
  for (const module of modules) {
    for (const rel of ['src/main/java', 'src/main/resources']) {
      const dirPath = path.join(root, module.dir, rel);
      if (await exists(dirPath)) out.push({ module: module.name, path: rel });
    }
  }
  return out;
}

function countLines(content: string): number {
  if (content === '') return 0;
  const newlines = content.match(/\r?\n/g)?.length ?? 0;
  return newlines + (content.endsWith('\n') ? 0 : 1);
}

export async function scanRepo(root: string): Promise<RepoScanStats> {
  let fileCount = 0;
  let lineCount = 0;
  let xmlFileCount = 0;
  const files: string[] = [];
  const largeFiles: string[] = [];
  const stack = [root];

  while (stack.length > 0) {
    const dir = stack.pop()!;
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        if (!isIgnoredDir(entry.name)) stack.push(path.join(dir, entry.name));
        continue;
      }
      if (!entry.isFile()) continue;

      fileCount += 1;
      const filePath = path.join(dir, entry.name);
      files.push(filePath);
      if (entry.name.toLowerCase().endsWith('.xml')) xmlFileCount += 1;
      if (fileCount > MAX_FILES) {
        return { fileCount, lineCount, files, xmlFileCount, largeFiles };
      }

      const extension = path.extname(entry.name.toLowerCase());
      if (!SOURCE_EXTENSIONS.has(extension)) continue;
      try {
        const content = await fs.readFile(filePath, 'utf8');
        const fileLines = countLines(content);
        lineCount += fileLines;
        const maxLineLength = content
          .split(/\r?\n/)
          .reduce((max, line) => Math.max(max, line.length), 0);
        if (
          fileLines > LARGE_FILE_LINE_LIMIT ||
          maxLineLength > LARGE_FILE_LINE_LENGTH_LIMIT
        ) {
          largeFiles.push(filePath);
        }
      } catch {
        // Unreadable files still count toward the index limit.
      }
      if (lineCount > MAX_LINES) {
        return { fileCount, lineCount, files, xmlFileCount, largeFiles };
      }
    }
  }

  return { fileCount, lineCount, files, xmlFileCount, largeFiles };
}

/**
 * v0.5.1 (D1) — suggest importable subdirectories when a whole repo trips the
 * file/line budget. Only directories that actually exist at the repo root are
 * returned, in canonical order: `src`, `packages`, `apps`.
 */
export async function detectSuggestedSubdirs(root: string): Promise<string[]> {
  const out: string[] = [];
  for (const name of ['src', 'packages', 'apps']) {
    const stat = await fs.stat(path.join(root, name)).catch(() => null);
    if (stat?.isDirectory()) out.push(name);
  }
  return out;
}

export interface RepoPreviewStats {
  fileCount: number;
  javaFileCount: number;
  webFileCount: number;
  goFileCount: number;
  pythonFileCount: number;
  xmlFileCount: number;
  skippedDirCount: number;
  skippedDirs: string[];
}

/**
 * Issue 24 (Round 2 B4) — read-only pre-import preview: count what the real
 * scan would index and which ignored directories it would skip, without
 * reading file contents. This gives the import dialog a fast "N files /
 * M dirs skipped" answer before a full index starts.
 */
export async function previewRepo(root: string): Promise<RepoPreviewStats> {
  const stat = await fs.stat(root).catch(() => null);
  if (!stat?.isDirectory()) {
    throw new Error(`local path is not a directory: ${root}`);
  }

  let fileCount = 0;
  let javaFileCount = 0;
  let webFileCount = 0;
  let goFileCount = 0;
  let pythonFileCount = 0;
  let xmlFileCount = 0;
  let skippedDirCount = 0;
  const skippedDirs = new Set<string>();
  const stack = [root];

  while (stack.length > 0) {
    const dir = stack.pop()!;
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        if (isIgnoredDir(entry.name)) {
          skippedDirCount += 1;
          skippedDirs.add(entry.name.toLowerCase());
        } else {
          stack.push(path.join(dir, entry.name));
        }
        continue;
      }
      if (!entry.isFile()) continue;

      fileCount += 1;
      if (entry.name.toLowerCase().endsWith('.java')) javaFileCount += 1;
      const extension = path.extname(entry.name.toLowerCase());
      if (WEB_FILE_EXTENSIONS.has(extension)) webFileCount += 1;
      if (GO_FILE_EXTENSIONS.has(extension)) goFileCount += 1;
      if (PYTHON_FILE_EXTENSIONS.has(extension)) pythonFileCount += 1;
      if (entry.name.toLowerCase().endsWith('.xml')) xmlFileCount += 1;
      if (fileCount > MAX_FILES) {
        return {
          fileCount,
          javaFileCount,
          webFileCount,
          goFileCount,
          pythonFileCount,
          xmlFileCount,
          skippedDirCount,
          skippedDirs: [...skippedDirs].sort()
        };
      }
    }
  }

  return {
    fileCount,
    javaFileCount,
    webFileCount,
    goFileCount,
    pythonFileCount,
    xmlFileCount,
    skippedDirCount,
    skippedDirs: [...skippedDirs].sort()
  };
}
