# 票 01 — 评审遗留四项

Status: done

## L1 第四种 verdict 未入册（文档）

票 01 写 verdict ∈ VERIFIED / ANCHORS_MISSING / NO_EVIDENCE；实现多了 `UNCHECKED`
（无仓库根 / 超出 500 条截断）。v1.5.1 已把「截断」与「无 root 跳过」做成 UNCHECKED + 回执级诊断，
少了它这两类只能谎报 VERIFIED。**以代码与 CHANGELOG 四值为准**，票面追认（不改正文）。

## L2 重放块（文档）

票面写 `codecompass trace <symbol>`，实现是 `codecompass export "<symbol>"`——后者才能复现
同一份 HTML 工件；`trace` 输出终端调用树。另「生成时间」在工件 meta 行而非重放块内。票面追认。

## L3 repoPath 越权（代码）

`repoqa-mcp.ts` 的 `withVerificationReceipt` 此前对所有工具接受 `args.repoPath` 当仓库根。
现在收窄为纯函数 `receiptRootFromRepoPath(tool, args)`：只有 `codecompass_get_pr_impact`
（唯一声明该参数的工具）返回路径，其余一律 undefined → 回执退 UNCHECKED，不静默换基准。

## L4 e2e 断言反转（文档）

`closeout_gate.py:1904-1912` 把「断言 Lifecycle 占位存在」改为「断言不存在」——ADR-0021 删了占位，
不改则门禁必红；记录条数未变。「只增不删」的字面被触到，票面追认。

## 验收

- 新增 `verification-root.test.ts` 3 条：get_pr_impact 接受 repoPath / 其余工具忽略 / 缺失空白忽略；
- 控制面 `tsc --noEmit` 零错；`src/mcp` 与全量单测不回归；
- 三条 Comments 落地，v1.5 票面正文未改（git diff 只增行）。

## Comments

- 2026-10-27 完成（独立 worktree）。共享区（CHANGELOG/README/版本五处）按 B1 约定未动，
  版本车次由下一个收口决定。
