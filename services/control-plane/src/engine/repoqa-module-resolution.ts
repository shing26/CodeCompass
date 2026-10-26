import path from 'node:path';

/**
 * v1.6 票 04 — L1 模块消解表（相对路径 import），ADR-0022 决定 2。
 *
 * 只回答一件事：**调用方文件通过 import 声明，把某个名字绑到了哪个文件**。
 * 证据只来自代码自己写的声明，不做类型推断、不猜目录。
 *
 * 本票只做 L1：`./x`、`../y` 这类相对 specifier。L2（tsconfig `paths`/`baseUrl`）
 * 与 L3（bare package specifier）不在射程内——后者按定义属于仓外或包名互引，
 * 留在既有 EXTERNAL/UNRESOLVED 语义里。
 *
 * 路径口径与 symbol.filePath 一致：仓根相对的 posix 路径、**带扩展名**。
 */

const TS_JS_EXT = /\.(ts|tsx|js|jsx|mjs|cjs)$/;

/** 候选后缀顺序即优先级：显式文件 → 各种扩展名 → 目录 index。 */
export const RESOLVE_SUFFIXES = [
  '',
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '/index.ts',
  '/index.tsx',
  '/index.js',
  '/index.jsx',
  '/index.mjs'
];

export interface ModuleImportBinding {
  /** 调用方文件里的本地名（named/default/namespace 三种绑定的名字）。 */
  localName: string;
  /** 声明该名字的文件（`export * from` 已展开到真正的声明文件）。 */
  target: string;
  kind: 'named' | 'default' | 'namespace';
}

export interface ModuleImportTable {
  /** callerFile → localName → 绑定；同一个本地名重复声明时保留第一条。 */
  imports: Map<string, Map<string, ModuleImportBinding>>;
  stats: {
    files: number;
    declarations: number;
    resolvedSpecifiers: number;
    unresolvedSpecifiers: number;
    bindings: number;
  };
}

interface ParsedDeclarations {
  namedImports: Array<{ specifier: string; localName: string; importedName: string }>;
  defaultImports: Array<{ specifier: string; localName: string }>;
  namespaceImports: Array<{ specifier: string; localName: string }>;
  /** 本文件直接声明的导出名（`export const x` / `export { a as b }` 的 b）。 */
  localExports: string[];
  /** `export { a as b } from './x'`。 */
  reexportNamed: Array<{ specifier: string; names: Array<{ imported: string; exported: string }> }>;
  /** `export * from './x'`。 */
  reexportStar: string[];
}

/** `import { a, b as c, type T } from './x'` —— type 项跳过（类型名不会被调用）。 */
const NAMED_IMPORT_RE =
  /import\s+(?!type\b)(?:[A-Za-z_$][\w$]*\s*,\s*)?\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/g;
/** `import Foo from './x'` 与 `import Foo, { a } from './x'` 与 `import Foo, * as ns from './x'`。 */
const DEFAULT_IMPORT_RE =
  /import\s+(?!type\b)([A-Za-z_$][\w$]*)\s*(?:,\s*(?:\{[^}]*\}|\*\s+as\s+[A-Za-z_$][\w$]*))?\s*from\s*['"]([^'"]+)['"]/g;
/** `import * as ns from './x'`。 */
const NAMESPACE_IMPORT_RE = /import\s+(?!type\b)\*\s+as\s+([A-Za-z_$][\w$]*)\s+from\s*['"]([^'"]+)['"]/g;
/** `export const x` / `export function f` / `export class C` / `export interface I` 等。 */
const LOCAL_EXPORT_RE =
  /export\s+(?:declare\s+)?(?:default\s+)?(?:async\s+)?(?:const|let|var|function|class|interface|enum|type|abstract\s+class)\s+([A-Za-z_$][\w$]*)/g;
/** `export { a, b as c }`（无 from）——lookahead 必须把末端的空白一起包进去：
 *  写成 `\}\s*(?!from)` 时 `\s*` 会回溯到零字符、从空格处通过，把
 *  `export { a } from './x'` 也误当成本地导出。 */
const EXPORT_LIST_RE = /export\s*\{([^}]*)\}(?!\s*from\b)/g;
/** `export { a as b } from './x'`。 */
const REEXPORT_NAMED_RE = /export\s*\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/g;
/** `export * from './x'`（含 `export * as ns from` 的退化：只记来源，不记名字）。 */
const REEXPORT_STAR_RE = /export\s*\*\s*(?:as\s+[A-Za-z_$][\w$]*\s*)?from\s*['"]([^'"]+)['"]/g;

