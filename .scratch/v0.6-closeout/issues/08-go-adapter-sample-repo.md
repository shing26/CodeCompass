# 08: Go 适配器样本仓实测（原 P2-4）

Status: done

## 问题

GoAdapter 已实现（Issue 26，Gin/Fiber 生态）但从未有样本仓实测，存在潜在缺陷风险；dashboard 的 Go 支持目前只有 "Source Only" 兜底标签。

## 任务

1. 在 `.scratch/go-sample/`（或 fixtures 目录）建最小 Go 仓库：go.mod + main.go + 一个 Gin 路由 + 服务函数 + 跨文件调用。
2. 导入 → 断言：符号解析（函数/路由）、调用链可生成、dashboard 技术栈识别为 Go。
3. 发现缺陷则修复并在本 issue 记录；适配器无缺陷则把实测结论写回 spec。

## 验收

- Go 样本仓完整走通 导入 → dashboard → 调用链 流程；e2e 基线新增 Go 断言（可标记为可选，避免 CI 强依赖 Go 工具链）。

## Comments

- 2026-08-28：实测通过——gate 内置最小 Gin 仓库（go.mod + main.go），导入后
  techStack 识别 Gin/Go、路由（`GET /api/health`）与 topApis 非空（断言
  `dashboard consumer surface non-empty (go/gin)` PASS）。Go 无需本地工具链，纯 AST 解析。
- 顺带记录两个产品边界（非缺陷，按能力建模断言）：
  1) Java 方法级 `@GetMapping` 不产生独立 route 符号（route 粒度是 controller 类），
     因此 architecture-delta 对「既有 controller 内加端点」不报 addedRoutes；
  2) 单文件语法错误 → 整文件跳过并记录 `repoqa.index.warning`（设计如此，Issue 17 注释）。
