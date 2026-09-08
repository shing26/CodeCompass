# Spec: v0.6 Closeout — 可信收口

Status: ready-for-agent

> 取代根目录《CodeCompass_代码审查与可用性评估报告.md》与《CodeCompass_用户故事与扩展功能方案.md》的优先级与范围结论（两份文档基于 v0.5.0，其 P0/P1 缺陷大部分已在 v0.5.1/v0.6.0 修复）。

## 背景

两份 2026-08-28 的评审文档基于 v0.5.0 代码。经逐项核对当前代码（v0.6.0）：

**已修复/已实现，不再排期：**
- D1 大仓行数误杀：行数只计源码（`repoqa-scan.ts` SOURCE_EXTENSIONS），超限时返回 `suggestedSubdirs`
- D3/D4/D5 消费侧仅 Java：`package.json`/`pyproject.toml`/`.env` 已接入，dashboard 支持四语言
- D6 symbolType 全 unknown：`http.ts` SYMBOL_TYPE_BY_KIND 12 值枚举
- D7 `.mjs`：三处扩展名常量均含
- D8 跨语言桥接：`fetch/axios/apiClient → 路由`（唯一候选才连边）+ `/api/repos/:id/reverse-deps`
- E6 隐私呈现：PrivacyPill 三态 / Token 计数 / provenance 徽章均已实现且有测试
- E8 远程 LLM 问答能力：`REPOQA_LLM_*` 可选配置已可用（缺的是 ADR-0004 的 golden dataset 评测）

**仍然真实的缺口：** 前端接线 4+1 件、CHANGELOG/engines 版本错位、回归基线不可考（e2e harness 从未入库、旧 AC-1~AC-12 清单已丢失）、Go 适配器未实测、增量索引未验证、4 项体验遗留待复验。

## 主线决策（2026-08-28 评审确认）

1. 主线 = **可信收口**：把「宣称与实现」对齐。
2. 回归基线 = **新建精简 e2e**（基于 `.scratch/phase2-gate/e2e_gate.py` 改造入库），不恢复旧 AC-1~AC-12。
3. 分批顺序 = B1 → B2∥B3 → B4。
4. E4 拆两半：caller/callee 视图切换并入（后端子图本就是双向图，direction 是节点属性）；交互展开/折叠推迟到下期首发。

## Issues

| # | 文件 | 批次 |
|---|---|---|
| 01 | [issues/01-changelog-and-engines-alignment.md](issues/01-changelog-and-engines-alignment.md) | B1 |
| 02 | [issues/02-reverse-deps-ui.md](issues/02-reverse-deps-ui.md) | B2 |
| 03 | [issues/03-architecture-delta-mermaid.md](issues/03-architecture-delta-mermaid.md) | B2 |
| 04 | [issues/04-import-suggested-subdirs.md](issues/04-import-suggested-subdirs.md) | B2 |
| 05 | [issues/05-symbol-type-filter.md](issues/05-symbol-type-filter.md) | B2 |
| 06 | [issues/06-caller-callee-view-toggle.md](issues/06-caller-callee-view-toggle.md) | B2 |
| 07 | [issues/07-e2e-baseline.md](issues/07-e2e-baseline.md) | B3 |
| 08 | [issues/08-go-adapter-sample-repo.md](issues/08-go-adapter-sample-repo.md) | B3 |
| 09 | [issues/09-incremental-index-verification.md](issues/09-incremental-index-verification.md) | B3 |
| 10 | [issues/10-ux-leftovers-verification.md](issues/10-ux-leftovers-verification.md) | B4 |
| 11 | [issues/11-context-and-docs-alignment.md](issues/11-context-and-docs-alignment.md) | B1 |

## 验收标准

- `scripts/e2e` 基线全绿（含版本一致性、doctor、五件接线的断言）。
- root package.json = cli.ts VERSION = CHANGELOG 顶部版本；`engines.node` = `>=24` 且与 doctor 一致。
- B2 五件前端接线各有组件级或 e2e 断言。
- 两份根目录评审文档头部有 superseded 标注；CONTEXT.md 术语与 ADR status 修正完成。

## Roadmap（本期不做）

- **下期首发**：E4 完整交互图（展开/折叠）。
- **推迟**：E9 多仓库联合分析、E11 测试/文档生成、E12 协作与分享。
- **E8 评测**：能力已存在；下期先按 ADR-0004 冻结 50 题 golden dataset（固定 commit + 人工标注 anchors），再谈评测与调优。
- **范围外（沿用原文档）**：LLM 模型质量调优、多用户/团队权限、移动端。

## 本期发现的产品边界（记录，不修复）

- **桥接为正向**：TS axios 调用点可链入 Java 路由（forward chain）；反向索引
  （reverse-deps）不含跨语言 caller。若要「路由视角看前端调用方」需补反向桥接边。
- **architecture-delta 路由粒度为 controller 类级**：方法级 `@GetMapping` 不产生独立
  route 符号，在既有 controller 内加端点不报 addedRoutes。
- 单文件解析失败不阻断导入：worker 记录 `repoqa.index.warning` 后跳过（Issue 17 设计）。
