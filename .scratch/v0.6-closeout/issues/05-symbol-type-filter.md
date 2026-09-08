# 05: 符号类型过滤下拉

Status: done

## 问题

后端 `/api/repos/:id/symbols` 已返回真实 `symbolType`（`http.ts:45-62` 12 值枚举，D6 已修复），`RepoQAClient.listSymbols(repoId, kind?)` 已支持 kind 查询参数，但 `useSymbols` 从不传、Sidebar 只有硬编码的 route 过滤——用户无法按类型筛选（原 E7 剩余部分）。

## 任务

1. Sidebar 符号区增加类型过滤下拉（全部 / ROUTE / CLASS / FUNCTION / ...，取值对齐 SYMBOL_TYPE_BY_KIND）。
2. 过滤走现有 `matchesSymbol` 客户端过滤（避免每次切换打请求）；服务端 kind 参数留给后续大数据量优化，不在本期接。
3. 过滤状态与现有文本搜索框叠加生效（AND 语义）。

## 验收

- 选 ROUTE 只剩路由符号；选全部恢复；与文本搜索组合过滤正确。
- 组件测试覆盖过滤切换与组合。

## Comments

- 2026-08-28（code-review 批注）：过滤取值补齐为后端全量 kind——`SymbolKind` 联合
  类型与下拉新增 `config` / `dependency`（`repoqa-config.ts:406` 产出），对齐 12 值枚举。
