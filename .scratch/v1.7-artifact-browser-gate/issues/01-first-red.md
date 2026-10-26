# 票 01 — 先红：缺口的可复现证据与 fixture 生成

Status: done

## 背景

v1.7 的立项前提是「现有门抓不到工件不可用」。这条必须先被证明，否则整批是凭感觉加门。
沿用 v1.1 的做法：**先红留证，再写实现**。

## 做法

1. 新增 `scripts/smoke/make-artifact-fixtures.mjs`：
   - 在 `tmp` 下复刻 `release.yml:45-85` 的最小 demo 仓（Java controller/service/mapper + TS client，11 文件以内）；
   - 跑 `node services/control-plane/dist/cli.js export listOwners --repo <demo> --file good.html`；
   - 复制 good 生成三份 bad：
     - `bad-syntax.html`：把首个 mermaid 源码替换成 `flowchart LR\n  A -->`（残缺）；
     - `bad-lazy.html`：删掉 `<script>${VIEWS_JS}</script>` 段（模拟 lazy view 死）；
     - `bad-beats.html`：删掉 `<script>${STORY_BEATS_JS}</script>` 段（模拟步进死）；
   - 只提交生成器，产物留在 tmp（不进 git；路径打印到最后一行）。
2. 用现有门对三份 bad 各跑一遍并记录：`npm run test --prefix services/control-plane`（export-artifact 用例）
   与 `python scripts/e2e/closeout_gate.py` 的 artifact 相关项——预期**全绿**，即缺口成立。
3. 用真 Chromium（手工或 3 行 playwright 脚本）确认三份 bad 在浏览器里确实坏：
   mermaid 报错/白屏、切 Sequence 无图、Next 按钮无效。

## 验收

- `node scripts/smoke/make-artifact-fixtures.mjs` 可重复生成四份工件，路径稳定打印；
- 三份 bad 的现有门判定全绿（命令 + 输出摘录进 Comments）；
- 三份 bad 的浏览器故障现象各有一句可复核描述（DOM 读数或控制台文本，不必截图入档）；
- 不修改任何实现文件。

## Comments

- 2026-10-26 完成。
- 生成器：`scripts/smoke/make-artifact-fixtures.mjs`（复用 `release.yml:45-85` 的 demo 仓；产物只在 tmp，不进库）。
- 先红证据（命令与读数）：
  - 旧 e2e 谓词（复刻 `closeout_gate.py:1797-1802` 的 `mermaid in content && <!DOCTYPE html>`）
    对 good / bad-syntax / bad-lazy / bad-beats **四份全为 true**；v0.9 最小谓词同样全 true。
  - `vitest src/export-artifact.test.ts` 10/10 绿——单测不消费文件，天然抓不到。
  - 真 Chromium 复核：bad-syntax 页面出现 `Syntax error` 文本；bad-lazy 点 Sequence 后
    `#view-sequence` 仍 `display:none`、无 SVG；bad-beats 的 `#beat-label` 初始为空、点 Next 不动。
- 结论：缺口可复现，票 02/03 的门才有立项依据。

