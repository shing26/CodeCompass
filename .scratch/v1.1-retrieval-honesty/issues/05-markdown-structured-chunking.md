# Issue 05 — `.md` 整文件 `slice(0, 4000)` → 结构化切分

> 依据：审计 v2 的 D4 段只说到"chunk 仅 README/md + Java Javadoc"；本仓实测**更弱**——md 根本不切分
> 波次：波 2 ｜ 状态：**已落地（2026-09-28，与票 04 同 commit）** ｜ 依赖：票 04（同文件，串行）

## 1. 现状（实测）

```ts
// services/control-plane/src/ingest/repoqa-worker.ts:2063
content: maskedContent.slice(0, 4000),
```

`.md` / `readme*` 读全文后取前 4000 字，**单条 chunk** 入 `chunkType: 'readme'`。

后果：**超过 4000 字的文档，后半部分完全不可检索**——本仓 `docs/` 与 ADR 里长文不少，且"关键结论在文档后半"是常态。

## 2. 落地

- 按 **`##`**（其次 `#` / `###`）切分；每块把 **breadcrumb**（如 `h1 > h2`）写入 chunk 元数据。
- `chunkType: 'readme'` **保持不变**（下游按类型过滤的面不改）。
- 覆盖两个入口（`readme*` 前缀与 `*.md` 后缀走同一分支）。
- 与票 04 合并一次 chunk 计数冻结。

## 验收（机器可验证）

1. 单测：> 4000 字的 md 产出 **≥2** chunk，且每块元数据含 breadcrumb。
2. 检索回归：9 桶不降；新增 1 条用例——查询词**只出现在文档后半**时能命中。
3. chunk 计数变化与票 04 **同轮冻结**（一次，不抖动）。
4. 脱敏不变式同票 04（ADR-0003）。

## Comments

- 2026-09-27 立项。与票 04 同文件、共享 `extractChunks` 的一个分支，**必须串行**（HANDOFF §2.2 目录纪律与双 agent 协作经验：同文件两票并行必撞）。
- 2026-09-28 **落地**（`repoqa-chunker.ts::splitMarkdownSections`，与票 04 同 commit、基线一次冻结）：
  - **实现**：ATX 标题（#–######）切节；breadcrumb 取 `h1 > h2` 链（h3+ 起新节但沿用链）；**fenced code block 内的 `#` 行不切**（本仓 docs/bash 块防误切）；超 4000 字的节按行边界续切（同 breadcrumb、lineStart 单调推进）；无标题文档 >4000 也切（旧逻辑静默截断的根除）。`chunkType: 'readme'` 不变。
  - **breadcrumb 落法裁决**：票面「写入 chunk 元数据」——schema 无元数据列，落为 **content 首行前缀 `[h1 > h2]`**（可检索、LLM 可读、零 schema 手术）；如需独立列随未来 schema 批再议。
  - **验收逐条**：① >4000 字 md 产出 ≥2 chunk 且每块含 breadcrumb（单测）；② 9 桶不降（全 100）+ 「查询词只在文档后半」集成用例（`zuniqueterm` 位于 4000 字之后，经 FTS 镜像命中——票 03 索引覆盖新 chunk 的同轮验证）；③ chunk 计数与票 04 同轮一次冻结（3389，见票 04 Comments）；④ 脱敏同链路（mask→split→入库）。
  - 门禁：控制面 **766/766**、eval 101 题 exit 0、e2e **71/0**。