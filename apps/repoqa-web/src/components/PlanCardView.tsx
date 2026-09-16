import { useState } from 'react';
import type { ChatPlanCard } from '../client/RepoQAClient';
import { statusLabel } from '../client/statusLabel';
import { Badge } from './ui/Badge';

/** CM-04 卡片化 v2 的结构卡（载荷协议冻结），v0.26-A Q3 重塑为「方案摘要」
 * （Plan Digest）：卡名正名、底线声明升为头部常驻行、新增 CTA 跳规范演进——
 * 问答口的方案输出从尴尬点变成两视图的桥。勾选行为语义不变：分组、action
 * 徽标、勾选状态按 session 持久化（localStorage），执行由人工完成。
 * `onOpenEvolution` 可选：无回调时 CTA 不渲染（既有渲染点零破坏）。 */
export function PlanCardView(props: {
  cards: ChatPlanCard[];
  sessionId: string;
  onOpenEvolution?: () => void;
}) {
  const { cards, sessionId, onOpenEvolution } = props;
  const storageKey = `chat-plan-checks:${sessionId}`;

  const [checked, setChecked] = useState<Set<string>>(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      return new Set(raw ? (JSON.parse(raw) as string[]) : []);
    } catch {
      return new Set<string>();
    }
  });

  const toggle = (key: string) => {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      try {
        localStorage.setItem(storageKey, JSON.stringify([...next]));
      } catch {
        // storage unavailable — state still works in-memory for this session
      }
      return next;
    });
  };

  if (!cards.length) return null;

  return (
    <div className="mb-3" data-testid="plan-cards">
      {cards.map((card, ci) => {
        const groups = new Map<string, typeof card.items>();
        for (const item of card.items) {
          const list = groups.get(item.category) ?? [];
          list.push(item);
          groups.set(item.category, list);
        }
        const doneCount = card.items.filter((i) => checked.has(`${ci}:${i.filePath}:${i.action}`)).length;
        return (
          <div
            key={ci}
            data-testid="plan-card"
            className="mb-2 overflow-hidden rounded-lg border border-line bg-elevated"
          >
            <div
              data-testid="plan-card-head"
              className="flex items-center gap-2 bg-accent/10 px-3 py-2 text-sm font-semibold"
            >
              📋 {statusLabel(card.intentType)} 方案摘要 · {card.target}
              <Badge
                tone={
                  (card.riskLevel ?? 'LOW') === 'HIGH'
                    ? 'danger'
                    : (card.riskLevel ?? 'LOW') === 'MEDIUM'
                      ? 'warning'
                      : 'success'
                }
                className="!py-px"
              >
                {statusLabel(card.riskLevel ?? 'LOW')}
              </Badge>
              <span data-testid="plan-progress" className="ml-auto text-micro text-muted">
                {doneCount}/{card.items.length}
              </span>
            </div>
            {/* Q3：两入口共享底线，常驻头部行（非折叠/非角落） */}
            <div className="px-3 pt-1.5 text-xs font-semibold text-accent" data-testid="plan-bottomline">
              引擎只读，改动由你执行。
            </div>
            <div className="border-b border-line px-3 py-1.5 text-xs text-muted">勾选仅作本地追踪。</div>
            {[...groups.entries()].map(([category, items]) => (
              <div key={category}>
                <div className="px-3 pb-0.5 pt-2 text-micro font-bold tracking-wide text-muted">{category}</div>
                {items.map((item) => {
                  const key = `${ci}:${item.filePath}:${item.action}`;
                  const isChecked = checked.has(key);
                  return (
                    <label
                      className={`flex cursor-pointer items-start gap-2 px-3 py-1.5 text-sm hover:bg-accent/5 ${isChecked ? 'opacity-60 line-through' : ''}`}
                      key={key}
                    >
                      <input type="checkbox" checked={isChecked} onChange={() => toggle(key)} className="mt-0.5 accent-accent" />
                      <Badge
                        tone={
                          item.action === 'DELETE' ? 'danger' : item.action === 'MODIFY' ? 'warning' : 'success'
                        }
                        className="!py-px"
                      >
                        {statusLabel(item.action)}
                      </Badge>
                      <span className="flex min-w-0 flex-col gap-0.5">
                        <code className="break-all font-mono text-xs">{item.filePath}</code>
                        <span className="text-xs text-muted">{item.description}</span>
                      </span>
                    </label>
                  );
                })}
              </div>
            ))}
            {onOpenEvolution && (
              <div className="flex justify-end border-t border-line p-2">
                <button
                  type="button"
                  data-testid="plan-open-evolution"
                  onClick={onOpenEvolution}
                  className="cursor-pointer rounded-md border border-accent px-2.5 py-1 text-xs text-accent hover:bg-accent/10"
                >
                  在规范演进中展开 →
                </button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
