# Ticket 24.6 — eval bucket + 发布 gate + 文档

## 目标
新能力进质量面,零幻觉 gate 扩展到边级。

## 改动点
- eval 新 bucket:
  - `evolve.intent`:意图解析命中率(resolved target 是否命中用户所指,题面从冻结 75 题库复用意图句式新增,v1 ~15–25 题);
  - `convention`:惯例断言锚定正确率 + 覆盖率真实性;
- gate 扩展:图边全部 ∈ session Call Edges(Ticket 01 交付后);evolve/convention bucket 幻觉率 0%;
- 文档:CONTEXT.md 状态行(0.17.0 或延续版本号按发布节奏定)+ CHANGELOG Unreleased;ADR-0013 迁移期缺口声明移除(缺口已修);
- 回归:typecheck 四包、control-plane + repoqa-web 全量、`npm run build`、closeout gate(新增 evolve 冒烟项)。

## 验收
- `bucketPasses` 全绿含新 bucket;75 题冻结题面未被改动;
- CHANGELOG 与版本一致性 gate(root == cli.ts == CHANGELOG)通过。

## 交付记录（2026-09-01, commit 4e416de @ master）

- **eval 新 bucket 已落地**：冻结集 75 → 97 题。`evolve-intent` 14 题（DEPRECATE 动词族 6 变体、EXTEND 中文 doc-chunk 桥、拉丁类名、显式路径锚定；expected=[intentType,targetSymbol]，radar top-1 为 resolvedTarget，endsWith 计命中）+ `convention` 8 题（repo-d 五轴实测值：return_wrapping=bare、interface_impl_style=plain、base_class=none、di_style=constructor、package_layout=com.demo；4 题带 expectedAbsent 反断言）。`expectedAbsent` 命中即计幻觉。计划写 ~15–25 题，实际 22 题在档。
- **gate 扩展**（scripts/e2e/closeout_gate.py，38 → 42 项）：#15 `POST /api/repos/:id/evolve` SSE 五阶段顺序（intent_parse→target_resolve→convention_scan/pipeline→diagram，10 帧严格断言）+ done 四工件结构（intentEcho / result.checklists / commit / 可选引擎 mermaid）；#16 STRICT 惯例冲突——构造 wrapped-return 仓（5/5 ApiResult 路由 + 4 处 @Autowired 字段注入），断言 `repoqa.evolve.error` + `conventionConflict.axis`（实测 axis=return_wrapping）；eval smoke 更新（97 题、incident/evolve-intent/convention 三桶幻觉率 0% 必查）；MCP tools/list 收紧为 ==14（实跑 tools/list 实测 14，v0.18.1 remove_repo 计入）。边级校验 gate 已随 Ticket 01 图层契约落地（ADR-0013 迁移期披露句本次删除）。
- **文档与版本**：CHANGELOG 0.19.0 头（沿用既有条目日期风格，未用 Unreleased——check_versions 取第一个 `## [x]` 标题做一致性比对，Unreleased 会炸 gate）；root/cli.ts/MCP server/control-plane/web/contracts 六处 0.18.1→0.19.0；CONTEXT.md 状态行标注 Issue 24 收官；ADR-0013 删除`“迁移期披露”`句。
- **回归全绿**：四包 typecheck + build；control-plane 40 文件 527/527；web 34 文件 280/280；closeout gate **42/42**（9 桶 eval 全 100%、三桶零幻觉、版本一致性 root==cli==CHANGELOG==0.19.0）。75 题冻结面守恒：repoqa-eval.ts diff 删除行仅 5 行（导入/类型联合/metrics 初始化），零 GOLDEN_DATASET 删改。
- **备注**：合入前 master 新增 3eb18b3（remove_repo 拒删用例排空后台索引）与 17502e4（release 前先 build），与本票 13 文件零重叠；本票分支 rebase 后快进合入，另一会话未提交内容零触碰。
