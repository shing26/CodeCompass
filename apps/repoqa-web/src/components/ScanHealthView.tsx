import type { Repo } from '../types';

/**
 * v1.2 票 01 — 体检面骨架（数据面随票 02 接入 `GET /api/repos/:id/scan`）。
 * 本票只落三态骨架与空态文案；扫描引擎（runScan 五桶）尚无 REST 通道。
 *
 * 文案红线（v0.21 scan 定位红线 + ADR-0018，票 02 验收继续执法）：候选是
 * 确定性事实（「零静态调用者」），不得出现「可安全删除 / 死代码」类语义
 * 判断——那是 chat 侧 agent 的职责。
 */

const INDEXING_LABEL: Record<string, string> = {
  indexing: '索引中',
  cloning: '克隆中',
  parsing: '解析中',
  idle: '待机'
};

export function ScanHealthView({ repo }: { repo: Repo | null }) {
  if (!repo) {
    return (
      <section
        data-testid="scan-health"
        className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center"
      >
        <p className="text-sm font-medium text-ink">先在上方选择一个仓库，再运行代码体检。</p>
        <p className="max-w-md text-xs text-muted">
          体检会列出零调用者候选、枢纽、超大方法/文件等确定性事实，并展示检索精度态势。
        </p>
      </section>
    );
  }

  if (repo.status === 'ready') {
    return (
      <section
        data-testid="scan-health"
        className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center"
      >
        <p className="text-sm font-medium text-ink">{repo.name} 的体检面即将开放。</p>
        <p className="max-w-md text-xs text-muted">
          扫描数据通道随票 02 接入：五类候选（零静态调用者 / 枢纽 / 超大方法 / 深调用链 / 超大文件）
          与检索精度态势。在此之前，可在「架构问答」里直接问 scan 结论。
        </p>
      </section>
    );
  }

  if (repo.status === 'error') {
    return (
      <section
        data-testid="scan-health"
        className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center"
      >
        <p className="text-sm font-medium text-ink">{repo.name} 索引异常，暂无法体检。</p>
        <p className="text-xs text-muted">可在右上角 ⋯ 菜单尝试「重新索引」。</p>
      </section>
    );
  }

  return (
    <section
      data-testid="scan-health"
      className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center"
    >
      <p className="text-sm font-medium text-ink">
        {repo.name} {INDEXING_LABEL[repo.status] ?? '处理中'}——索引完成后即可体检。
      </p>
      <p className="text-xs text-muted">体检基于索引完成的符号图谱，扫描过程不需要你操作。</p>
    </section>
  );
}
