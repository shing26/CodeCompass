# 票 04 — import/export 声明解析 + 相对路径模块表

Status: done

## 交付

1. **`engine/repoqa-module-resolution.ts`（新）**——纯函数解析器 + 消解器：
   - `parseModuleDeclarations(source)`：只认声明语句。named / aliased / default / namespace
     import、`export const|function|class|interface|enum|type`、`export { a as b }`、
     `export {...} from`、`export * from`。**type-only 声明跳过**（类型名不会被调用）。
   - `resolveRelativeSpecifier(from, specifier, fileSet)`：只解析 `./`、`../`（L1）。
     bare specifier、tsconfig 别名、出仓路径一律 `null`——不猜。
   - `buildModuleImportTable({files, readFile})`：产出 `caller → localName → 声明文件`。
     `export * from` **展开到真正声明文件**（barrel 不许吞掉 pin），带循环护栏；
     返回 stats（文件数 / 声明数 / 解析成功与失败数 / 绑定数）。
   - `pinnableTarget(table, callerFile, name)`：票 05 的接线判据；namespace 导入不参与
     （它给的是模块对象，不是名字）。
2. **落库**：`db.ts` 新增 `repo_module_imports(repo_id, file_path, local_name, target_path, kind)`
   （新表用 `CREATE TABLE IF NOT EXISTS`，旧库无需迁移）。`repoqa-repos.ts` 新增
   `listRepoFiles` / `replaceModuleImports` / `replaceFileModuleImports` /
   `deleteModuleImportsForFile` / `getModuleImports`，并把新表纳入
   `clearRepoData` / `deleteRepo` 的级联清理。
3. **索引期构建**：`indexRepo` 在 AST 之后、写库收尾处构建并整仓替换；`reparseFile` 用
   全仓文件列表重建（`export *` 展开需要邻接声明，只喂单文件会把 barrel 的 pin 退化成
   barrel 本身）、只替换该文件的行；`removeFile` 删行。**不接线**——跨文件绑定仍是 v1.5 行为。
4. **对账探针** `scripts/precision/module_table_check.ts`：用**落库后的表**复算「同名歧义边
   里可钉死多少」，并与票 01 的探针读数给出口径拆解。

## 对账结果（self 仓，同一工作树）

| 口径 | 数值 | 说明 |
|---|---|---|
| 探针 `pinnableViaImports` | 1309 | **模块级**：候选文件 ∈ caller import 过的模块集合 |
| 本表模块级复算 | 1229 | 同上口径、用索引期解析复现 |
| **本表名字级（本票判据）** | **884** | 要求该名字确实被 import 绑定到该文件 |
| 覆盖率 | 0.675 | 884 / 1309 |

差额拆解（3356 条同名歧义边）：`pinnable 884` + `moduleImportedNameNot 328` +
`bindingNotDeclaring 31` + `noBinding 2113`。

- **328 条是判据差、不是缺陷**：模块 import 了、但**这个名字没被 import**——词法上该名字不在
  caller 作用域里，探针按模块算会把它当成可钉死，本表不认。以 884 作为 Phase 1 的**目标线**
  更诚实（票 05 按这个数验收）。
- **31 条 `bindingNotDeclaring`**：绑定指到的文件不声明该名字（重导出 / 默认导入 / 只声明了
  别的 kind 的符号）。留票 05 逐条归因，不在这里拍平。
- 表规模：982 行 / 197 个文件（247 个 TS 文件里 50 个只有 bare 导入，无绑定）。

## 门禁（`build` / 单测 / 三仓 / e2e）

- `npm run build` 四前缀 EXIT=0；控制面 **70 文件 / 886 测试**全绿（新增本票 16 条单测）。
- e2e `closeout_gate.py`：**73 passed, 0 failed**（索引路径改过，必须跑）。
- 三仓重量 + `campaign_baseline.ts compare --must-match lazygit,petclinic`：
  **lazygit / petclinic IDENTICAL**；self 7 项漂移全部可归因——`commit` 前进 + 本票新增 5 个
  文件（`symbolCount` 2271→2301、`orphanedPublic` 173→179、hubs 1828→1857），
  即**只有新文件的自然增长，没有行为改变**（本票不接线，符合预期）。

## Comments

- 2026-10-26 完成。踩到并修掉一个真 bug：`export {...} from './x'` 被 `export {...}` 的
  正则误判成本地导出（`}\s*(?!from)` 里的 `\s*` 会回溯到零字符从空格处通过），
  导致 barrel 再导出的 pin 退化成 barrel 本身——单测「follows a named re-export」把它钉住。
- 本票 16 条单测覆盖：解析四种 import + type-only 跳过、相对/父级/目录 index 解析、
  `.ts` 优先于 `.js`、bare/别名/出仓一律 null、star 与 named 再导出追到声明文件、
  循环护栏、namespace 不参与 pin、非 TS/JS 不入表、解析失败只计数不报错。
- 未做（票 05）：wire 到 `repoqa-callchain.ts` 的跨文件绑定；31 条 `bindingNotDeclaring` 的归因；
  Phase 2 的 `SUSPECT` 显式化。
