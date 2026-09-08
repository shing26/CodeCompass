# CodeCompass Phase 5 — PR/CI 影响摘要闭环（RepoPulse）

**Status:** ready-for-agent
**Source:** HANDOFF.md §9 后续方向、docs/repoqa-prd.md §12 Roadmap、docs/repoqa-plan.md §14 Phase 4 Extension Notes
**Scope:** Phase 5 只新增 PR/CI 消费层；复用 `diff` 的确定性分析，不改既有 `diff --output=json` 字段语义，不引入 LLM。

---

## Problem Statement

当前 `codecompass diff <base> <head> [repoPath]` 已经能产出一份只读 PR 架构影响报告：受影响 Java 符号、反向可达的 `@RestController` API、配置键变更、Mermaid 与 Markdown/JSON 输出。但这份能力目前是从终端手工消费：JSON 没有 schema version，CI 想判定“本次 PR 是否触及核心 API / 配置”要自己做 shell 解析；MCP Agent 也只能查已索引仓库的 dashboard/tours/config，无法直接问“这个 base→head 会影响哪些 API”。

PRD 剩余路线与交接文档都点名了同一个方向：让 `codecompass diff --output=json` 可直接被 CI/PR 机器人消费，并将 MCP 工具扩展。Phase 5 要做的是把已有的确定性 diff 结果变成一个稳定的跨栈契约、一个可脚本化的 `pr-summary` 命令、以及一个 MCP 可调用的 PR 影响工具，从而让 PR 评审、Agent 提问和 CI 门槛共用同一份证据。

## Solution

在现有只读 diff 能力之上新增一层“PR/CI 影响摘要闭环”：

- **稳定 JSON 契约**：`codecompass diff --output=json` 与新的 PR 摘要都输出带 `schemaVersion` 的报告；字段只增不改，旧消费者不受破坏。
- **新 CLI 子命令 `codecompass pr-summary <base> <head> [repoPath]`**：复用同一套 diff 分析，默认输出 CI 友好 Markdown；支持 `--output=json` 输出同构 JSON，支持 `--file` 落盘，支持 `--fail-on-impact` 让 CI 在产生 API/配置影响时以非零码退出。
- **MCP 工具 `codecompass_get_pr_impact`**：Agent 可传入 `repoPath/base/head` 直接获得 PR 影响摘要，不要求该 repo 先被索引；输出仍遵守“只报键名与位置，值永不输出”的脱敏约定。
- **共享分析入口**：CLI 与 MCP 都只调用同一份 PR 影响分析函数；`diff`、`pr-summary`、MCP 三种消费面不会出现规则漂移。

全过程保持零 LLM、零写回：只读 git 对象、参数数组调用 git、超时与脱敏规则与 Issue 22 一致。

## User Stories

1. As a CI maintainer, I want 一条命令生成可贴到 PR 评论里的影响摘要 Markdown, so that 不用先跑 `git diff` 再手工拼接解释。
2. As a CI maintainer, I want JSON 输出包含 `schemaVersion` 和稳定的影响计数, so that 我的流水线可以安全地消费和升级。
3. As a CI maintainer, I want `--fail-on-impact` 在影响非空时返回明确非零退出码, so that 我可以做“核心 API/配置受影响必须人工审”的门禁。
4. As a PR reviewer, I want 摘要集中显示受影响 API、配置键与未覆盖方法, so that 我不用逐个 diff 文件看整体影响。
5. As an Agent/Codex 用户, I want 通过 MCP 直接询问 base→head 会影响哪些 API, so that 我不需要先启动 Web 服务或手工跑 CLI。
6. As a contributor, I want `pr-summary` 与 `diff` 的分析结果一致, so that 我在本地看到的内容和 CI 判定不会打架。
7. As a maintainer, I want `--file` 支持把报告写到 CI artifact 路径, so that 日志和产物分离。
8. As a security reviewer, I want 摘要里永远只有配置键名和位置、没有配置值, so that CI 不会把 secret 带进评论或日志。
9. As an MCP client, I want `tools/list` 能发现 `codecompass_get_pr_impact` 及输入说明, so that 标准 Agent 客户端可以直接调用它。
10. As a developer, I want 报告包含 base/head 的短 SHA 与变更文件概览, so that 我能确认 CI 分析的是哪一版 PR。

