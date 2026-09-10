import { execFile } from 'node:child_process';

/** CM/批次 1（v0.25.0）：原生目录选择器端点的实现。
 *
 * Windows：spawn 固定 PowerShell 脚本（-NoProfile -STA——FolderBrowserDialog
 * 依赖 COM STA 线程）拉起系统对话框并置顶；脚本为常量、无用户输入拼接。
 * 非 Windows 或 PowerShell 不可用：返回 supported:false，前端降级手输。
 */

export interface FolderDialogResult {
  supported: boolean;
  canceled?: boolean;
  path?: string;
}

const PS_SCRIPT = [
  'Add-Type -AssemblyName System.Windows.Forms | Out-Null',
  '$form = New-Object System.Windows.Forms.Form',
  '$form.TopMost = $true',
  '$form.ShowInTaskbar = $false',
  "$form.Text = '选择仓库根目录'",
  '$dialog = New-Object System.Windows.Forms.FolderBrowserDialog',
  "$dialog.Description = '选择要导入的仓库根目录'",
  '$dialog.ShowNewFolderButton = $false',
  '$result = $dialog.ShowDialog($form)',
  'if ($result -eq [System.Windows.Forms.DialogResult]::OK) {',
  '  Write-Output $dialog.SelectedPath',
  '}'
].join('; ');

const TIMEOUT_MS = 60_000;

export function pickFolderDialog(
  platform: NodeJS.Platform = process.platform,
  execFileImpl: typeof execFile = execFile,
  timeoutMs = TIMEOUT_MS
): Promise<FolderDialogResult> {
  if (platform !== 'win32') {
    return Promise.resolve({ supported: false });
  }
  return new Promise((resolve) => {
    try {
      execFileImpl(
        'powershell.exe',
        ['-NoProfile', '-STA', '-Command', PS_SCRIPT],
        { timeout: timeoutMs, windowsHide: true },
        (err, stdout) => {
          const selected = typeof stdout === 'string' ? stdout.trim() : '';
          if (err && !selected) {
            // 用户取消时 PowerShell 正常退出且无输出——不算错误；真正的
            // 崩溃（如 STA 缺失）也降级为 canceled，前端提示手输。
            resolve({ supported: true, canceled: true });
            return;
          }
          if (selected) {
            resolve({ supported: true, canceled: false, path: selected });
            return;
          }
          resolve({ supported: true, canceled: true });
        }
      );
    } catch {
      resolve({ supported: true, canceled: true });
    }
  });
}
