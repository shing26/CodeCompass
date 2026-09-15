import fs from 'node:fs/promises';
import path from 'node:path';
import type { RepoSymbol } from './repoqa-repos';

export type MapperStatementKind = 'select' | 'insert' | 'update' | 'delete';

export interface MapperStatement {
  id: string;
  kind: MapperStatementKind;
  lineStart: number;
  lineEnd: number;
  /** Normalized SQL text of the statement body, suitable for evidence display. */
  sqlSummary: string;
}

export interface MapperFile {
  /** Repo-root-relative path, forward slashes. */
  filePath: string;
  /** Mapper interface fully-qualified name from `namespace="..."`. */
  namespace: string;
  lineStart: number;
  lineEnd: number;
  statements: MapperStatement[];
}

const STATEMENT_RE =
  /<(select|insert|update|delete)\b([^>]*)>([\s\S]*?)<\/(?:select|insert|update|delete)>/g;

function lineAt(source: string, offset: number | undefined): number | undefined {
  if (offset === undefined) return undefined;
  let line = 1;
  for (let index = 0; index < offset; index += 1) {
    if (source.charCodeAt(index) === 10) line += 1;
  }
  return line;
}

function attributeValue(attrs: string, name: string): string | undefined {
  const match = new RegExp(`\\b${name}\\s*=\\s*["']([^"']+)["']`).exec(attrs);
  return match?.[1];
}

/**
 * v0.7 — dynamic-tag census injected into the summary header so MyBatis
 * `<choose>/<foreach>/<if>` structure survives flattening. Runtime semantics
 * stay out of scope (unchanged): this only preserves the *shape*.
 */
const DYNAMIC_TAG_NAMES = [
  'choose',
  'when',
  'otherwise',
  'foreach',
  'if',
  'where',
  'trim',
  'set'
] as const;

function dynamicTagCensus(body: string): string {
  const parts: string[] = [];
  for (const tag of DYNAMIC_TAG_NAMES) {
    const matches = body.match(new RegExp(`<${tag}\\b`, 'g'));
    if (matches && matches.length > 0) parts.push(`${tag}×${matches.length}`);
  }
  return parts.length > 0 ? `[dynamic: ${parts.join(', ')}] ` : '';
}

function summarizeSql(body: string): string {
  const census = dynamicTagCensus(body);
  return (
    census +
    body
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<!\[CDATA\[|\]\]>/g, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  ).slice(0, 1024);
}

/**
 * Deterministic MyBatis mapper extractor. It is intentionally tolerant of
 * comments, CDATA and dynamic `<where>/<if>` fragments: the parser only needs
 * the mapper namespace, statement ids, line numbers and a normalized SQL
 * summary — never the resolved SQL runtime semantics.
 */
export function parseMapperXml(
  source: string,
  filePath = 'mapper.xml'
): MapperFile | null {
  const mapperStartRe = /<mapper\b[^>]*>/g;
  let mapperMatch: RegExpExecArray | null;

  while ((mapperMatch = mapperStartRe.exec(source)) !== null) {
    const namespace = attributeValue(mapperMatch[0], 'namespace');
    if (!namespace) continue;

    const mapperOpenEnd = source.indexOf('>', mapperMatch.index) + 1;
    const mapperClose = source.indexOf('</mapper>', mapperOpenEnd);
    const blockEnd = mapperClose >= 0 ? mapperClose : source.length;
    const block = source.slice(mapperMatch.index, blockEnd);
    const statements: MapperStatement[] = [];

    STATEMENT_RE.lastIndex = 0;
    let statementMatch: RegExpExecArray | null;
    while ((statementMatch = STATEMENT_RE.exec(block)) !== null) {
      const kind = statementMatch[1] as MapperStatementKind;
      const id = attributeValue(statementMatch[2], 'id');
      if (!id) continue;

      const openAbs = mapperMatch.index + statementMatch.index;
      const openEnd = source.indexOf('>', openAbs) + 1;
      const closeTag = `</${kind}>`;
      const closeIndex = source.indexOf(closeTag, openEnd);
      statements.push({
        id,
        kind,
        lineStart: lineAt(source, openAbs) ?? 1,
        lineEnd: lineAt(source, closeIndex) ?? lineAt(source, openAbs) ?? 1,
        sqlSummary: summarizeSql(statementMatch[3])
      });
    }

    if (statements.length > 0) {
      return {
        filePath,
        namespace,
        lineStart: lineAt(source, mapperMatch.index) ?? 1,
        lineEnd:
          lineAt(source, mapperClose) ?? lineAt(source, mapperMatch.index) ?? 1,
        statements
      };
    }
  }

  return null;
}

/**
 * Index every mapper XML under a repo into two symbol families:
 * - `mapper` — one node per file/namespace, nested under the XML file in the
 *   sidebar symbol tree;
 * - `sql` — one node per `<select|insert|update|delete id="...">`, carrying the
 *   statement line range and SQL summary.
 */
export async function extractMapperSymbols(
  repoId: string,
  root: string,
  files: string[]
): Promise<RepoSymbol[]> {
  const symbols: RepoSymbol[] = [];

  for (const filePath of files) {
    if (!filePath.toLowerCase().endsWith('.xml')) continue;
    let source: string;
    try {
      source = await fs.readFile(filePath, 'utf8');
    } catch {
      continue;
    }
    const relativePath = path.relative(root, filePath).split(path.sep).join('/');
    const mapper = parseMapperXml(source, relativePath);
    if (!mapper) continue;

    const simpleNamespace = mapper.namespace.split('.').pop() ?? mapper.namespace;
    symbols.push({
      repoId,
      kind: 'mapper',
      name: simpleNamespace,
      filePath: relativePath,
      lineStart: mapper.lineStart,
      lineEnd: mapper.lineEnd,
      signature: `mapper ${mapper.namespace}`,
      displayPath: mapper.namespace
    });

    for (const statement of mapper.statements) {
      symbols.push({
        repoId,
        kind: 'sql',
        name: statement.id,
        filePath: relativePath,
        parentType: simpleNamespace,
        lineStart: statement.lineStart,
        lineEnd: statement.lineEnd,
        signature: `${statement.kind} ${statement.id}: ${statement.sqlSummary}`,
        displayPath: `${mapper.namespace}#${statement.id}`
      });
    }
  }

  return symbols;
}
