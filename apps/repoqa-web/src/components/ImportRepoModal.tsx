import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { Repo, RepoPreview } from '../types';

interface ImportRepoModalProps {
  /** Issue 19: standalone import dialog (was inline in TopBar). */
  open: boolean;
  onClose: () => void;
  /** Resolves with the created repo; an over-limit reject comes back as a
   * `status: 'error'` repo carrying `suggestedSubdirs` (v0.5.1 D1). */
  onImportLocal: (name: string, localPath: string) => Promise<Repo | void>;
  /** Round 2 B4: read-only preview of what a local import will index. */
  onPreviewLocal: (localPath: string) => Promise<RepoPreview>;
  /** Resolves with the newly created repo once the server-side clone landed
   * (202); indexing continues in the background until the catalog says ready. */
  onCloneRemote: (url: string, branch?: string) => Promise<Repo>;
  /** Full catalog so the modal can watch the cloned repo leave `indexing`. */
  repos: Repo[];
  /** Bug-12: repo currently being indexed (catalog polling) — live phase
   * feedback for the local tab while POST /api/repos is pending. */
  importingRepo?: Repo | null;
  /** v0.25.0 批次 1：原生目录选择器（Node 侧拉起系统对话框回传绝对路径）。
   * 未提供时（旧测试/降级）隐藏按钮。 */
  onPickFolder?: () => Promise<{ supported: boolean; canceled?: boolean; path?: string }>;
}

type Tab = 'local' | 'remote';
type RemotePhase = 'idle' | 'cloning' | 'indexing';

/**
 * Issue 19: repository ingestion hub — local path import and GitHub remote
 * clone, side by side. The local tab takes a manual absolute path plus a
 * native folder picker (v0.25.0 批次 1: GET /api/dialog/folder raises the OS
 * dialog so the real absolute path lands in the form — browsers cannot read
 * one; hidden on non-Windows hosts, 15s 超时降级手输); the remote tab clones
 * through POST /api/repos/clone with a cloning → indexing two-phase loading
 * and auto-closes when the repo is indexed.
 */
