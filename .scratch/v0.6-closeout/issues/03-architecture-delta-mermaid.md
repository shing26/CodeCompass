# 03: 架构差异视图渲染 mermaid 图

Status: done

## 问题

后端 `analyzeDiff` 已生成 `architectureDelta.mermaid`（`repoqa-diff.ts:851` `buildDeltaMermaid`），前端 `types.ts:107` 已声明该字段，但 `ArchitectureDeltaView.tsx` 完全未引用——视图只有统计卡片 + 列表 + `<pre>` 文本报告（原 P2-3）。

## 任务

1. `ArchitectureDeltaView` 在报告区上方用现有 `MermaidDiagram` 组件渲染 `delta.mermaid`（节点点击跳转 `file:line` 能力随组件免费获得）。
2. `mermaid` 字段缺失/为空时优雅降级为纯文本视图（不报错）。
3. 文本报告保留（"复制报告"按钮不动）。

## 验收

- 对一个含路由增删的 PR 差异能同时看到图与文本；mermaid 渲染失败不阻塞文本展示。
- 组件测试：有 mermaid 字段时渲染 SVG，无字段时不渲染。
