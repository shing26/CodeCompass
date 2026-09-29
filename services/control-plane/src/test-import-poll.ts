/**
 * v1.2 票 03 — 测试面的导入收口帮手：POST /api/repos 转 202 之后，旧集成
 * 测试断言的「响应里已是 ready 仓」不复存在（索引转后台）。测试统一在导入
 * 后调 `pollRepoReady` 轮询目录到 ready/error，再进入既有断言链路——轮询
 * 逻辑只此一份，六个测试文件共用。
 */
export interface PolledRepo {
  id: string;
  status: string;
  error?: string;
}

export async function pollRepoReady(
  baseUrl: string,
  repoId: string,
  timeoutMs = 60_000
): Promise<PolledRepo | null> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const res = await fetch(`${baseUrl}/api/repos/${repoId}`);
      if (res.ok) {
        const { repo } = (await res.json()) as { repo: PolledRepo };
        if (repo.status === 'ready' || repo.status === 'error') return repo;
      }
    } catch {
      // transient — keep polling
    }
    if (Date.now() > deadline) return null;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

/** POST /api/repos（202）+ 轮询收口；返回 202 的原始响应体（repo 已被轮询刷新）。 */
export async function importRepoAndWait(
  baseUrl: string,
  localPath: string,
  extra: Record<string, unknown> = {}
): Promise<{
  status: number;
  body: { repo?: PolledRepo; taskId?: string; error?: string };
}> {
  const response = await fetch(`${baseUrl}/api/repos`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ localPath, ...extra })
  });
  const body = (await response.json()) as {
    repo?: PolledRepo;
    taskId?: string;
    error?: string;
  };
  if (body.repo?.id && body.repo.status !== 'ready' && body.repo.status !== 'error') {
    const settled = await pollRepoReady(baseUrl, body.repo.id);
    if (settled) body.repo = settled;
  }
  return { status: response.status, body };
}
