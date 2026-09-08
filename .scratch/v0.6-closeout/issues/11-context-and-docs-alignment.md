# 11: CONTEXT.md 术语对齐 + ADR status 修正 + 评审文档标注

Status: done

## 问题

1. 命名三层漂移：仓库名/CHANGELOG 用 **CodeCompass**，`CONTEXT.md` 词汇表产品名是 **RepoPulse**（ADR 标题亦然），代码命名空间是 **repoqa**，环境变量前缀是 **MHW_***。
2. `CONTEXT.md` status 行声称 "21 ADRs accepted"，实际 `docs/adr/` 只有 4 个且全部 `status: proposed`。
3. 两份根目录评审文档（v0.5.0 基线）已过时但无任何标注，读者会误以为其优先级仍有效。

## 任务

1. `CONTEXT.md`：CodeCompass 定为 canonical 产品名；RepoPulse 标注为曾用名；记录三层命名映射（CodeCompass=产品名 / repoqa=代码命名空间 / MHW_*=宿主工作台环境变量前缀）；修正 status 行。
2. ADR 0001（只读 Local-First）/0002（确定性静态分析优先）/0003（LLM 前安全门禁）已 de-facto 兑现 → 转 `accepted`；0004（golden dataset 先行）未兑现 → 保持 `proposed`。
3. 两份根目录文档头部加引用块：「优先级与范围已被 `.scratch/v0.6-closeout/spec.md` 取代（基线 v0.5.0，大部分缺陷已在 v0.5.1/v0.6.0 修复）」。

## 验收

- 词汇表术语、ADR status、文档标注三者一致，无「21 ADRs」式失实陈述。
