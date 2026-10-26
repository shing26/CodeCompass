# 票 03 — 回执、旁车与退出码语义

Status: done

## 背景

检查项有了，但「机器可校验的结论」才是可消费的东西。v1.5.1 的教训：回执自己也要有门
（断链标记漏计是回执的 bug，不是引擎的 bug）。

## 做法

1. `ArtifactBrowserReceipt` 结构与 spec「回执 schema」一致；实现上收成脚本内一个
   `buildReceipt()`（单点构造，禁止在检查分支里散写字段）。
2. 写旁车：默认 `<artifact>.browser-check.json`（与工件同目录，UTF-8、2 空格缩进、键序固定）；
   `--out` 覆盖；写入失败 → 仍以 `UNCHECKED` 退出并打印原因（不静默丢回执）。
3. 退出码：`0=PASS / 1=FAIL / 2=UNCHECKED`；`--json` 向 stdout 打**摘要**
   （verdict + 每 check 一行），完整回执在旁车。
4. 回执结构断言写进 `--self-test`：字段齐、`checks` 数量与被检项一致、
   `verdict` 与 `checks` 自洽（有 FAIL 必须 verdict=FAIL）、诊断码 ∈ 枚举表。
5. 文档化消费契约（写进脚本头部注释）：退出码 2 不等于成功；旁车可能缺失（UNCHECKED 场景），
   消费方必须按 verdict 而非文件存在判定。

## 验收

- good → verdict=PASS、退出 0、旁车字段齐全（含 sha256/browser/durationMs）；
- bad → verdict=FAIL、退出 1、诊断逐条带 check+code+selector；
- 模拟无 playwright（`SMOKE_PW_MODULE=nonexistent`）→ verdict=UNCHECKED、退出 2、写明
  `BROWSER_UNAVAILABLE`；
- 结构自检对构造的畸形回执能判红（证明门有效）。

## Comments

- 2026-10-26 完成。回执 schema `codecompass/artifact-browser-check@1`，旁车
  `<artifact>.browser-check.json`；退出码 0/1/2。
- 已验证：good → verdict=PASS、9 检查全 PASS、退出 0（回执含 sha256/浏览器版本/耗时）；
  三份 bad → verdict=FAIL、退出 1、诊断逐条带 check+code+selector；
  `SMOKE_PW_MODULE=nonexistent-pw` → verdict=UNCHECKED、退出 2、`BROWSER_UNAVAILABLE`。
- 回执结构断言（字段齐、verdict 与 checks 自洽、诊断码 ∈ 枚举）已进 `--self-test`——
  仿 v1.5.1 教训：回执自己也要有门。

