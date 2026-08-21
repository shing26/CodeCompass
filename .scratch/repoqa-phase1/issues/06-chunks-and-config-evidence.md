# 06 - Chunks and config evidence

**What to build:** Let a developer find environment and configuration answers with deterministic evidence: README/doc chunks plus config key names and locations, never values.

**Blocked by:** 03 - Symbol extraction and browse; 04 - SSE query skeleton

**Status:** ready-for-human

- [x] README and doc-comment chunks are indexed and searchable
- [x] Config keys are deterministically extracted from application YAML/properties and pom files
- [x] Environment answers expose key names and file locations, never values
- [x] Config and chunk evidence flows through SSE-based environment queries

## Comments

### 2026-08-20 implementation

- Worker 在 import 时新增 `repoqa-config.ts` 提取 `application*.yml/properties`、`pom.xml` 的 config 符号到 `repo_symbols(kind=config)`，只保存 key name/file/line，不保存 value。
- `extractChunks` 将 README/markdown 和 Java Javadoc 写入 `repo_chunks`；新增 `GET /api/repos/:id/chunks?q=` 提供可搜索访问。
- `queryRepo(mode=environment)` 返回 config keys 与匹配 chunk counts，SSE 中不渲染 config values/local absolute paths（本阶段尚未进入 secrets 装填）。
- 测试新增 config/chunk 不泄露 value 的集成场景；控制平面 12 条测试全通过，typecheck 通过。