export function ImportRepoModal({
  open,
  onClose,
  onImportLocal,
  onPreviewLocal,
  onCloneRemote,
  repos,
  importingRepo,
  onPickFolder
}: ImportRepoModalProps) {
  const [tab, setTab] = useState<Tab>('local');
  // 批次 1 验收：非 Windows 平台隐藏浏览按钮（服务端 supported:false 仍是
  // 最终防线——UA 判断只用于展示层平滑，不作为能力真值）。
  const isWindowsHost =
    typeof navigator !== 'undefined' && /Win/i.test(navigator.platform || navigator.userAgent || '');
  const [name, setName] = useState('');
  const [localPath, setLocalPath] = useState('');
  const [localBusy, setLocalBusy] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  /** v0.5.1 (D1): importable subdirs offered after an over-limit reject. */
  const [suggestedSubdirs, setSuggestedSubdirs] = useState<string[]>([]);
  const [preview, setPreview] = useState<RepoPreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [folderHint, setFolderHint] = useState<string | null>(null);
  const [url, setUrl] = useState('');
  const [branch, setBranch] = useState('');
  const [remotePhase, setRemotePhase] = useState<RemotePhase>('idle');
  const [remoteError, setRemoteError] = useState<string | null>(null);
  const [clonedRepoId, setClonedRepoId] = useState<string | null>(null);
  const previewTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const previewSeq = useRef(0);

  // Bug-11: standard dialog behavior — Escape closes, and the listener lives
  // only while the dialog is mounted (never leaks to other components).
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        reset();
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(
    () => () => {
      if (previewTimer.current) clearTimeout(previewTimer.current);
      previewSeq.current += 1;
    },
    []
  );

  const runPreview = (rawPath: string) => {
    if (previewTimer.current) clearTimeout(previewTimer.current);
    const path = rawPath.trim();
    const seq = ++previewSeq.current;
    if (!path) {
      setPreview(null);
      setPreviewLoading(false);
      setPreviewError(null);
      return;
    }
    setPreview(null);
    setPreviewError(null);
    setPreviewLoading(true);
    previewTimer.current = setTimeout(async () => {
      try {
        const result = await onPreviewLocal(path);
        if (seq !== previewSeq.current) return;
        setPreview(result);
      } catch (error) {
        if (seq !== previewSeq.current) return;
        setPreviewError(error instanceof Error ? error.message : String(error));
      } finally {
        if (seq === previewSeq.current) setPreviewLoading(false);
      }
    }, 350);
  };

  const reset = () => {
    if (previewTimer.current) clearTimeout(previewTimer.current);
    previewSeq.current += 1;
    setTab('local');
    setName('');
    setLocalPath('');
    setLocalBusy(false);
    setLocalError(null);
    setSuggestedSubdirs([]);
    setPreview(null);
    setPreviewLoading(false);
    setPreviewError(null);
    setFolderHint(null);
    setUrl('');
    setBranch('');
    setRemotePhase('idle');
    setRemoteError(null);
    setClonedRepoId(null);
  };

  // Remote indexing phase: auto-close as soon as the cloned repo reaches
  // `ready` in the catalog; surface `error` instead of hanging forever.
  useEffect(() => {
    if (remotePhase !== 'indexing' || !clonedRepoId) return;
    const cloned = repos.find((r) => r.id === clonedRepoId);
    if (!cloned) return;
    if (cloned.status === 'ready') {
      reset();
      onClose();
    } else if (cloned.status === 'error') {
      setRemotePhase('idle');
      setRemoteError(cloned.error ?? '索引失败，请重试');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repos, remotePhase, clonedRepoId]);

  const importLocal = async (nameArg: string, pathArg: string) => {
    setLocalBusy(true);
    setLocalError(null);
    setSuggestedSubdirs([]);
    try {
      const repo = await onImportLocal(nameArg, pathArg);
      // v0.6 closeout: an over-limit reject resolves (not throws) with an
      // error-status repo. Keep the dialog open and offer the backend's
      // suggested subdirectories as one-click re-imports.
      if (repo && repo.status === 'error') {
        setLocalError(repo.error ?? '索引失败，请重试');
        setSuggestedSubdirs(repo.suggestedSubdirs ?? []);
        return;
      }
      reset();
      onClose();
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : String(err));
    } finally {
      setLocalBusy(false);
    }
  };

  const submitLocal = (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !localPath.trim() || localBusy) return;
    void importLocal(name.trim(), localPath.trim());
  };

  /** One-click re-import of a suggested subdirectory (joined onto the path). */
  const applySuggestion = (dir: string) => {
    if (localBusy) return;
    const joined = `${localPath.trim().replace(/[\\/]+$/, '')}/${dir}`;
    setLocalPath(joined);
    runPreview(joined);
    void importLocal(name.trim() || dir, joined);
  };

  const submitRemote = async (e: FormEvent) => {
    e.preventDefault();
    if (!url.trim() || remotePhase === 'cloning' || remotePhase === 'indexing') {
      return;
    }
    setRemoteError(null);
    setRemotePhase('cloning');
    try {
      const repo = await onCloneRemote(url.trim(), branch.trim() || undefined);
      setClonedRepoId(repo.id);
      setRemotePhase('indexing');
    } catch (err) {
      setRemotePhase('idle');
      setRemoteError(err instanceof Error ? err.message : String(err));
    }
  };

  // Browsers expose only relative paths for a picked folder, so the picker
  // best-effort fills the display name and asks for the absolute path.
  const remoteRepo = clonedRepoId
    ? repos.find((r) => r.id === clonedRepoId) ?? null
    : null;
  const remoteBusy = remotePhase === 'cloning' || remotePhase === 'indexing';

  return (
    <div
      data-testid="import-dialog"
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40"
      role="dialog"
      aria-modal="true"
      aria-label="Import or clone repo"
      onClick={() => {
        if (!localBusy && !remoteBusy) {
          reset();
          onClose();
        }
      }}
    >
      <div
        className="w-[26rem] rounded-lg border border-line bg-surface p-4 shadow-neon"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-3 text-sm font-semibold text-ink">
          Import or clone repo
        </h2>
        <div
          role="tablist"
          aria-label="Import source"
          className="mb-3 grid grid-cols-2 gap-1 rounded-md border border-line bg-subtle p-1"
        >
          <button
            type="button"
            role="tab"
            data-testid="import-tab-local"
            aria-selected={tab === 'local'}
            onClick={() => setTab('local')}
            className={`h-8 rounded-md text-sm font-medium ${
              tab === 'local'
                ? 'bg-surface text-ink shadow-sm'
                : 'text-muted hover:text-ink'
            }`}
          >
            本地路径
          </button>
          <button
            type="button"
            role="tab"
            data-testid="import-tab-remote"
            aria-selected={tab === 'remote'}
            onClick={() => setTab('remote')}
            className={`h-8 rounded-md text-sm font-medium ${
              tab === 'remote'
                ? 'bg-surface text-ink shadow-sm'
                : 'text-muted hover:text-ink'
            }`}
          >
            GitHub 仓库
          </button>
        </div>

        {tab === 'local' ? (
          <form onSubmit={submitLocal}>
            <label className="mb-2 block text-xs font-medium text-muted">
              仓库名称（列表里的显示名，可自定义）
              <input
                data-testid="import-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="petclinic"
                className="mt-1 w-full rounded-md border border-line px-2 py-1.5 text-sm text-ink outline-none focus:border-accent"
              />
            </label>
            <label className="mb-1 block text-xs font-medium text-muted">
              本地仓库的完整路径（必须填写绝对路径，如 C:\projects\petclinic 或 D:\Code\my-repo）
              <input
                data-testid="import-path"
                value={localPath}
                onChange={(e) => {
                  setLocalPath(e.target.value);
                  runPreview(e.target.value);
                }}
                placeholder="C:/projects/spring-petclinic"
                className="mt-1 w-full rounded-md border border-line px-2 py-1.5 text-sm text-ink outline-none focus:border-accent"
              />
            </label>
            <p className="mb-2 text-xs text-muted">
              注意：填写的是<strong className="text-ink">本机磁盘上已有的仓库文件夹</strong>，不是压缩包或 URL；
              路径不存在或不是仓库根目录会导致导入失败。支持 Java / TS / Python / Go 仓库。
            </p>
            {onPickFolder && isWindowsHost && (
              <button
                type="button"
                data-testid="import-browse"
                onClick={() => {
                  setFolderHint('正在打开系统目录选择对话框…');
                  // 暗礁防御（spec 批次 1）：弹窗可能被遮挡导致请求长期挂起，
                  // 前端 15s 超时自动降级手输；后端子进程自身还有更长超时兜底。
                  const timedOut = new Promise<'timeout'>((resolve) =>
                    setTimeout(() => resolve('timeout'), 15_000)
                  );
                  void Promise.race([onPickFolder(), timedOut])
                    .then((result) => {
                      if (result === 'timeout') {
                        setFolderHint('目录选择超时（对话框可能被遮挡），请手动填写完整路径。');
                        return;
                      }
                      if (!result.supported) {
                        setFolderHint('当前平台不支持系统目录选择，请手动填写完整路径。');
                        return;
                      }
                      if (result.canceled || !result.path) {
                        setFolderHint(null);
                        return;
                      }
                      const picked = result.path.replace(/[\\/]+$/, '');
                      setLocalPath(picked);
                      if (!name.trim()) setName(picked.split(/[\\/]/).pop() ?? '');
                      setFolderHint(null);
                      runPreview(picked);
                    })
                    .catch((err) => setFolderHint(`目录选择失败：${err instanceof Error ? err.message : String(err)}`));
                }}
                className="mb-2 rounded-md border border-line bg-surface px-2 py-1 text-xs text-muted hover:border-accent/40 hover:text-accent"
              >
                📁 浏览文件夹…（调用系统对话框自动填入路径）
              </button>
            )}
            {folderHint && (
              <p data-testid="import-folder-hint" className="mb-2 text-xs text-warning">
                {folderHint}
              </p>
            )}
            {previewLoading && (
              <p
                data-testid="import-preview-loading"
                className="mb-2 text-xs text-muted"
              >
                正在扫描目录…
              </p>
            )}
            {preview && !previewLoading && (
              <div
                data-testid="import-preview"
                className="mb-2 rounded-md border border-line bg-subtle px-2 py-1.5 text-xs text-muted"
              >
                将索引 <span className="font-semibold text-ink">{preview.fileCount}</span> 个文件
                {preview.javaFileCount > 0
                  ? `（含 ${preview.javaFileCount} 个 Java 文件${
                      preview.xmlFileCount > 0
                        ? `、${preview.xmlFileCount} 个 XML 资源`
                        : ''
                    }）`
                  : ''}
                ，跳过{' '}
                <span className="font-semibold text-ink">
                  {preview.skippedDirCount}
                </span>{' '}
                个目录
                {preview.skippedDirs.length > 0
                  ? `：${preview.skippedDirs.slice(0, 6).join(', ')}${preview.skippedDirs.length > 6 ? ' 等' : ''}`
                  : ''}
              </div>
            )}
            {previewError && (
              <p
                data-testid="import-preview-error"
                className="mb-2 text-xs text-warning"
              >
                {previewError}
              </p>
            )}
            {localError && <p className="mb-2 text-xs text-danger">{localError}</p>}
            {suggestedSubdirs.length > 0 && (
              <div
                data-testid="import-suggested-subdirs"
                className="mb-2 rounded-md border border-line bg-subtle px-2 py-1.5 text-xs text-muted"
              >
                <p className="mb-1">建议改为导入以下子目录：</p>
                <div className="flex flex-wrap gap-1.5">
                  {suggestedSubdirs.map((dir) => (
                    <button
                      key={dir}
                      type="button"
                      data-testid="import-suggested-subdir"
                      onClick={() => applySuggestion(dir)}
                      disabled={localBusy}
                      className="rounded border border-line bg-surface px-1.5 py-0.5 font-mono text-[11px] text-accent hover:border-accent/50 disabled:opacity-50"
                    >
                      {dir}/
                    </button>
                  ))}
                </div>
              </div>
            )}
            {localBusy &&
              (importingRepo ? (
                <div
                  data-testid="import-progress"
                  className="mb-2 flex items-center gap-2 rounded-md border border-accent-soft bg-accent-soft/40 px-2 py-1.5 text-xs text-accent"
                >
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" />
                  {importingRepo.indexTotal && importingRepo.indexTotal > 0
                    ? `正在解析 AST…（${importingRepo.indexParsed ?? 0}/${importingRepo.indexTotal}）`
                    : importingRepo.fileCount > 0
                    ? `正在解析 AST…（${importingRepo.fileCount} 个文件）`
                    : '正在扫描仓库…（索引中）'}
                </div>
              ) : (
                <p
                  data-testid="import-progress"
                  className="mb-2 text-xs text-muted"
                >
                  正在启动导入…
                </p>
              ))}
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  reset();
                  onClose();
                }}
                className="h-8 rounded-md px-3 text-sm text-muted hover:bg-subtle"
              >
                Cancel
              </button>
              <button
                type="submit"
                data-testid="import-submit"
                disabled={localBusy || !name.trim() || !localPath.trim()}
                className="h-8 rounded-md bg-accent px-3 text-sm font-medium text-white hover:bg-accent/90 disabled:opacity-50"
              >
                {localBusy ? 'Importing…' : 'Import'}
              </button>
            </div>
          </form>
        ) : (
          <form onSubmit={submitRemote}>
            <label className="mb-2 block text-xs font-medium text-muted">
              Git URL
              <input
                data-testid="import-url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://github.com/org/petclinic.git"
                className="mt-1 w-full rounded-md border border-line px-2 py-1.5 text-sm text-ink outline-none focus:border-accent"
              />
            </label>
            <label className="mb-3 block text-xs font-medium text-muted">
              Branch（可选）
              <input
                data-testid="import-branch"
                value={branch}
                onChange={(e) => setBranch(e.target.value)}
                placeholder="main"
                className="mt-1 w-full rounded-md border border-line px-2 py-1.5 text-sm text-ink outline-none focus:border-accent"
              />
            </label>
            {remoteError && <p className="mb-2 text-xs text-danger">{remoteError}</p>}
            {remotePhase === 'cloning' && (
              <div
                data-testid="import-clone-progress"
                className="mb-2 flex items-center gap-2 rounded-md border border-accent-soft bg-accent-soft/40 px-2 py-1.5 text-xs text-accent"
              >
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" />
                正在克隆仓库…
              </div>
            )}
            {remotePhase === 'indexing' && (
              <div
                data-testid="import-clone-progress"
                className="mb-2 flex items-center gap-2 rounded-md border border-accent-soft bg-accent-soft/40 px-2 py-1.5 text-xs text-accent"
              >
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" />
                正在索引并分析…
                {remoteRepo && remoteRepo.indexTotal && remoteRepo.indexTotal > 0
                  ? `（${remoteRepo.indexParsed ?? 0}/${remoteRepo.indexTotal}）`
                  : remoteRepo && remoteRepo.fileCount > 0
                    ? `（${remoteRepo.fileCount} 个文件）`
                    : ''}
              </div>
            )}
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  reset();
                  onClose();
                }}
                className="h-8 rounded-md px-3 text-sm text-muted hover:bg-subtle"
              >
                Cancel
              </button>
              <button
                type="submit"
                data-testid="import-clone-submit"
                disabled={remoteBusy || !url.trim()}
                className="h-8 rounded-md bg-accent px-3 text-sm font-medium text-white hover:bg-accent/90 disabled:opacity-50"
              >
                {remotePhase === 'cloning'
                  ? 'Cloning…'
                  : remotePhase === 'indexing'
                    ? 'Indexing…'
                    : 'Clone & import'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
