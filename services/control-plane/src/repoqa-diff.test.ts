import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseArgs, runCli } from './cli';
import {
  analyzeDiff,
  buildMermaid,
  changedLinesFor,
  detectConfigChanges,
  getDiffText,
  parseUnifiedDiff,
  pickModifiedSymbols,
  renderMarkdown,
  type AffectedApiEntry,
  type DiffReport,
  type FileChangedLines
} from './repoqa-diff';
import { parseJavaSource } from './repoqa-parser';
import type { RepoSymbol } from './repoqa-repos';

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */

function gitRun(args: string[], cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('git', args, { cwd, windowsHide: true }, (error, stdout) =>
      error
        ? reject(new Error(`git ${args[0]} failed: ${error.message}`))
        : resolve(stdout)
    );
  });
}

/** Write files, `git init` + commit; returns the commit sha. */
async function makeCommit(
  root: string,
  files: Record<string, string>,
  message: string
): Promise<string> {
  for (const [rel, content] of Object.entries(files)) {
    const file = path.join(root, rel);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, content);
  }
  await gitRun(['init', '-q'], root);
  await gitRun(['config', 'user.email', 'repoqa@test.local'], root);
  await gitRun(['config', 'user.name', 'RepoQA Test'], root);
  await gitRun(['add', '-A'], root);
  await gitRun(['commit', '-q', '-m', message], root);
  return (await gitRun(['rev-parse', 'HEAD'], root)).trim();
}

/** Commit an incremental change on top of an existing repo. */
async function commitMore(
  root: string,
  files: Record<string, string>,
  message: string
): Promise<string> {
  for (const [rel, content] of Object.entries(files)) {
    const file = path.join(root, rel);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, content);
  }
  await gitRun(['add', '-A'], root);
  await gitRun(['commit', '-q', '-m', message], root);
  return (await gitRun(['rev-parse', 'HEAD'], root)).trim();
}

const BASE_CONTROLLER = `package com.demo;

@RestController
public class OrdersController {
  private final OrderService orderService = new OrderService();

  @GetMapping("/api/orders")
  public String listOrders() {
    return orderService.findOrders();
  }

  @GetMapping("/api/orders/{id}")
  public String getOrder(long id) {
    return orderService.findById(id);
  }
}
`;

const BASE_SERVICE = `package com.demo;

@Service
public class OrderService {
  private final OrderRepository orderRepository = new OrderRepository();

  public String findOrders() {
    return orderRepository.findAll();
  }

  public String findById(long id) {
    return orderRepository.findById(id);
  }
}
`;

const BASE_REPOSITORY = `package com.demo;

@Repository
public class OrderRepository {
  public String findAll() {
    return "orders";
  }

  public String findById(long id) {
    return findCached(id);
  }

  public String findCached(long id) {
    return "order-" + id;
  }
}
`;

const BASE_YAML = `app:
  feature:
    enabled: true
`;

const HEAD_REPOSITORY = `package com.demo;

@Repository
public class OrderRepository {
  public String findAll() {
    return "orders-v2"; // 修改底层实现
  }

  public String findById(long id) {
    return "order-" + id; // 内联，删除 findCached
  }
}
`;

const HEAD_YAML = `app:
  feature:
    enabled: false
    newKey: "x"
`;

async function makeFixtureRepo(): Promise<{ root: string; base: string; head: string }> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codecompass-diff-'));
  const base = await makeCommit(
    root,
    {
      'src/main/java/com/demo/OrdersController.java': BASE_CONTROLLER,
      'src/main/java/com/demo/OrderService.java': BASE_SERVICE,
      'src/main/java/com/demo/OrderRepository.java': BASE_REPOSITORY,
      'src/main/resources/application.yml': BASE_YAML
    },
    'base'
  );
  const head = await commitMore(
    root,
    {
      'src/main/java/com/demo/OrderRepository.java': HEAD_REPOSITORY,
      'src/main/resources/application.yml': HEAD_YAML
    },
    'head'
  );
  return { root, base, head };
}

