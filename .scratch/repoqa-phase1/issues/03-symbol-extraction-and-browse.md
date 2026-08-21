# 03 - Symbol extraction and browse

**What to build:** Let a developer see extracted AST symbols for an imported Java repo, so routes, classes, methods, fields, services, and repositories are navigable with file/line evidence.

**Blocked by:** 02 - Repo import and safe file access

**Status:** ready-for-human

- [x] Java parser extracts class/interface/method/field/route/service/repository symbols with file/line ranges
- [x] Extracted symbols persist with call edges
- [x] Symbol listing supports kind filters and returns non-empty routes for the fixture repo
- [x] Parser failures surface as repo status error with a usable detail message

## Comments

### 2026-08-20 implementation

- 新增 `repoqa-parser.ts`，基于 `@lezer/java` 的 AST 提取 class/interface/method/field，并按 `@RestController`/`@Controller`、`@Service`、`@Repository` 及命名后缀分类为 route/service/repository。
- 方法级 `calls[]` 从 AST `MethodInvocation` 持久化，作为 ticket 05 call-chain 的输入。
- `RepoQARepos.RepoSymbol` kind 扩展为 `class | interface | method | route | service | repository | config | field`；`RepoQAWorker.indexRepo` 在扫描后解析 Java 文件并 `upsertSymbols`，index done 事件上报实际 symbolCount。
- HTTP 新增 `GET /api/repos/:id/symbols?kind=...`。
- Lezer 语法错误节点 `⚠` 会转为 repo `error` 状态，错误信息包含相对文件路径和行号。
- 测试：`repoqa-http.test.ts` 从 5 条扩展到 7 条，覆盖 symbol 提取/过滤和解析失败；`npm test` 通过，control-plane typecheck 通过。
