# 票 05 — `codecompass trace` + `export --output`

Status: closed（已落地，2026-10-19，tag v1.4.0）

## 背景
用户第三步原文：`npx codecompass trace ./src/auth.ts -f login` 直接在终端用 ASCII 树打印上游和下游调用方。现状：无 `trace` 命令（`context`/`diagnose` 为近似但非该形态）；`export` 只认 `--file`，用户示例的 `--output` 不存在。

## 目标
一行命令在终端出结果：`codecompass trace <符号|文件> [repoPath]`，ASCII/Unicode 树形打印上游（谁调我）与下游（我调谁），支持文件+函数名过滤。

## 实现要点
1. **命令形态**（`cli.ts`，`dir` 命令族）：
   ```
   codecompass trace <symbol|file> [repoPath] [-f <name>] [--up N] [--down N] [--json] [--ascii]
   ```
   - `-f`：目标视为文件（路径片段或文件名），按名过滤该文件内符号（精确 > 前缀 > 包含，多命中列出候选并退出码 1）
   - 默认 `--up 1 --down 2`（D4 裁决）；上限 5
   - 复用 `withAnalysisStack`（同 diagnose/export 的仓库解析与索引路径）
2. **图遍历**：下游 = `CallResolver` 逐层展开（带 visited 防环、break 标注 reason）；上游 = `buildFullCallersIndex`（含 route 符号，`reverseCallers` 会丢 route 出边）
3. **输出**：
   - 默认 Unicode 制表（`├─ └─ │`），`--ascii` 纯 ASCII（`+- |`）
   - 每个节点：`name — file:line`（相对 repoPath），break 节点标 `[静态分析边界: EXTERNAL|UNRESOLVED|DYNAMIC]`
   - 统计行：上游 N 个 / 下游 M 个 / 边界 K 处
   - `--json`：结构化 `{ target, up: [...], down: [...], breaks: [...] }`
4. **`export --output`**：`--output=` 作为 `--file=` 的别名（两参互斥时报错），USAGE 同步；README 命令表同步。
5. 退出码：目标找不到 = 1 + 候选列表；解析成功 = 0。

## 验收
1. CLI 测试（cp 包内）：对 e2e 夹具仓跑 `trace` —— 树形输出含预期上下游名字；`-f` 过滤命中/多命中候选；`--json` 形状；`--ascii` 无 Unicode 制表符；`--output` 与 `--file` 等价、同传报错。
2. 真机：对本仓 `npm run build` 后 `node bin/codecompass.js trace RepoQAClient -f getRepo <repoPath>` 得到合法树（自测记录入 Comments）。
3. USAGE 文本 + README 命令表更新。
4. 无 LLM 依赖；输出全部确定性。

## Comments
**2026-10-19 落地。** 证据：
- 引擎 `engine/repoqa-trace.ts`（纯函数）：双向树、深度上限 0–5、环/共用节点标注、三分类边界计数、Unicode/ASCII 两套制表、确定性排序。
- CLI：`trace <symbol|file> [repoPath] [-f <name>] [--up N] [--down N] [--ascii] [--json]`；`export --output <path>` 作为 `--file` 同义（仅 export 合法，双传报错）；USAGE 同步。
- 测试：`engine/repoqa-trace.test.ts` 14 项；`repoqa-cli.test.ts` 新增 7 项解析断言。
- **真机冒烟**（本仓 dist）：`trace repoqa-repos.ts -f getRepo .` → 目标 L450；上游 5 个真实调用方、下游 `mapRepo`、`Static analysis breaks: DYNAMIC x4`。
