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
    // Mapping key `name:` — emit only full dot-paths that carry an explicit value.
    const match = /^\s*([A-Za-z0-9._-]+):/.exec(raw);
    if (!match) continue;

    while (stack.length > 0 && indent <= stack[stack.length - 1].indent) {
      stack.pop();
    }
    const key = match[1];
    const fullPath = [...stack.map((entry) => entry.name), key].join('.');
    const valuePart = (raw.slice(match[0].length) || '').trim();
    const hasValue = valuePart.length > 0 && !valuePart.startsWith('#');
    if (hasValue) {
      keys.push({ name: fullPath, lineStart: index + 1 });
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

function dedupeKeys(keys: ScannedKey[]): ScannedKey[] {
  const seen = new Set<string>();
  const out: ScannedKey[] = [];
  for (const key of keys) {
    const id = `${key.name}:${key.lineStart}`;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(key);
  }
  return out;
}

/** v0.5.1 (D3) — `package.json` dependency names with line numbers. */
export function scanPackageJson(source: string): ScannedKey[] {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(source) as Record<string, unknown>;
  } catch {
    return [];
  }
  const keys: ScannedKey[] = [];
  const seen = new Set<string>();
  for (const section of [
    'dependencies',
    'devDependencies',
    'peerDependencies',
    'optionalDependencies'
  ]) {
    const deps = parsed[section];
    if (!deps || typeof deps !== 'object') continue;
    const marker = `"${section}"`;
    const sectionOffset = source.indexOf(marker);
    if (sectionOffset < 0) continue;
    for (const name of Object.keys(deps as Record<string, unknown>)) {
      if (seen.has(name)) continue;
      seen.add(name);
      const offset = source.indexOf(`"${name}"`, sectionOffset);
      keys.push({ name, lineStart: offset >= 0 ? lineAt(source, offset) ?? 1 : 1 });
    }
  }
  return keys;
}

/** v0.5.1 (D3) — pyproject.toml dependency names (PEP 621 + Poetry + groups). */
export function scanPyprojectToml(source: string): ScannedKey[] {
  const keys: ScannedKey[] = [];
  const lines = source.split(/\r?\n/);
  let section = '';
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const trimmed = line.trim();
    const sectionMatch = /^\s*\[([^\]]+)\]/.exec(line);
    if (sectionMatch) {
      section = sectionMatch[1].trim();
      continue;
    }
    if (!trimmed || trimmed.startsWith('#')) continue;
    const relevant =
      section === 'project' ||
      section === 'tool.poetry.dependencies' ||
      section === 'dependency-groups' ||
      section.startsWith('project.optional-dependencies') ||
      section.startsWith('tool.poetry.group');
    if (!relevant) continue;

    if (section === 'project') {
      if (/^dependencies\s*=/.test(trimmed)) {
        for (let scan = index; scan < lines.length; scan += 1) {
          for (const match of lines[scan].matchAll(/"([^"]+)"/g)) {
            const name = match[1].split(/[<>=!~;[]/)[0].trim();
            if (name) keys.push({ name, lineStart: scan + 1 });
          }
          if (lines[scan].includes(']')) break;
        }
      }
      continue;
    }
    if (section === 'tool.poetry.dependencies') {
      const match = /^"?([A-Za-z0-9_.-]+)"?\s*=\s*/.exec(trimmed);
      if (match && match[1] !== 'python') {
        keys.push({ name: match[1], lineStart: index + 1 });
      }
      continue;
    }
    for (const match of trimmed.matchAll(/"([^"]+)"/g)) {
      const name = match[1].split(/[<>=!~;[]/)[0].trim();
      if (name) keys.push({ name, lineStart: index + 1 });
    }
  }
  return dedupeKeys(keys);
}

/** v0.5.1 (D3) — requirements.txt package names (versions/extras stripped). */
export function scanRequirements(source: string): ScannedKey[] {
  const keys: ScannedKey[] = [];
  source.split(/\r?\n/).forEach((line, index) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('-')) return;
    const name = trimmed.split(/[[<>=!~;]/)[0].trim();
    if (/^[A-Za-z0-9_.-]+$/.test(name)) {
      keys.push({ name, lineStart: index + 1 });
    }
  });
  return keys;
}

