import { describe, expect, it } from 'vitest';
import { openDb } from './db';
import { Repos, cleanLocalPath } from './repos';

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
});