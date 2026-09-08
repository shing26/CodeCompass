# 06 — 收官：全量回归 + e2e gate + 文档

Status: done

<!-- 完成（2026-09-01）：
- typecheck 四包全绿；control-plane vitest 475/475（eval harness 测试补 15s 超时消 flaky）；repoqa-web 266/266；build 四包全绿。
- closeout_gate.py 增补 incident 冒烟：check_incident_sse_query（粘贴堆栈 → grounded answer 断言 provenance/VERIFIED/BREAK
  + ADR-0010 commit 盖章 anchors）+ eval 检查升级 75 题/全桶 100%/incident 幻觉率 0%。gate 37/37 全绿
  （incident 冒烟 provenance=static、commit=b655af8、4/4 anchors stamped）。
- 版本 0.16.0：root/control-plane/repoqa-web/contracts package.json + cli.ts VERSION + CHANGELOG 顶部条目；
  CONTEXT.md 状态行刷新；spec.md Comments 记录验收结果；repoqa-web 版本随 0.16.0 同步（此前评估项）。
-->

## 目标
- `npm run typecheck`（四包）、后端 + 前端 vitest 全量、`npm run build` 全绿。
- e2e closeout gate 增补 incident 冒烟项（沿用既有 gate 脚本模式）。
- `CHANGELOG.md` 0.16.0 条目；`CONTEXT.md` 状态行刷新（版本/ADR 计数）；spec Comments 记录验收结果。

## 验收
- gate 全绿后方可声明完成。