/** v0.5.1 (D3) — Pipfile `[packages]` / `[dev-packages]` keys. */
export function scanPipfile(source: string): ScannedKey[] {
  const keys: ScannedKey[] = [];
  let inPackages = false;
  source.split(/\r?\n/).forEach((line, index) => {
    const section = /^\s*\[([^\]]+)\]/.exec(line)?.[1]?.trim();
    if (section === 'packages' || section === 'dev-packages') {
      inPackages = true;
      return;
    }
    if (section) {
      inPackages = false;
      return;
    }
    if (!inPackages) return;
    const match = /^"?([A-Za-z0-9_.-]+)"?\s*=\s*/.exec(line.trim());
    if (match && match[1] !== 'python_version') {
      keys.push({ name: match[1], lineStart: index + 1 });
    }
  });
  return keys;
}

/** v0.5.1 (D4) — `.env` key names only; values are never scanned. */
export function scanEnv(source: string): ScannedKey[] {
  const keys: ScannedKey[] = [];
  source.split(/\r?\n/).forEach((line, index) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    const body = trimmed.startsWith('export ') ? trimmed.slice('export '.length) : trimmed;
    const match = /^([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(body);
    if (match) keys.push({ name: match[1], lineStart: index + 1 });
  });
  return keys;
}

/** v0.5.1 (D4) — `settings.py` / `config.py` top-level assignment keys. */
export function scanPythonSourceConfig(source: string): ScannedKey[] {
  const keys: ScannedKey[] = [];
  source.split(/\r?\n/).forEach((line, index) => {
    const trimmed = line.trim();
    if (
      !trimmed ||
      trimmed.startsWith('#') ||
      trimmed.startsWith('import ') ||
      trimmed.startsWith('from ') ||
      /\b(?:def|class)\s+/.test(trimmed)
    ) {
      return;
    }
    const match = /^([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(trimmed);
    if (match) keys.push({ name: match[1], lineStart: index + 1 });
  });
  return keys;
}

/** v0.5.1 (D4) — `config.ts` top-level exported assignment keys. */
export function scanTypeScriptConfig(source: string): ScannedKey[] {
  const keys: ScannedKey[] = [];
  source.split(/\r?\n/).forEach((line, index) => {
    const trimmed = line.trim();
    const match =
      /^export\s+(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/.exec(trimmed) ??
      /^(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/.exec(trimmed);
    if (match) keys.push({ name: match[1], lineStart: index + 1 });
  });
  return keys;
}

/** v0.5.1 (D4) — `appsettings.json` top-level property names. */
export function scanAppSettingsJson(source: string): ScannedKey[] {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(source) as Record<string, unknown>;
  } catch {
    return [];
  }
  const keys: ScannedKey[] = [];
  for (const name of Object.keys(parsed)) {
    const offset = source.indexOf(`"${name}"`);
    keys.push({ name, lineStart: offset >= 0 ? lineAt(source, offset) ?? 1 : 1 });
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
    const isPackageJson = fileName === 'package.json';
    const isPyproject = fileName === 'pyproject.toml';
    const isRequirements = /^requirements.*\.txt$/.test(fileName);
    const isPipfile = fileName === 'pipfile';
    const isEnv = /^\.env(?:\.example)?$/.test(fileName);
    const isPythonConfig = fileName === 'settings.py' || fileName === 'config.py';
    const isTsConfig = fileName === 'config.ts';
    const isAppSettings = fileName === 'appsettings.json';
    const isDependencyFile =
      isPom || isPackageJson || isPyproject || isRequirements || isPipfile;
    const isConfigFile =
      isApplication || isEnv || isPythonConfig || isTsConfig || isAppSettings;
    if (!isDependencyFile && !isConfigFile) continue;

    let source: string;
    try {
      source = await fs.readFile(filePath, 'utf8');
    } catch {
      continue;
    }
    const relativePath = path.relative(root, filePath).split(path.sep).join('/');
    const scanned = isDependencyFile
      ? isPom
        ? scanPom(source)
        : isPackageJson
          ? scanPackageJson(source)
          : isPyproject
            ? scanPyprojectToml(source)
            : isRequirements
              ? scanRequirements(source)
              : scanPipfile(source)
      : isApplication
        ? /\.ya?ml$/.test(fileName)
          ? scanYaml(source)
          : scanProperties(source)
        : isEnv
          ? scanEnv(source)
          : isPythonConfig
            ? scanPythonSourceConfig(source)
            : isTsConfig
              ? scanTypeScriptConfig(source)
              : scanAppSettingsJson(source);

    for (const key of scanned) {
      symbols.push({
        repoId,
        kind: isDependencyFile ? 'dependency' : 'config',
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
