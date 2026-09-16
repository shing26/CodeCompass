# Issue 01 — 精度复测基线（度量先行）

> Spec：`.scratch/v031-precision/spec.md` §3（M1/M2）
> 波次：Wave 1 ｜ 依赖：无 ｜ 阻塞：票 02、票 04

## 目标

把「真实仓库假阳性率」从一次性手工取证变成**一条可复跑命令**，并对三个真实样本产出 before/after 对照表。

## 现状证据

- 仓库**没有任何真实仓库精度 harness**：`scripts/` 只有 `e2e/closeout_gate.py`（合成 fixture）与 `smoke/ui_smoke.mjs`；`npm run eval` 跑的是 97 题合成 fixture（`services/control-plane/src/eval/repoqa-eval.ts`）。
- 唯一的真实仓库数字来自 v0.21 一次性取证（`.scratch/scan-dogfooding-v021/`）：lazygit 43% / petclinic 31% / 本仓 83%（**修复前**）。
- 修复后唯一留档数字：lazygit **31.3%**（issue 02 实现备注），另两仓无修复后数字。

## 交付物

1. `scripts/precision/scan_precision.py`（与 e2e gate 同栈：stdlib HTTP + 零 npm 依赖）
   - 对三样本执行 `index_repo → list_repos 轮询 → scan`（真实 REST 面，非 engine 直调——顺带成为 MCP/REST 面的集成探针）
   - 输出各桶计数 + **按固定种子**抽取孤儿桶 top-N 候选（n=10，与 v0.21 同口径，保证可复现与可比）
   - 生成人工核验清单（Markdown，含 `file:line`，供逐条判定）与判定模板
2. `scripts/precision/verdicts/<repo>.json`：人工判定留档（`true-positive` / `false-positive` + 理由）
3. 复核命令：读判定文件算 M1/M2，生成对照表
4. 结果入档：`docs/reports/` 新增真实仓库精度报告（三仓 × 五桶 × 假阳性率）

## 验收

- [ ] 一条命令可复跑三仓（网络失败走 v0.29 T2 的重试分类器，不静默吞错）
- [ ] 产出 before/after 对照表（v0.21 修复前数字 ↔ 当前数字）
- [ ] 抽样判定清单可交付人工核验，核验结果可重算 M1
- [ ] M2（vendor / 测试夹具进榜条数）有独立计数，目标 0

## 已知坑（预先规避）

- **本仓库自扫的污染面**：`.scratch/` 下存有历史样本仓库副本（如 `mcp-probe-data`、旧 fixture），`IGNORED_DIRS` 是否覆盖需实测；测量前先确认，否则本仓数字不可信。
- 大仓（lazygit 2349 文件 / 45k 符号）clone + 索引耗时；脚本需可断点复用已索引 repo（按 name 复用，不重复 clone）。
- 抽样必须**固定种子**，否则两轮数字不可比（v0.21 口径是 top10，需与之对齐并写明）。

## 文件面声明（并行协作）

| 文件 | 归属 | 说明 |
|---|---|---|
| `scripts/precision/**` | 本票新增 | 新目录，零冲突 |
| `docs/reports/`（精度报告） | 共享区 | 新增一份报告文件，收口时一次性 |
| `services/control-plane/**` | **不动** | 本票纯测量，不改引擎 |
