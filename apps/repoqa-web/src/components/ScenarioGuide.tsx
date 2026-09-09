/** 改造 4：场景导览卡——填充表单类视图（变更审计/Diff 影响面/规范演进）的
 * 垂直空间，告诉用户这个视图解决什么问题、三步怎么走。纯展示组件。 */
export function ScenarioGuide(props: { steps: string[] }) {
  return (
    <div className="scenario-guide" data-testid="scenario-guide">
      {props.steps.map((step, i) => (
        <div className="scenario-step" key={i}>
          <span className="scenario-step-num">{i + 1}</span>
          <span>{step}</span>
        </div>
      ))}
    </div>
  );
}