/** 把 `{ a, b as c }` 的成员列表解析成 [{ imported, local }]，跳过 `type X` 项。 */
function parseSpecifierList(raw: string): Array<{ imported: string; local: string }> {
  const out: Array<{ imported: string; local: string }> = [];
  for (const piece of raw.split(',')) {
    const item = piece.trim();
    if (!item || item.startsWith('type ')) continue;
    const alias = item.split(/\s+as\s+/);
    const imported = alias[0]?.trim();
    const local = (alias[1] ?? alias[0])?.trim();
    if (imported && local && /^[A-Za-z_$][\w$]*$/.test(imported) && /^[A-Za-z_$][\w$]*$/.test(local)) {
      out.push({ imported, local });
    }
  }
  return out;
}

/** 只认声明语句的轻量解析——不做类型推断，不做作用域分析。 */
export function parseModuleDeclarations(source: string): ParsedDeclarations {
  const namedImports: ParsedDeclarations['namedImports'] = [];
  const defaultImports: ParsedDeclarations['defaultImports'] = [];
  const namespaceImports: ParsedDeclarations['namespaceImports'] = [];
  const localExports: string[] = [];
  const reexportNamed: ParsedDeclarations['reexportNamed'] = [];
  const reexportStar: string[] = [];

  for (const match of source.matchAll(NAMED_IMPORT_RE)) {
    for (const item of parseSpecifierList(match[1])) {
      namedImports.push({ specifier: match[2], localName: item.local, importedName: item.imported });
    }
  }
  for (const match of source.matchAll(DEFAULT_IMPORT_RE)) {
    defaultImports.push({ specifier: match[2], localName: match[1] });
  }
  for (const match of source.matchAll(NAMESPACE_IMPORT_RE)) {
    namespaceImports.push({ specifier: match[2], localName: match[1] });
  }
  for (const match of source.matchAll(LOCAL_EXPORT_RE)) {
    localExports.push(match[1]);
  }
  for (const match of source.matchAll(EXPORT_LIST_RE)) {
    for (const item of parseSpecifierList(match[1])) localExports.push(item.local);
  }
  for (const match of source.matchAll(REEXPORT_NAMED_RE)) {
    const names = parseSpecifierList(match[1]).map((item) => ({ imported: item.imported, exported: item.local }));
    if (names.length) reexportNamed.push({ specifier: match[2], names });
  }
  for (const match of source.matchAll(REEXPORT_STAR_RE)) {
    reexportStar.push(match[1]);
  }

  // 去重（同一名字可能被多条正则命中，如 `export const` 与 `export {}` 不重叠，但保险）。
  return {
    namedImports,
    defaultImports,
    namespaceImports,
    localExports: [...new Set(localExports)],
    reexportNamed,
    reexportStar: [...new Set(reexportStar)]
  };
}

/** 相对 specifier → 仓内文件；解析不到返回 null（不猜、不报错）。 */
export function resolveRelativeSpecifier(
  fromFile: string,
  specifier: string,
  fileSet: ReadonlySet<string>
): string | null {
  if (!specifier.startsWith('.')) return null; // L2/L3 不在本票射程
  const joined = path.posix.normalize(path.posix.join(path.posix.dirname(fromFile), specifier));
  if (joined.startsWith('..') || path.posix.isAbsolute(joined)) return null; // 出仓
  const base = joined.endsWith('/') ? joined.slice(0, -1) : joined;
  for (const suffix of RESOLVE_SUFFIXES) {
    const candidate = base + suffix;
    if (fileSet.has(candidate)) return candidate;
  }
  return null;
}

/**
 * 某个文件导出的名字集合（含 `export *` 的传递展开）。用于把
 * `import { x } from './barrel'` 追到真正声明 x 的文件。
 */
function exportedNames(
  file: string,
  parsed: Map<string, ParsedDeclarations>,
  fileSet: ReadonlySet<string>,
  seen: Set<string> = new Set()
): Set<string> {
  const names = new Set<string>();
  if (seen.has(file)) return names; // 循环再导出的护栏
  seen.add(file);
  const decl = parsed.get(file);
  if (!decl) return names;
  for (const name of decl.localExports) names.add(name);
  for (const reexport of decl.reexportNamed) {
    const target = resolveRelativeSpecifier(file, reexport.specifier, fileSet);
    if (!target) continue;
    for (const entry of reexport.names) names.add(entry.exported);
  }
  for (const specifier of decl.reexportStar) {
    const target = resolveRelativeSpecifier(file, specifier, fileSet);
    if (!target) continue;
    for (const name of exportedNames(target, parsed, fileSet, seen)) names.add(name);
  }
  return names;
}