/* ------------------------------------------------------------------ */
/* unified diff 解析                                                   */
/* ------------------------------------------------------------------ */

describe('Issue 22 parseUnifiedDiff', () => {
  it('parses hunks with side line numbers and per-line kinds', () => {
    const text = [
      'diff --git a/src/A.java b/src/A.java',
      'index 1111111..2222222 100644',
      '--- a/src/A.java',
      '+++ b/src/A.java',
      '@@ -10,3 +10,3 @@ public class A {',
      ' context',
      '-old',
      '+new',
      'diff --git a/src/B.java b/src/B.java',
      'new file mode 100644',
      '--- /dev/null',
      '+++ b/src/B.java',
      '@@ -0,0 +1,2 @@',
      '+package b;',
      '+class B {}'
    ].join('\n');

    const files = parseUnifiedDiff(text);
    expect(files).toHaveLength(2);

    const a = files[0];
    expect(a.path).toBe('src/A.java');
    expect(a.status).toBe('M');
    expect(a.oldPath).toBe('src/A.java');
    expect(a.hunks).toHaveLength(1);
    expect(a.hunks[0]).toMatchObject({ oldStart: 10, oldCount: 3, newStart: 10, newCount: 3 });
    expect(a.hunks[0].lines).toEqual([
      { kind: 'ctx', text: 'context' },
      { kind: 'del', text: 'old' },
      { kind: 'add', text: 'new' }
    ]);

    const b = files[1];
    expect(b.path).toBe('src/B.java');
    expect(b.status).toBe('A');
    expect(b.hunks[0]).toMatchObject({ oldStart: 0, oldCount: 0, newStart: 1, newCount: 2 });
    expect(b.hunks[0].lines.every((line) => line.kind === 'add')).toBe(true);
  });

  it('ignores \\ No newline markers and binary noise', () => {
    const text = [
      'diff --git a/f.txt b/f.txt',
      '--- a/f.txt',
      '+++ b/f.txt',
      '@@ -1 +1 @@',
      '-a',
      '\\ No newline at end of file',
      '+b',
      '\\ No newline at end of file'
    ].join('\n');
    const files = parseUnifiedDiff(text);
    expect(files[0].hunks[0].lines).toEqual([
      { kind: 'del', text: 'a' },
      { kind: 'add', text: 'b' }
    ]);
  });
});

/* ------------------------------------------------------------------ */
/* changedLinesFor                                                     */
/* ------------------------------------------------------------------ */

describe('Issue 22 changedLinesFor', () => {
  it('computes hunk spans and exact add/delete lines per side', () => {
    const fileDiff = parseUnifiedDiff(
      [
        'diff --git a/src/A.java b/src/A.java',
        '--- a/src/A.java',
        '+++ b/src/A.java',
        '@@ -10,3 +10,3 @@',
        ' ctx',
        '-old',
        '+new'
      ].join('\n')
    )[0];
    const changed = changedLinesFor(fileDiff);
    expect(changed.newSpans).toEqual([[10, 12]]);
    expect(changed.oldSpans).toEqual([[10, 12]]);
    expect(changed.newLines).toEqual([10, 11, 12]);
    expect(changed.oldLines).toEqual([10, 11, 12]);
    expect(changed.newAddLines).toEqual([11]);
    expect(changed.oldDelLines).toEqual([11]);
  });

  it('skips context-only hunks entirely', () => {
    const fileDiff = parseUnifiedDiff(
      [
        'diff --git a/src/A.java b/src/A.java',
        '--- a/src/A.java',
        '+++ b/src/A.java',
        '@@ -1,2 +1,2 @@',
        ' same',
        ' same'
      ].join('\n')
    )[0];
    const changed = changedLinesFor(fileDiff);
    expect(changed.newSpans).toEqual([]);
    expect(changed.newAddLines).toEqual([]);
  });
});

/* ------------------------------------------------------------------ */
/* pickModifiedSymbols                                                 */
/* ------------------------------------------------------------------ */

