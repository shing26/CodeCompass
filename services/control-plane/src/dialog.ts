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

/**
 * 拉起系统目录对话框并**真正置于前台**。
 *
 * 修前（Round5 实测「目录选择超时（对话框可能被遮挡）」）：owner 窗体 `$form` 从未
 * `Show()`，却被当作 `ShowDialog($form)` 的 owner。Windows 对「不可见的 owner」
 * 处理是已知不可靠的——对话框可能不激活、可能落在浏览器窗口后面，用户看不见，
 * 15s 后前端判超时，而对话框其实还开着（请求也没被中止，随后选完路径不生效）。
 *
 * 修后照搬 WinForms 前台配方：启用视觉样式 → 造一个 1×1 的 owner 并真正 Show()
 * （让它在任务栏有一席之地，模态框才不会被完全埋掉）→ Activate + DoEvents 强制
 * 激活 → 结束后 Close 掉 owner。脚本仍是常量、无任何用户输入拼接。
 */
const PS_SCRIPT = [
  'Add-Type -AssemblyName System.Windows.Forms | Out-Null',
  'Add-Type -AssemblyName System.Drawing | Out-Null',
  '[System.Windows.Forms.Application]::EnableVisualStyles()',
  '$form = New-Object System.Windows.Forms.Form',
  '$form.TopMost = $true',
  '$form.ShowInTaskbar = $true',
  '$form.FormBorderStyle = [System.Windows.Forms.FormBorderStyle]::FixedToolWindow',
  "$form.Text = 'CodeCompass — 选择仓库根目录'",
  '$form.StartPosition = [System.Windows.Forms.FormStartPosition]::Manual',
  '$form.Location = New-Object System.Drawing.Point(0, 0)',
  '$form.Size = New-Object System.Drawing.Size(160, 40)',
  '$form.Show()',
  '$form.Activate()',
  '[System.Windows.Forms.Application]::DoEvents()',
  '$dialog = New-Object System.Windows.Forms.FolderBrowserDialog',
  "$dialog.Description = '选择要导入的仓库根目录'",
  '$dialog.ShowNewFolderButton = $false',
  '$result = $dialog.ShowDialog($form)',
  'if ($result -eq [System.Windows.Forms.DialogResult]::OK) {',
  '  Write-Output $dialog.SelectedPath',
  '}',
  '$form.Close()'
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