/** `import { x } from './barrel'` 里 x 真正的声明文件；找不到就退回 barrel 本身。 */
function declaringFile(
  file: string,
  name: string,
  parsed: Map<string, ParsedDeclarations>,
  fileSet: ReadonlySet<string>,
  seen: Set<string> = new Set()
): string {
  if (seen.has(file)) return file;
  seen.add(file);
  const decl = parsed.get(file);
  if (!decl) return file;
  if (decl.localExports.includes(name)) return file;
  for (const reexport of decl.reexportNamed) {
    const entry = reexport.names.find((candidate) => candidate.exported === name);
    if (!entry) continue;
    const target = resolveRelativeSpecifier(file, reexport.specifier, fileSet);
    if (target) return declaringFile(target, entry.imported, parsed, fileSet, seen);
  }
  for (const specifier of decl.reexportStar) {
    const target = resolveRelativeSpecifier(file, specifier, fileSet);
    if (!target) continue;
    if (exportedNames(target, parsed, fileSet).has(name)) {
      return declaringFile(target, name, parsed, fileSet, seen);
    }
  }
  return file;
}

/**
 * 构建消解表。默认自己读文件（worker/探针用）；测试可注入 readFile。
 * 只扫 TS/JS 家族——Go/Java 的跨文件关系走包结构，不归本表管（ADR-0022 决定 5）。
 */
export async function buildModuleImportTable(options: {
  files: string[];
  readFile?: (file: string) => Promise<string>;
}): Promise<ModuleImportTable> {
  const { files } = options;
  const readFile = options.readFile ?? (async () => '');
  const fileSet = new Set(files);
  const tsFiles = files.filter((file) => TS_JS_EXT.test(file));

  const parsed = new Map<string, ParsedDeclarations>();
  for (const file of tsFiles) {
    const source = await readFile(file);
    if (source) parsed.set(file, parseModuleDeclarations(source));
  }

  const imports = new Map<string, Map<string, ModuleImportBinding>>();
  const stats = {
    files: tsFiles.length,
    declarations: 0,
    resolvedSpecifiers: 0,
    unresolvedSpecifiers: 0,
    bindings: 0
  };
  const resolvedCache = new Map<string, string | null>();
  const resolve = (from: string, specifier: string): string | null => {
    const key = from + '\u0000' + specifier;
    if (!resolvedCache.has(key)) {
      resolvedCache.set(key, resolveRelativeSpecifier(from, specifier, fileSet));
    }
    const hit = resolvedCache.get(key) ?? null;
    if (hit) stats.resolvedSpecifiers += 1;
    else stats.unresolvedSpecifiers += 1;
    return hit;
  };

  for (const file of tsFiles) {
    const decl = parsed.get(file);
    if (!decl) continue;
    const local = new Map<string, ModuleImportBinding>();
    stats.declarations +=
      decl.namedImports.length + decl.defaultImports.length + decl.namespaceImports.length;

    for (const entry of decl.namedImports) {
      const target = resolve(file, entry.specifier);
      if (!target) continue;
      if (!local.has(entry.localName)) {
        local.set(entry.localName, {
          localName: entry.localName,
          target: declaringFile(target, entry.importedName, parsed, fileSet),
          kind: 'named'
        });
      }
    }
    for (const entry of decl.defaultImports) {
      const target = resolve(file, entry.specifier);
      if (!target) continue;
      if (!local.has(entry.localName)) {
        local.set(entry.localName, { localName: entry.localName, target, kind: 'default' });
      }
    }
    for (const entry of decl.namespaceImports) {
      const target = resolve(file, entry.specifier);
      if (!target) continue;
      if (!local.has(entry.localName)) {
        local.set(entry.localName, { localName: entry.localName, target, kind: 'namespace' });
      }
    }
    if (local.size) {
      imports.set(file, local);
      stats.bindings += local.size;
    }
  }

  return { imports, stats };
}

/**
 * 票 05 的接线判据：某个调用名在调用方文件里是否被 import 唯一绑定到某个文件。
 * namespace 导入不参与（它给的是模块对象，不是名字 → 需要再走导出表）。
 */
export function pinnableTarget(
  table: ModuleImportTable,
  callerFile: string,
  name: string
): string | null {
  const binding = table.imports.get(callerFile)?.get(name);
  if (!binding) return null;
  if (binding.kind === 'namespace') return null;
  return binding.target;
}
