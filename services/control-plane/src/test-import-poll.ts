/**
 * v1.2 票 03 — 测试面的导入收口帮手：POST /api/repos 转 202 之后，旧集成
 * 测试断言的「响应里已是 ready 仓」不复存在（索引转后台）。测试统一在导入
 * 后调 `pollRepoReady` 轮询目录到 ready/error，再进入既有断言链路——轮询
 * 逻辑只此一份，六个测试文件共用。
 * v1.2 收口（评审 P2）：超时改为**抛错**并携带 last-status——旧实现返回 null，
 * 调用点丢弃返回值后带着未就绪仓继续断言，报错指向下游（诊断缺口）。
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
): Promise<PolledRepo> {
  const deadline = Date.now() + timeoutMs;
  let lastStatus = 'unknown';
  for (;;) {
    try {
      const res = await fetch(`${baseUrl}/api/repos/${repoId}`);
      if (res.ok) {
        const { repo } = (await res.json()) as { repo: PolledRepo };
        lastStatus = repo.status;
        if (repo.status === 'ready' || repo.status === 'error') return repo;
      } else {
        lastStatus = `http-${res.status}`;
      }
    } catch {
      // transient — keep polling
    }
    if (Date.now() > deadline) {
      throw new Error(
        `pollRepoReady: repo ${repoId} did not settle within ${timeoutMs}ms (last status: ${lastStatus})`
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}
