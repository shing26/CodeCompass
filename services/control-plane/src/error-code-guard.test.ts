import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ERROR_CODE_LIST } from '../../../packages/contracts/src/index';

/**
 * Issue 10 (外部评审 C4) — server-side error-code guard.
 *
 * The contract table lives once in packages/contracts/src/error-codes.ts; the
 * frontend copy is compile-fenced by Record<ErrorCode, string>. The server has
 * ~38 `code: '<literal>'` emission points with no single chokepoint, so this
 * guard takes the copy-guard approach (string-region scan over src): any code
 * literal emitted outside the contract turns red here instead of silently
 * bypassing the doc and the frontend copy.
 *
 * Adding a code: contracts ERROR_CODES → frontend ERROR_COPY → CONTEXT.md —
 * all three steps are enforced (typecheck / this guard / the doc-parity test).
 */

const SRC = join(process.cwd(), 'src');
if (!existsSync(join(SRC, 'http-error.ts'))) {
  throw new Error('error-code-guard.test.ts 必须从 services/control-plane 包根执行（当前 cwd 无 src/http-error.ts）');
}

/** Recursively collect .ts files; tests are exempt (fixtures may carry anything). */
function collectTsFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      if (entry === 'node_modules' || entry === '.mimosa') continue;
      collectTsFiles(full, out);
    } else if (entry.endsWith('.ts') && !entry.endsWith('.test.ts')) {
      out.push(full);
    }
  }
  return out;
}

/** `code: '<literal>'` — the one emission shape the scan recognizes. */
const CODE_LITERAL_RE = /code:\s*'([a-z][a-z_]+)'/g;

describe('error-code guard (issue 10)', () => {
  it('every emitted `code:` literal is in the contracts table', () => {
    const offenders: Array<{ file: string; line: number; code: string }> = [];
    for (const file of collectTsFiles(SRC)) {
      const text = readFileSync(file, 'utf-8');
      for (const match of text.matchAll(CODE_LITERAL_RE)) {
        if (!ERROR_CODE_LIST.includes(match[1] as never)) {
          const line = text.slice(0, match.index ?? 0).split('\n').length;
          offenders.push({ file: file.replace(SRC, 'src'), line, code: match[1] });
        }
      }
    }
    expect(
      offenders,
      `表外错误码（先入 packages/contracts/src/error-codes.ts，再补前端 copy 与 CONTEXT.md 表）：` +
        offenders.map((o) => `${o.file}:${o.line} '${o.code}'`).join(', ')
    ).toEqual([]);
  });

  it('the guard itself recognizes the known emission shapes', () => {
    // Fresh regex per probe: a /g-flagged regex keeps lastIndex across exec
    // calls and would silently skip probes.
    const literal = (s: string) => new RegExp(CODE_LITERAL_RE.source).exec(s)?.[1];
    // Shape 1: plain literal (the ~37 emission points).
    expect(literal("res.status(400).json({ error: 'x', code: 'invalid_json' });")).toBe('invalid_json');
    // Shape 2 (the R1 middleware ternary) is compile-fenced via ERROR_CODES in
    // http-error.ts and therefore carries no literal for this scan to miss.
    expect("code: status < 500 ? ERROR_CODES.request_error : ERROR_CODES.internal_error").toMatch(/ERROR_CODES\./);
    // Error message strings with spaces must not be captured.
    expect(literal("res.status(404).json({ error: 'invalid JSON body', code: 'invalid_json' });")).toBe('invalid_json');
  });

  it('every contract code appears in the CONTEXT.md Error Code Contract table (issue 10)', () => {
    // 契约单一源 ↔ Markdown 表双向对账：改表不改码（或反之）在这里红。
    // 放在 cp 侧因为要读文件（web 的浏览器 tsconfig 无 node 类型）。
    // cwd 纪律与本文件顶部自检一致：从 services/control-plane 包根执行。
    const repoRoot = join(process.cwd(), '..', '..');
    const doc = readFileSync(join(repoRoot, 'CONTEXT.md'), 'utf-8');
    const tableStart = doc.indexOf('## Error Code Contract');
    expect(tableStart).toBeGreaterThan(-1);
    const table = doc.slice(tableStart, doc.indexOf('## Open Decisions'));
    const missing = ERROR_CODE_LIST.filter((code) => !table.includes(`\`${code}\``));
    expect(
      missing,
      `CONTEXT.md「Error Code Contract」表缺码（新码三处同动：contracts → ERROR_COPY → CONTEXT.md）`
    ).toEqual([]);
  });
});
