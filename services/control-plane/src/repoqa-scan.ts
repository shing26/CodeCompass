import fs from 'node:fs/promises';
import path from 'node:path';
import { parsePomModules } from './repoqa-parser';

export const MAX_FILES = 3000;
export const MAX_LINES = 500_000;

const IGNORED_DIRS = new Set([
  '.git',
  'node_modules',
  'dist',
  'build',
  'target',
  'out',
  '.idea',
  '.vscode',
  'coverage'
]);

export interface RepoScanStats {
  fileCount: number;
  lineCount: number;
  files: string[];
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
  const files: string[] = [];
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
        if (!IGNORED_DIRS.has(entry.name)) stack.push(path.join(dir, entry.name));
        continue;
      }
      if (!entry.isFile()) continue;

      fileCount += 1;
      const filePath = path.join(dir, entry.name);
      files.push(filePath);
      if (fileCount > MAX_FILES) return { fileCount, lineCount, files };

      try {
        const content = await fs.readFile(filePath, 'utf8');
        lineCount += countLines(content);
      } catch {
        // Unreadable files still count toward the index limit.
      }
      if (lineCount > MAX_LINES) return { fileCount, lineCount, files };
    }
  }

  return { fileCount, lineCount, files };
}
