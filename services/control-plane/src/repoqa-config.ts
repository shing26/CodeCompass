import fs from 'node:fs/promises';
import path from 'node:path';
import type { RepoSymbol } from './repoqa-repos';

/**
 * Issue 06: deterministic config/dependency key scan with line numbers.
 *
 * - application*.yml / application*.yaml → flattened dot-paths per mapping line
 *   (`server`, `server.port`, `spring.datasource.password`), never the values.
 * - application*.properties → `key=value` / `key:value` left-hand sides.
 * - pom.xml → one config key per <dependency> block: `groupId:artifactId`
 *   (+ ` (scope)` when a non-compile scope is declared), located at the
 *   <artifactId> tag line, ending at the closing </dependency> tag.
 */

export interface ScannedKey {
  name: string;
  lineStart: number;
  lineEnd?: number;
}

/** Flatten nested YAML mapping keys into deterministic dot-paths (2-space, 4-space, tabs...). */
export function scanYaml(source: string): ScannedKey[] {
  const keys: ScannedKey[] = [];
  const lines = source.split(/\r?\n/);
  const stack: Array<{ name: string; indent: number }> = [];

  for (let index = 0; index < lines.length; index += 1) {
    const raw = lines[index];
    if (!raw.trim() || raw.trim().startsWith('#')) continue;
    const indent = raw.match(/^\s*/)![0].length;
    // Mapping key `name:` — keep the key side and ignore the value/comment tail.
    const match = /^\s*([A-Za-z0-9._-]+):/.exec(raw);
    if (!match) continue;

    while (stack.length > 0 && indent <= stack[stack.length - 1].indent) {
      stack.pop();
    }
    const key = match[1];
    const fullPath = [...stack.map((entry) => entry.name), key].join('.');
    keys.push({ name: fullPath, lineStart: index + 1 });
    if (stack.length > 0) {
      // Backward-compatible bare leaf key for nested entries, so historical
      // short-key consumers (and the golden dataset) keep resolving.
      keys.push({ name: key, lineStart: index + 1 });
    }
    stack.push({ name: key, indent });
  }
  return keys;
}

/** Parse `key=value` / `key:value` properties, skipping comments/blanks. */
export function scanProperties(source: string): ScannedKey[] {
  const keys: ScannedKey[] = [];
  const lines = source.split(/\r?\n/);
  lines.forEach((line, index) => {
    if (!line.trim() || line.trim().startsWith('#')) return;
    const match = /^\s*([A-Za-z0-9._-]+)\s*[=:]/.exec(line);
    if (match) keys.push({ name: match[1], lineStart: index + 1 });
  });
  return keys;
}

function tagValue(block: string, tag: string): string | undefined {
  const match = new RegExp(`<${tag}>([^<]+)</${tag}>`).exec(block);
  return match?.[1];
}

/** Parse <dependency> blocks into `groupId:artifactId` component keys. */
export function scanPom(source: string): ScannedKey[] {
  const keys: ScannedKey[] = [];
  const depRe = /<dependency>([\s\S]*?)<\/dependency>/g;
  let match: RegExpExecArray | null;
  while ((match = depRe.exec(source)) !== null) {
    const block = match[1];
    const blockStart = match.index;
    const group = tagValue(block, 'groupId');
    const artifact = tagValue(block, 'artifactId');
    const scope = tagValue(block, 'scope');
    if (!group && !artifact) continue;

    const artifactTag = /<artifactId>([^<]+)<\/artifactId>/.exec(block);
    // match[1] starts after the opening <dependency> tag, so offset by tag length.
    const contentStart = blockStart + '<dependency>'.length;
    const keyOffset = artifactTag ? contentStart + artifactTag.index : contentStart;
    let name = group && artifact ? `${group}:${artifact}` : artifact ?? group!;
    if (scope && scope !== 'compile') name += ` (${scope})`;

    const closeIndex = source.indexOf('</dependency>', blockStart);
    keys.push({
      name,
      lineStart: lineAt(source, keyOffset) ?? 1,
      lineEnd: closeIndex >= 0 ? lineAt(source, closeIndex) : undefined
    });
  }
  return keys;
}

const INTENT_RULES: Array<{ triggers: string[]; keyTerms: string[] }> = [
  {
    triggers: ['端口', 'port'],
    keyTerms: ['port']
  },
  {
    triggers: ['数据库', '数据源', 'database', 'datasource', 'jdbc', '连接'],
    keyTerms: ['datasource', 'database', 'jdbc', 'db', 'url', 'host', 'username']
  },
  {
    // pom dependency component keys always contain ':' (groupId:artifactId).
    triggers: ['依赖', '组件', 'dependency', 'dependencies', 'starter', 'artifact', 'pom'],
    keyTerms: [':']
  },
  {
    triggers: ['密码', '密钥', 'secret', 'password', 'credential', 'token', 'apikey', 'api-key'],
    keyTerms: [
      'password',
      'secret',
      'token',
      'credential',
      'apikey',
      'api-key',
      'access-key',
      'client-secret'
    ]
  }
];

/**
 * Deterministically pick the config keys relevant to an environment query.
 * English words in the question filter key names; Chinese intent categories map
 * to key term sets; a query with no recognizable intent falls back to all keys.
 */
export function matchConfigSymbols(
  question: string,
  configs: RepoSymbol[]
): RepoSymbol[] {
  const q = question.toLowerCase();
  const words = (q.match(/[a-z_$][\w$]*/g) ?? []).filter((word) => word.length > 1);
  if (words.length > 0) {
    const byWord = configs.filter((symbol) =>
      words.some((word) => symbol.name.toLowerCase().includes(word))
    );
    if (byWord.length > 0) return byWord;
  }
  const rule = INTENT_RULES.find((candidate) =>
    candidate.triggers.some((trigger) => q.includes(trigger))
  );
  if (rule) {
    return configs.filter((symbol) => {
      const name = symbol.name.toLowerCase();
      return rule.keyTerms.some((term) => name.includes(term));
    });
  }
  return configs;
}

export async function extractConfigSymbols(
  repoId: string,
  root: string,
  files: string[]
): Promise<RepoSymbol[]> {
  const symbols: RepoSymbol[] = [];

  for (const filePath of files) {
    const fileName = path.basename(filePath).toLowerCase();
    const isApplication =
      fileName.startsWith('application') &&
      (/\.ya?ml$/.test(fileName) || fileName.endsWith('.properties'));
    const isPom = fileName === 'pom.xml';
    if (!isApplication && !isPom) continue;

    let source: string;
    try {
      source = await fs.readFile(filePath, 'utf8');
    } catch {
      continue;
    }
    const relativePath = path.relative(root, filePath).split(path.sep).join('/');
    const scanned = isPom
      ? scanPom(source)
      : /\.ya?ml$/.test(fileName)
        ? scanYaml(source)
        : scanProperties(source);

    for (const key of scanned) {
      symbols.push({
        repoId,
        kind: 'config',
        name: key.name,
        filePath: relativePath,
        lineStart: key.lineStart,
        lineEnd: key.lineEnd
      });
    }
  }

  return symbols;
}

function lineAt(source: string, offset: number | undefined): number | undefined {
  if (offset === undefined) return undefined;
  let line = 1;
  for (let index = 0; index < offset; index += 1) {
    if (source.charCodeAt(index) === 10) line += 1;
  }
  return line;
}