/** 改造 4：场景导览卡——填充表单类视图（变更审计/Diff 影响面/规范演进）的
 * 垂直空间，告诉用户这个视图解决什么问题、三步怎么走。纯展示组件。 */
export function ScenarioGuide(props: { steps: string[] }) {
  return (
    <div
      className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 rounded-lg border border-line bg-elevated px-3 py-2 text-xs text-muted"
      data-testid="scenario-guide"
    >
      {props.steps.map((step, i) => (
        <div className="flex items-center gap-1.5" key={i}>
          <span className="grid h-4 w-4 shrink-0 place-items-center rounded-full bg-accent text-micro font-bold text-white">
            {i + 1}
          </span>
          <span>{step}</span>
        </div>
      ))}
    </div>
  );
}