describe('Issue 22 pickModifiedSymbols', () => {
  const symbol = (overrides: Partial<RepoSymbol>): RepoSymbol => ({
    repoId: 'repo',
    kind: 'method',
    name: 'm',
    filePath: 'src/A.java',
    lineStart: 5,
    lineEnd: 10,
    parentType: 'A',
    ...overrides
  });
  const changedFor = (spans: Array<[number, number]>): FileChangedLines => ({
    newLines: [],
    oldLines: [],
    newSpans: spans,
    oldSpans: spans,
    newAddLines: [],
    oldDelLines: []
  });

  it('keeps symbols whose span intersects a touched hunk span', () => {
    const symbols = [
      symbol({ name: 'touched', lineStart: 5, lineEnd: 10 }),
      symbol({ name: 'untouched', lineStart: 20, lineEnd: 30 })
    ];
    const changedByFile = new Map([['src/A.java', changedFor([[8, 12]])]]);
    const picked = pickModifiedSymbols(symbols, changedByFile, 'head');
    expect(picked.map((entry) => entry.symbol.name)).toEqual(['touched']);
  });

  it('matches deletions on the base side via old spans', () => {
    const symbols = [symbol({ name: 'deleted', lineStart: 5, lineEnd: 10 })];
    const changedByFile = new Map([['src/A.java', changedFor([[6, 9]])]]);
    const picked = pickModifiedSymbols(symbols, changedByFile, 'base');
    expect(picked).toHaveLength(1);
    expect(picked[0].side).toBe('base');
    expect(picked[0].changedLines).toContain(8);
  });

  it('ignores field/config symbols (handled by their own stages)', () => {
    const symbols = [symbol({ kind: 'field', name: 'x' })];
    const changedByFile = new Map([['src/A.java', changedFor([[5, 10]])]]);
    expect(pickModifiedSymbols(symbols, changedByFile, 'head')).toHaveLength(0);
  });
});

/* ------------------------------------------------------------------ */
/* buildMermaid + renderMarkdown                                       */
/* ------------------------------------------------------------------ */

describe('Issue 22 report rendering', () => {
  const api: AffectedApiEntry = {
    controller: 'OrdersController',
    routeMethod: 'listOrders',
    httpPath: '/api/orders',
    file: 'src/main/java/com/demo/OrdersController.java',
    line: 8,
    impacts: [
      {
        modifiedMethod: 'findAll',
        modifiedFile: 'src/main/java/com/demo/OrderRepository.java',
        modifiedLine: 6,
        side: 'head',
        chain: ['listOrders', 'findOrders', 'findAll']
      }
    ]
  };

  it('renders a reverse mermaid graph with modified markers', () => {
    const mermaid = buildMermaid({ affectedApis: [api] });
    expect(mermaid).toContain('```mermaid');
    expect(mermaid).toContain('graph TD');
    expect(mermaid).toContain('classDef mod fill:#fde2e2');
    expect(mermaid).toContain('OrdersController.listOrders /api/orders');
    expect(mermaid).toContain('🔴 修改');
    expect(mermaid).toMatch(/class n\d+ mod/);
    expect(mermaid).toMatch(/n\d+ --> n\d+/);
  });

  it('renders markdown sections with the impact table', () => {
    const report = {
      repoPath: 'C:/repo',
      repoName: 'repo',
      base: 'base',
      head: 'head',
      baseSha: 'aaaaaaa',
      headSha: 'bbbbbbb',
      changedFiles: [
        { path: 'src/A.java', status: 'M' as const, java: true, config: false },
        { path: 'src/application.yml', status: 'M' as const, java: false, config: true }
      ],
      modifiedSymbols: [
        {
          kind: 'method',
          name: 'findAll',
          parentType: 'OrderRepository',
          file: 'src/OrderRepository.java',
          line: 6,
          side: 'head' as const,
          changedLines: [6, 7]
        }
      ],
      affectedApis: [api],
      uncovered: [],
      configChanges: [{ file: 'src/application.yml', key: 'app.feature.enabled', line: 3, status: 'added' as const }],
      mermaid: buildMermaid({ affectedApis: [api] })
    } satisfies DiffReport;

    const markdown = renderMarkdown(report);
    expect(markdown).toContain('# PR 架构影响面分析');
    expect(markdown).toContain('## 1. 修改的 Java 符号');
    expect(markdown).toContain('## 2. 受影响 API（Reverse Reachability）');
    expect(markdown).toContain('## 3. 反向调用链');
    expect(markdown).toContain('## 4. 配置变更提示');
    expect(markdown).toContain('`listOrders → findOrders → findAll`');
    expect(markdown).toContain('app.feature.enabled');
    expect(markdown).toContain('值永不输出');
  });
});

