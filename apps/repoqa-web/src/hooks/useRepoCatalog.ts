import { useCallback, useEffect, useRef, useState } from 'react';
import type { Repo, RepoStatus } from '../types';
import type { RepoQAClient } from '../client/RepoQAClient';

// Backend status flow is idle → indexing → ready/error. Legacy 'cloning'/
// 'parsing' remain for older servers; 'indexing' is what makes polling work.
const ACTIVE_STATUSES: RepoStatus[] = ['cloning', 'parsing', 'indexing'];

export interface UseRepoCatalogResult {
  repos: Repo[];
  currentRepo: Repo | null;
  loading: boolean;
  error: string | null;
  /** v1.2.x（R4-4）— 清错误（页头错误条可消）。 */
  clearError: () => void;
  selectRepo: (id: string) => void;
  /** Resolves with the created repo (status may be `error` with
   * `suggestedSubdirs` after an over-limit reject — v0.5.1 D1 contract). */
  importRepo: (name: string, localPath: string) => Promise<Repo>;
  refresh: () => Promise<Repo[]>;
}

/**
 * Owns the repo catalog: list, current selection, import, and polling while a
 * repo is still indexing. Polling stops as soon as status is terminal.
 *
 * `initialRepoId` (e.g. from a `?repo=` deep link opened by the CLI) is
 * applied once the catalog has loaded; it never overrides an explicit user
 * selection made afterwards.
 */
export function useRepoCatalog(
  client: RepoQAClient,
  initialRepoId?: string | null
): UseRepoCatalogResult {
  const [repos, setRepos] = useState<Repo[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const didApplyInitial = useRef(false);

  const selectRepo = useCallback((id: string) => {
    setCurrentId(id);
  }, []);

  const refresh = useCallback(async (): Promise<Repo[]> => {
    const list = await client.listRepos();
    setRepos(list);
    return list;
  }, [client]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    refresh()
      .then((list) => {
        if (cancelled) return;
        setError(null);
        if (initialRepoId && !didApplyInitial.current) {
          didApplyInitial.current = true;
          setCurrentId((prev) =>
            prev === null && list.some((r) => r.id === initialRepoId)
              ? initialRepoId
              : prev
          );
        }
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [refresh, initialRepoId]);

  // Poll repo status while any repo is active (indexing), then stop.
  useEffect(() => {
    const active = repos.some((r) => ACTIVE_STATUSES.includes(r.status));
    if (!active) return;
    const tick = async () => {
      try {
        const list = await client.listRepos();
        setRepos(list);
      } catch {
        // transient poll failure — keep current state and retry next tick
      }
    };
    pollTimer.current = setInterval(tick, 1500);
    return () => {
      if (pollTimer.current) clearInterval(pollTimer.current);
      pollTimer.current = null;
    };
  }, [client, repos]);

  const importRepo = useCallback(
    async (name: string, localPath: string) => {
      setError(null);
      // v1.2 票 03（V29-1）：202 语义——POST 秒回 indexing 行；Bug-12 时代为
      // 长挂 POST 手动起的 1200ms 轮询退役，上方常驻状态轮询（仓库 active 即
      // 1500ms 刷目录）从行落库那刻接管进度。
      try {
        const { repo } = await client.importRepo({ name, localPath });
        setRepos((prev) => [repo, ...prev.filter((r) => r.id !== repo.id)]);
        setCurrentId(repo.id);
        return repo;
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        throw err;
      }
    },
    [client]
  );

  const currentRepo = repos.find((r) => r.id === currentId) ?? null;

  // v1.2.x（R4-4）— 错误条可消：catalog 的 error 曾永久钉在页头（无关闭钮、
  // 切主题也在），暴露 clearError 供 UI 调用。
  const clearError = useCallback(() => setError(null), []);

  return { repos, currentRepo, loading, error, clearError, selectRepo, importRepo, refresh };
}