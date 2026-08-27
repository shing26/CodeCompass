import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseLargeFileTier3 } from './large-file';
import { scanRepo } from './repoqa-scan';

describe('parseLargeFileTier3 (v0.6.0)', () => {
  it('extracts top-level Java classes and route signatures from a generated file', () => {
    const lines = [
      'package com.demo.gen;',
      '',
      '@RestController',
      'public class OrderClientApi {',
      '  @GetMapping("/orders")',
      '  public String listOrders() {',
      '    return "ok";',
      '  }',
      '',
      '  @PostMapping("/orders")',
      '  public String createOrder() {',
      '    return "ok";',
      '  }',
      '}',
      '',
      'public interface OrderClient {}'
    ];
    const source = lines.join('\n');
    const symbols = parseLargeFileTier3(source, 'gen/OrderClientApi.java', 'repo');

    expect(symbols.find((symbol) => symbol.name === 'OrderClientApi')).toMatchObject({
      kind: 'class',
      lineStart: 4
    });
    expect(symbols.find((symbol) => symbol.name === 'OrderClient')).toMatchObject({
      kind: 'interface',
      lineStart: 16
    });
    expect(
      symbols.find(
        (symbol) => symbol.kind === 'route' && symbol.name === 'GET /orders'
      )
    ).toMatchObject({
      displayPath: '/orders',
      lineStart: 5
    });
    expect(
      symbols.find(
        (symbol) => symbol.kind === 'route' && symbol.name === 'POST /orders'
      )
    ).toMatchObject({
      displayPath: '/orders',
      lineStart: 10
    });
  });

  it('stays under the 30ms Tier 3 budget on a 3500-line file', () => {
    const lines: string[] = ['package com.demo.gen;', ''];
    for (let index = 0; index < 700; index += 1) {
      lines.push(
        `public class Generated${index} {`,
        `  public String method${index}() { return "x"; }`,
        '}',
        ''
      );
    }
    const source = lines.join('\n');
    const started = Date.now();
    const symbols = parseLargeFileTier3(source, 'gen/Generated.java', 'repo');
    const elapsed = Date.now() - started;
    expect(symbols.length).toBe(700);
    expect(elapsed).toBeLessThanOrEqual(30);
  });
});

describe('scanRepo large-file classification (v0.6.0)', () => {
  it('marks files over 3000 lines or with a 1000+ char line as large', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'repoqa-large-'));
    try {
      await fs.mkdir(path.join(root, 'src'), { recursive: true });
      await fs.writeFile(
        path.join(root, 'src', 'Huge.java'),
        Array.from({ length: 3001 }, (_, index) => `// line ${index}`).join('\n')
      );
      await fs.writeFile(
        path.join(root, 'src', 'LongLine.java'),
        `${'x'.repeat(1001)}\n`
      );
      const stats = await scanRepo(root);
      expect(stats.largeFiles.length).toBe(2);
      expect(stats.files.length).toBe(2);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