/* ------------------------------------------------------------------ */
/* 端到端：临时 git 仓库（Controller→Service→Repository）             */
/* ------------------------------------------------------------------ */

describe('Issue 22 analyzeDiff end-to-end', () => {
  it(
    'finds the upstream controller when a bottom-layer repository method changes',
    async () => {
      const { root, base, head } = await makeFixtureRepo();
      const report = await analyzeDiff({ repoPath: root, base, head });

      // 修改符号：head 侧 findAll/findById，base 侧删除的 findCached。
      const names = report.modifiedSymbols.map((entry) => entry.name).sort();
      expect(names).toContain('findAll');
      expect(names).toContain('findById');
      expect(names).toContain('findCached');
      const deleted = report.modifiedSymbols.find(
        (entry) => entry.name === 'findCached' && entry.side === 'base'
      );
      expect(deleted).toBeDefined();

      // 受影响 API：底层 findAll 修改必须能反向定位到 listOrders。
      const listOrders = report.affectedApis.find((api) => api.routeMethod === 'listOrders');
      expect(listOrders).toBeDefined();
      expect(listOrders!.controller).toBe('OrdersController');
      expect(listOrders!.httpPath).toBe('/api/orders');
      const findAllImpact = listOrders!.impacts.find(
        (impact) => impact.modifiedMethod === 'findAll' && impact.side === 'head'
      );
      expect(findAllImpact).toBeDefined();
      expect(findAllImpact!.chain).toEqual(['listOrders', 'findOrders', 'findAll']);

      // getOrder 同时受 head 侧 findById 修改与 base 侧 findCached 删除影响。
      const getOrder = report.affectedApis.find((api) => api.routeMethod === 'getOrder');
      expect(getOrder).toBeDefined();
      expect(getOrder!.impacts.map((impact) => impact.side).sort()).toEqual(['base', 'head']);
      expect(
        getOrder!.impacts.some(
          (impact) => impact.modifiedMethod === 'findCached' && impact.side === 'base'
        )
      ).toBe(true);

      // 反向 mermaid 链路包含完整 route → service → repository 链。
      expect(report.mermaid).toContain('graph TD');
      expect(report.mermaid).toContain('OrdersController.listOrders /api/orders');
      expect(report.mermaid).toContain('findAll');
      expect(report.mermaid).toContain('🔴 修改');
      expect(report.mermaid).toContain('🗑 删除');

      // 配置变更只报键名与位置，不泄漏值。
      const configKeys = report.configChanges.map((change) => change.key);
      expect(configKeys).toContain('app.feature.enabled');
      expect(configKeys).toContain('app.feature.newKey');
      const enabled = report.configChanges.find((change) => change.key === 'app.feature.enabled');
      expect(enabled!.status).toBe('modified');
      const newKey = report.configChanges.find((change) => change.key === 'app.feature.newKey');
      expect(newKey!.status).toBe('added');
      const markdown = renderMarkdown(report);
      expect(markdown).not.toContain('"x"');
      expect(markdown).not.toContain('orders-v2');
    },
    120_000
  );

  it(
    'reports no impact when the head commit only touches non-Java files',
    async () => {
      const { root, base, head } = await makeFixtureRepo();
      // 第三个提交只新增 README.md：与 head（第二个提交）比较应零影响。
      const docsHead = await commitMore(root, { 'README.md': '# only docs\n' }, 'docs');
      const report = await analyzeDiff({ repoPath: root, base: head, head: docsHead });
      expect(report.modifiedSymbols).toHaveLength(0);
      expect(report.affectedApis).toHaveLength(0);
      expect(report.uncovered).toHaveLength(0);
      expect(report.changedFiles.map((file) => file.path)).toEqual(['README.md']);
    },
    120_000
  );
});

