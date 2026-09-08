# 09: 画布缩放平移 + 简化 MiniMap

Status: ready-for-agent

## 问题

`MermaidDiagram` 一次性渲染静态 SVG，大图无缩放平移（只有 overflow-x 滚动）。选型已定：mermaid + 增强层，不换图库。

## 任务

1. 引入 `svg-pan-zoom`（轻量、无 React 绑定负担）接入 MermaidDiagram 的 SVG 容器：滚轮缩放、拖拽平移、双击重置；`code://` 点击委托与降级 `<pre>` 路径不回归。
2. 简化 MiniMap：渲染完成后克隆 SVG 生成固定比例缩略图（右下角，宽度 ~140px），叠加当前视口框；点击缩略图跳转视口。mermaid 渲染失败时不显示 MiniMap。
3. 工具栏：+ / − / 重置三个按钮（键盘可达）。
4. 组件测试：渲染后容器可缩放（mock svg-pan-zoom 或断言初始化调用）、code:// 点击仍触发 onNavigate。

## 验收

- MermaidDiagram 全部既有测试不回归；新增缩放/MiniMap 测试绿。

## Comments

- 2026-08-28（code-review 记录）：实现为自研 CSS transform 缩放平移（滚轮/按钮/拖拽/
  双击重置），**未引入 svg-pan-zoom 依赖**——零依赖、行为等价、jsdom 可测；MiniMap
  为克隆 SVG 缩略图 + 视口框，点击可跳转视口（需真实尺寸，jsdom 下自动降级为空壳）。
  组件约 400 行承担缩放/搜索/Minimap/裁剪多轴（Divergent Change judgement call），
  拆分 useZoomPan/useNodeSearch 留给交互图库议题一并评估。
