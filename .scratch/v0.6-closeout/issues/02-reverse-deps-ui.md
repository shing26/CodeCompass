# 02: 反向依赖 UI（后端端点已存在，前端零调用）

Status: done

## 问题

后端 `GET /api/repos/:id/reverse-deps`（`services/control-plane/src/http.ts:272`，v0.5.1 的 D8 HTTP twin）已存在，但 `apps/repoqa-web/src` 全目录对 `reverse-deps` 零命中：`RepoQAClient` 无封装方法、无任何视图调用。用户无法在 UI 使用已具备的能力（原 P1-3）。

## 任务

1. `RepoQAClient` 增加 `listReverseDeps(repoId, ...)` 封装（对齐后端 query 参数契约）。
2. Inspector 面板：选中符号时展示"被谁调用"（callers）列表，条目可点击跳转 `file:line`（复用现有锚点跳转路径）。
3. `types.ts` 补对应响应类型。

## 验收

- 导入样本仓后，在 Inspector 选中一个被调用符号能看到 callers 列表并跳转。
- 组件测试覆盖列表渲染与空态（无 caller 时显示明确空态而非空白）。
