# 07: 精简 e2e 基线入库（scripts/e2e/）

Status: done

## 问题

两份评审文档的验收手段「重跑 `codecompass_e2e_harness.sh` 至 AC 全绿」不存在：该脚本从未入库，`CodeCompass_E2E_验证计划.md`/`e2e-result.json` 已丢失，旧 AC-1~AC-12 状态不可考。可用的底子是 `.scratch/phase2-gate/e2e_gate.py`（含 sample-java fixture）。

## 任务

1. 基于 `e2e_gate.py` 改造为 `scripts/e2e/`（Python，无新依赖倾向），正式入库成为长期回归门禁。
2. 断言集（每条独立可读的 PASS/FAIL 输出，末尾汇总）：
   - 启动服务 → `doctor --json` 全绿
   - 版本一致性：root package.json = cli.ts VERSION = CHANGELOG 顶部
   - 导入 Java 样本仓 → dashboard techStack/topApis/configKeys 非空
   - 导入 TS 样本仓（dogfood 自身或 fixture）→ 同上非空（消费侧多语言回归）
   - 调用链查询返回 mermaid + 锚点
   - 跨语言桥接：前端 HTTP 调用点 → 后端路由的边存在
   - `/api/repos/:id/reverse-deps` 返回 200 且结构合法
   - architecture-delta 响应含 `mermaid` 字段
   - `/api/repos/:id/symbols` 的 symbolType 非 unknown 占比 > 90%
3. README/根文档注明运行方式；后续 B2 每件接线在此追加一条断言。

## 验收

- `python scripts/e2e/... `（或等价入口）一键跑完、全绿、有汇总输出；CI 或本地均可跑。

## Comments

- 2026-08-28：交付 `scripts/e2e/closeout_gate.py`（stdlib-only，无 Playwright），自建
  Java+TS / Python / Go 三语言 fixture（polyglot 仓含两个 git commit），12 条断言全绿
  （`e2e-result.json`）。契约/边界澄清：桥接为正向（TS 调用点 → Java 路由可达），
  reverse-deps 不含跨语言 caller；architecture-delta 路由粒度为 controller 类级；
  单文件解析失败以 `repoqa.index.warning` 事件记录后跳过。详见 `scripts/e2e/README.md`。
- 2026-08-28（code-review 批注）：断言集补齐——新增 `/query` SSE 流断言（mermaid +
  anchors，任务 2 原文要求）与 **ADR-0003 masking 硬门禁**（`.env` key 名可见、值
  不出现在 dashboard/symbols 载荷），共 13 条。