## Implementation Decisions

- **命令形态**：新增 `codecompass pr-summary <base> <head> [repoPath]`；`diff` 保持原行为。`pr-summary` 与 `diff` 共用同一份核心分析函数和同样的 Markdown/JSON 渲染入口。
- **JSON 契约**：报告对象新增 `schemaVersion: 1` 与 `summary: { changedFiles, modifiedSymbols, affectedApis, configChanges, uncovered }` 字段；既有字段保留原名，不做重命名。
- **退出码**：`pr-summary` 成功且无 `--fail-on-impact` 时退出 `0`；分析失败退出 `1`；`--fail-on-impact` 且任一 `affectedApis` / `configChanges` / `uncovered` 非空时退出 `2`。
- **MCP 扩展**：在现有 MCP 工具表新增 `codecompass_get_pr_impact`，输入 `repoPath/base/head`，输出 JSON 报告；该工具走纯函数直接分析 git 对象，不依赖 SQLite repo 是否 ready。
- **共享入口**：新增/暴露一个 `buildPrImpactReport` 或等价函数，供 CLI 与 MCP 调用；避免复制分析逻辑。
- **脱敏**：PR 摘要绝不包含配置值、文件原始内容或敏感上下文；只输出符号名、文件路径、行号、Mermaid 图。
- **CLI 解析**：沿用现有参数数组风格，`pr-summary` 支持 `--output markdown|json`、`--file`、`--fail-on-impact`；未知参数报错并提示 usage。
- **只读原则**：继续使用 `execFile` 参数数组与超时；不 checkout、不写用户仓库、不启动 HTTP 服务。

## Testing Decisions

- **主 seam**：`repoqa-diff` 的 `analyzeDiff` / 渲染函数，以及 `repoqa-cli` / `repoqa-mcp` 已有测试入口；新增测试只围绕“外部可见行为”推进。
- **CLI 测试**：断言 `parseArgs` 接受 `pr-summary` 参数；`runCli` 对临时 git 仓库输出 Markdown/JSON；`--fail-on-impact` 在影响存在时返回退出码 2、无影响时返回 0。
- **MCP 测试**：断言 `MCP_TOOLS` 包含 `codecompass_get_pr_impact` 及其输入 schema；`tools/call` 对临时 git 仓库返回 JSON 报告，且配置变更不含值。
- **Diff/Summary 一致性**：对同一组 base/head，`diff --output=json` 与 `pr-summary --output=json` 的核心分析字段一致，证明两者共享同一规则。
- **Prior art**：沿用 `repoqa-diff.test.ts` 的临时 git fixture、`repoqa-mcp.test.ts` 的内存 DB / stdio client、`repoqa-cli.test.ts` 的 `parseArgs`/`runCli` 模式。

## Out of Scope

- GitHub/GitLab webhook、token、自动评论发布、PR 状态回写。
- LLM 生成的评审观点；摘要只展示确定性事实。
- 多语言、动态 tracing、工作区未提交 diff、写回/重构。
- 团队协作、多租户、企业 SSO 与网络隔离部署。

## Further Notes

- 术语沿用 `CONTEXT.md` 的 RepoPulse Glossary：Call Chain、Anchor、Static Analysis Break、Sensitive Context Masking、Golden Dataset 等。
- 遵循既有 ADR 的本地优先只读、结构化静态分析优先、脱敏双层原则。
- 本 spec 是 HANDOFF §9 “`codecompass diff --output=json` 可直接供 CI/PR 机器人消费；MCP 工具可扩展” 的实现化落点。
