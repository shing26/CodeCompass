import { describe, expect, it } from 'vitest';
import { openDb } from './db';
import { Repos, cleanLocalPath } from './repos';
import { RepoQARepos } from './repoqa-repos';
import type { RepoSymbol } from './repoqa-repos';

describe('cleanLocalPath', () => {
  it('trims surrounding whitespace', () => {
    expect(cleanLocalPath('  D:/repo  ')).toBe('D:/repo');
  });

  it('strips paired wrapping quotes once', () => {
    expect(cleanLocalPath('"D:/repo"')).toBe('D:/repo');
    expect(cleanLocalPath("'D:/repo'")).toBe('D:/repo');
  });

  it('strips nested wrapping quotes repeatedly', () => {
    expect(cleanLocalPath('"\'D:/repo\'"')).toBe('D:/repo');
  });

  it('strips whitespace inside the quotes', () => {
    expect(cleanLocalPath('  "  D:/repo  "  ')).toBe('D:/repo');
  });

  it('collapses doubled backslashes from copy/paste escaping', () => {
    expect(cleanLocalPath('D:\\\\repo\\\\src')).toBe('D:\\repo\\src');
  });

  it('keeps a leading UNC double backslash intact', () => {
    expect(cleanLocalPath('\\\\host\\share\\project')).toBe('\\\\host\\share\\project');
  });

  it('removes trailing separators but keeps drive roots', () => {
    expect(cleanLocalPath('D:/repo/')).toBe('D:/repo');
    expect(cleanLocalPath('D:\\repo\\')).toBe('D:\\repo');
    expect(cleanLocalPath('C:\\')).toBe('C:\\');
    expect(cleanLocalPath('C:/')).toBe('C:/');
  });

  it('returns an empty string for an empty input without throwing', () => {
    expect(cleanLocalPath('')).toBe('');
  });
});

describe('Repos', () => {
  it('createWorkspace stores the cleaned rootPath', () => {
    const db = openDb(':memory:');
    const repos = new Repos(db);
    const workspace = repos.createWorkspace({
      id: 'w-1',
      name: 'demo',
      rootPath: '  "\\\\host\\share\\demo\\"  '
    });
    expect(workspace.rootPath).toBe('\\\\host\\share\\demo');
    expect(repos.getWorkspace('w-1')?.rootPath).toBe('\\\\host\\share\\demo');
    db.close();
  });

  it('round-trips Issue 21 annotations and paramAnnotations through repo_symbols', () => {
    const db = openDb(':memory:');
    const repoqa = new RepoQARepos(db);
    repoqa.createRepo({ id: 'r-1', name: 'demo', localPath: 'D:/demo' });
    const symbols: RepoSymbol[] = [
      {
        repoId: 'r-1',
        kind: 'service',
        name: 'AlipayGateway',
        filePath: 'src/main/java/com/demo/AlipayGateway.java',
        lineStart: 3,
        lineEnd: 10,
        interfaces: ['PaymentGateway'],
        annotations: ['@Service', '@Primary']
      },
      {
        repoId: 'r-1',
        kind: 'method',
        name: 'checkout',
        filePath: 'src/main/java/com/demo/PaymentController.java',
        lineStart: 8,
        lineEnd: 10,
        parentType: 'PaymentController',
        calls: [],
        paramAnnotations: {
          gateway: ['@Qualifier("wechatGateway")']
        }
      }
    ];
    repoqa.upsertSymbols(symbols);

    const onClass = repoqa.findSymbol('r-1', 'AlipayGateway');
    expect(onClass).toHaveLength(1);
    expect(onClass[0].annotations).toEqual(['@Service', '@Primary']);
    expect(onClass[0].interfaces).toEqual(['PaymentGateway']);

    const onMethod = repoqa.findSymbol('r-1', 'checkout');
    expect(onMethod).toHaveLength(1);
    expect(onMethod[0].paramAnnotations).toEqual({
      gateway: ['@Qualifier("wechatGateway")']
    });

    const all = repoqa.listSymbols('r-1');
    expect(all).toHaveLength(2);
    expect(all.find((s) => s.name === 'checkout')?.paramAnnotations?.gateway).toEqual([
      '@Qualifier("wechatGateway")'
    ]);
    db.close();
  });
});