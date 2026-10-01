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

  /* v1.2.x（Round5 实测「目录选择超时（对话框可能被遮挡）」）——锁住置顶配方。
   *
   * 修前 owner 窗体 `$form` 从未 `Show()` 却被当作 `ShowDialog($form)` 的 owner：
   * Windows 对「不可见 owner」的处理不可靠，对话框可能不激活、落到浏览器窗口
   * 后面，用户看不见，60s 后前端判超时而窗口其实还开着。脚本是常量，所以这里
   * 直接断言配方本身——这是唯一能在不开真窗口的前提下钉住它的办法。 */
  it('materializes and activates the owner form before showing the modal', async () => {
    const execFile = vi.fn(
      (_cmd: string, _args: readonly string[], _opts: object, cb: (err: Error | null, stdout: string) => void) => {
        cb(null, '');
        return undefined as never;
      }
    );
    await pickFolderDialog('win32', execFile as unknown as typeof import('node:child_process').execFile);
    const script = (execFile.mock.calls[0][1] as string[]).join(' ');
    expect(script).toContain('EnableVisualStyles()');
    expect(script).toContain('$form.Show()');
    expect(script).toContain('$form.Activate()');
    expect(script).toContain('DoEvents()');
    // 顺序：Show → Activate → DoEvents → ShowDialog
    expect(script.indexOf('$form.Show()')).toBeLessThan(script.indexOf('$dialog.ShowDialog($form)'));
    expect(script.indexOf('$form.Activate()')).toBeLessThan(script.indexOf('$dialog.ShowDialog($form)'));
    // 结束后关掉 owner，别留一个空窗体在任务栏
    expect(script).toContain('$form.Close()');
  });
});
