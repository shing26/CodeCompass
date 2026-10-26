# 票 05 — 接进跨文件绑定：Phase 1 钉死 → Phase 2 歧义显式化

Status: pending

## Phase 1（钉死，不新增 BREAK）

在 `engine/repoqa-callchain.ts` 的跨文件绑定处（Issue 15 规则：caller 文件优先 → 最早声明）前插入
一级判定：**caller 文件 import 表里对该符号名有唯一命中 → 直接绑到该文件**。
无唯一命中时保持现状。验收：票 01 的 1301 条可钉死边中，实际钉死数应接近 1301，
差异逐条给出原因（如 export 重命名、`export *` 转发）。

## Phase 2（歧义显式化）

名字在多文件声明、且 import 无法唯一钉死的边，从「静默绑定最早声明」改为 `SUSPECT`。
注意：`SUSPECT` 是既有枚举（diagnose 侧在用），不是新值；MCP 返回体结构不变。

## 验收

- self 仓：Phase 1 后 false-edges/孤儿数变化逐条可归因；Phase 2 后歧义边计数与探针的
  `ambiguousNameCalls - pinnableViaImports` 口径对齐（误差需解释）。
- **lazygit / petclinic 读数与票 02 冻结基线逐字节相等**（硬断言，红了就是有 Go/Java 泄漏）。
- golden eval 幻觉率仍 0%；控制面单测全绿。

## Comments

- 2026-10-26 立项。Phase 2 会让「可疑」计数上升——这是把任意性搬到台面，不是精度回退，
  读数变化需在票 06 的 CHANGELOG 与棘轮更新里写明。
