import { describe, expect, it, vi } from 'vitest';
import { pickFolderDialog } from './dialog';

describe('pickFolderDialog (v0.25.0 批次 1)', () => {
  it('returns supported:false on non-Windows platforms', async () => {
    const execFile = vi.fn();
    const result = await pickFolderDialog('linux', execFile as unknown as typeof import('node:child_process').execFile);
    expect(result).toEqual({ supported: false });
    expect(execFile).not.toHaveBeenCalled();
  });

  it('spawns powershell with -NoProfile -STA and parses the selected path', async () => {
    const execFile = vi.fn(
      (_cmd: string, _args: readonly string[], _opts: object, cb: (err: Error | null, stdout: string) => void) => {
        cb(null, 'D:/repos/petclinic\n');
        return undefined as never;
      }
    );
    const result = await pickFolderDialog('win32', execFile as unknown as typeof import('node:child_process').execFile);
    expect(result).toEqual({ supported: true, canceled: false, path: 'D:/repos/petclinic' });
    const args = execFile.mock.calls[0][1] as string[];
    expect(execFile.mock.calls[0][0]).toBe('powershell.exe');
    expect(args).toContain('-NoProfile');
    expect(args).toContain('-STA');
  });

  it('maps empty stdout (user cancel) to canceled without treating it as failure', async () => {
    const execFile = vi.fn(
      (_cmd: string, _args: readonly string[], _opts: object, cb: (err: Error | null, stdout: string) => void) => {
        cb(null, '');
        return undefined as never;
      }
    );
    const result = await pickFolderDialog('win32', execFile as unknown as typeof import('node:child_process').execFile);
    expect(result).toEqual({ supported: true, canceled: true });
  });

  it('degrades to canceled on spawn crash (e.g. missing STA) instead of rejecting', async () => {
    const execFile = vi.fn(
      (_cmd: string, _args: readonly string[], _opts: object, cb: (err: Error | null, stdout: string) => void) => {
        cb(new Error('Thread state exception'), '');
        return undefined as never;
      }
    );
    const result = await pickFolderDialog('win32', execFile as unknown as typeof import('node:child_process').execFile);
    expect(result).toEqual({ supported: true, canceled: true });
  });

  it('degrades to canceled when the execFile timeout kills the dialog process', async () => {
    // child_process 超时杀进程时回调带 killed/signal——与崩溃同路降级，
    // 永不 reject（暗礁防御：对话框挂起不能变成前端错误）。
    const execFile = vi.fn(
      (_cmd: string, _args: readonly string[], _opts: object, cb: (err: Error | null, stdout: string) => void) => {
        cb(Object.assign(new Error('kill ETIMEDOUT'), { killed: true, signal: 'SIGTERM' }), '');
        return undefined as never;
      }
    );
    const result = await pickFolderDialog('win32', execFile as unknown as typeof import('node:child_process').execFile);
    expect(result).toEqual({ supported: true, canceled: true });
  });
});
