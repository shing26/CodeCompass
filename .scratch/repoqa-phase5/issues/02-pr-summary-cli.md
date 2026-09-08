# 02 — codecompass pr-summary CLI

**What to build:** 新增 `codecompass pr-summary <base> <head> [repoPath]` 命令，复用 PR 影响报告契约和确定性 diff 分析。默认输出 CI 友好的 Markdown 摘要；支持 `--output=json` 输出同构 JSON，支持 `--file` 写入报告文件，支持 `--fail-on-impact` 在存在受影响 API、配置变更或未覆盖方法时以非零码退出。该命令是 CI 脚本可直接调用的稳定入口，不启动 Web 服务、不写回用户仓库。

**Blocked by:** 01 — PR Impact Report 契约冻结

**Status:** ready-for-agent

- [ ] `parseArgs` 接受 `pr-summary` 子命令与 `base` / `head` / `repoPath` 位置参数
- [ ] `pr-summary` 默认输出 Markdown，`--output=json` 输出带 `schemaVersion` 的 JSON
- [ ] `--file` 能将报告写到指定路径而不是 stdout
- [ ] `--fail-on-impact` 在 `affectedApis` / `configChanges` / `uncovered` 任一非空时退出 `2`，无影响时退出 `0`
- [ ] 分析失败时退出 `1`，错误信息可读
- [ ] 同一组 `base` / `head` 下，`pr-summary --output=json` 与 `diff --output=json` 的核心分析字段一致
- [ ] 新增 CLI 测试覆盖参数解析、输出格式、`--file`、`--fail-on-impact`；typecheck 通过

## Comments

### 2026-08-25 implementation

- 新增 `codecompass pr-summary <base> <head> [repoPath]`，复用 `diff` 分析逻辑。
- 支持 `--output=json`、`--file`、`--fail-on-impact`；有影响时退出码为 2，否则为 0。
- CLI 测试覆盖参数解析、JSON/Markdown、docs-only 零影响、影响检测等路径。
