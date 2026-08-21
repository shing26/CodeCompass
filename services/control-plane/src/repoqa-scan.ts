import fs from 'node:fs/promises';
import path from 'node:path';

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
