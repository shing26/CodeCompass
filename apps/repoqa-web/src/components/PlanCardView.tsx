import { useState } from 'react';
import type { ChatPlanCard } from '../client/RepoQAClient';

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
    <div className="plan-cards" data-testid="plan-cards">
      {cards.map((card, ci) => {
        const groups = new Map<string, typeof card.items>();
        for (const item of card.items) {
          const list = groups.get(item.category) ?? [];
          list.push(item);
          groups.set(item.category, list);
        }
        const doneCount = card.items.filter((i) => checked.has(`${ci}:${i.filePath}:${i.action}`)).length;
        return (
          <div className="plan-card" key={ci}>
            <div className="plan-card-head">
              📋 {card.intentType} 方案摘要 · {card.target}
              <span className={`plan-risk risk-${(card.riskLevel ?? 'LOW').toLowerCase()}`}>
                {card.riskLevel ?? 'LOW'}
              </span>
              <span className="plan-progress">
                {doneCount}/{card.items.length}
              </span>
            </div>
            {/* Q3：两入口共享底线，常驻头部行（非折叠/非角落） */}
            <div className="plan-card-bottomline" data-testid="plan-bottomline">
              引擎只读，改动由你执行。
            </div>
            <div className="plan-card-note">勾选仅作本地追踪。</div>
            {[...groups.entries()].map(([category, items]) => (
              <div className="plan-group" key={category}>
                <div className="plan-group-head">{category}</div>
                {items.map((item) => {
                  const key = `${ci}:${item.filePath}:${item.action}`;
                  const isChecked = checked.has(key);
                  return (
                    <label className={`plan-item${isChecked ? ' done' : ''}`} key={key}>
                      <input type="checkbox" checked={isChecked} onChange={() => toggle(key)} />
                      <span className={`plan-action action-${item.action.toLowerCase()}`}>{item.action}</span>
                      <span className="plan-body">
                        <code className="plan-file">{item.filePath}</code>
                        <span className="plan-desc">{item.description}</span>
                      </span>
                    </label>
                  );
                })}
              </div>
            ))}
            {onOpenEvolution && (
              <div className="plan-card-cta">
                <button type="button" data-testid="plan-open-evolution" onClick={onOpenEvolution}>
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
