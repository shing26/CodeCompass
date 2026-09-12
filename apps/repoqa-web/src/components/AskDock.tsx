import { useState } from 'react';

/**
 * v0.27-UI ticket 02 (U3)：全局常驻对话条——「问现状」心智落到物理位置。
 *
 * 主区下沿一条输入栏（footer 之上、flex item 不遮挡任何视图）；任何工程视图
 * 里被细节卡住时，敲问题回车即切进「架构问答」并把问题预填进 composer——
 * 发送权留给用户（consent 门与 chatGuardSend 链路零变化）。
 *
 * 隐藏条件（App 装配层）：无库不渲染；view==='chat' 时不渲染（chat 自带
 * composer）。窄屏 Inspector 抽屉打开时由遮罩层自然盖住本条，无需卸载逻辑。
 */
export function AskDock(props: { repoName: string; onSubmit: (question: string) => void }) {
  const { repoName, onSubmit } = props;
  const [text, setText] = useState('');

  const submit = () => {
    const question = text.trim();
    if (!question) return;
    setText('');
    onSubmit(question);
  };

  return (
    <form
      data-testid="ask-dock"
      className="shrink-0 border-t border-line bg-canvas/95 px-3 py-2 backdrop-blur"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <div className="mx-auto flex w-full max-w-3xl items-center gap-2">
        <span className="shrink-0 text-xs font-medium text-accent">问现状 →</span>
        <input
          data-testid="ask-dock-input"
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={`问点什么…（架构问答 · ${repoName}）`}
          aria-label="向架构问答提问"
          className="h-8 min-w-0 flex-1 rounded-full border border-line bg-surface px-3 text-sm text-ink outline-none placeholder:text-muted focus:border-accent"
        />
        <button
          type="submit"
          data-testid="ask-dock-send"
          disabled={!text.trim()}
          className="shrink-0 rounded-full bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent/90 disabled:opacity-50"
        >
          提问 →
        </button>
      </div>
    </form>
  );
}