/* ------------------------------------------------------------------ */
/* CLI 集成                                                            */
/* ------------------------------------------------------------------ */

describe('Issue 22 codecompass diff CLI', () => {
  it('parses diff positional args and options', () => {
    expect(parseArgs(['diff', 'main', 'HEAD', 'C:/repos/petclinic'])).toMatchObject({
      ok: true,
      args: {
        command: 'diff',
        diffBase: 'main',
        diffHead: 'HEAD',
        targetPath: 'C:/repos/petclinic'
      }
    });
    expect(
      parseArgs(['diff', '--output=json', '--file=report.md', 'v1.0', 'v2.0'])
    ).toMatchObject({
      ok: true,
      args: {
        command: 'diff',
        diffBase: 'v1.0',
        diffHead: 'v2.0',
        diffOutput: 'json',
        diffFile: 'report.md'
      }
    });
    expect(parseArgs(['diff', '--output', 'html', 'a', 'b']).ok).toBe(false);
  });

  it('rejects missing base/head with the usage message', async () => {
    await expect(runCli(['diff', 'only-base'], { log: () => undefined })).rejects.toThrow(
      /requires <base> and <head>/
    );
  });

  it(
    'renders markdown to stdout by default',
    async () => {
      const { root, base, head } = await makeFixtureRepo();
      const lines: string[] = [];
      const result = await runCli(['diff', base, head, root], { log: (line) => lines.push(line) });
      expect(result.server).toBeNull();
      const output = lines.join('\n');
      expect(output).toContain('# PR 架构影响面分析');
      expect(output).toContain('`listOrders → findOrders → findAll`');
    },
    120_000
  );

  it(
    'emits JSON with --output=json and writes a file with --file',
    async () => {
      const { root, base, head } = await makeFixtureRepo();
      const reportPath = path.join(root, 'impact.md');
      const lines: string[] = [];
      await runCli(
        ['diff', '--output=json', '--file', reportPath, base, head, root],
        { log: (line) => lines.push(line) }
      );
      expect(lines.some((line) => line.includes('Impact report written to'))).toBe(true);

      const written = await fs.readFile(reportPath, 'utf8');
      const parsed = JSON.parse(written) as DiffReport;
      expect(parsed.affectedApis.map((api) => api.routeMethod).sort()).toEqual([
        'getOrder',
        'listOrders'
      ]);
      expect(parsed.baseSha).toBeDefined();
      expect(parsed.headSha).toBeDefined();
    },
    120_000
  );
});

/* ------------------------------------------------------------------ */
/* detectConfigChanges（独立于 git 的纯路径）                          */
/* ------------------------------------------------------------------ */

describe('Issue 22 detectConfigChanges', () => {
  it('classifies added/modified/removed keys by exact touched lines', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codecompass-diff-cfg-'));
    const base = await makeCommit(root, { 'application.yml': BASE_YAML }, 'base');
    const head = await commitMore(root, { 'application.yml': HEAD_YAML }, 'head');
    const fileDiff = parseUnifiedDiff(await getDiffText(root, base, head)).find(
      (file) => file.path === 'application.yml'
    )!;
    const changedByFile = new Map<string, FileChangedLines>([
      ['application.yml', changedLinesFor(fileDiff)]
    ]);
    const changes = await detectConfigChanges(root, base, head, changedByFile);
    const byKey = new Map(changes.map((change) => [change.key, change]));
    expect(byKey.get('app.feature.enabled')?.status).toBe('modified');
    expect(byKey.get('app.feature.newKey')?.status).toBe('added');
    // 值永不进入报告。
    for (const change of changes) expect(change.key).not.toMatch(/true|false|"x"/);
  });
});
