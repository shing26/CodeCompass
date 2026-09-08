import { useState } from 'react';
import type { ChatPlanCard } from '../client/RepoQAClient';

/** CM-04 卡片化 v2：DEPRECATE 拆除计划结构化卡片——分组、action 徽标、
 * 勾选状态按 session 持久化（localStorage），刷新后保留。执行由人工完成。 */
export function PlanCardView(props: { cards: ChatPlanCard[]; sessionId: string }) {
  const { cards, sessionId } = props;
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
              🧹 {card.intentType} 拆除计划 · {card.target}
              <span className={`plan-risk risk-${(card.riskLevel ?? 'LOW').toLowerCase()}`}>
                {card.riskLevel ?? 'LOW'}
              </span>
              <span className="plan-progress">
                {doneCount}/{card.items.length}
              </span>
            </div>
            <div className="plan-card-note">勾选仅作本地追踪，执行由人工完成（引擎只读）。</div>
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
          </div>
        );
      })}
    </div>
  );
}
