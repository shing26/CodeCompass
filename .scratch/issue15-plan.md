# Issue 15 — Phase 3 首个子任务：多模块 Maven 支持与真实仓库演练

## 目标
1. 检测并解析父级 pom.xml 的 `<modules>` 声明，递归扫描所有子模块
   `src/main/java` 与 `src/main/resources`。
2. 验证跨模块符号表：Controller(api) → Service(service) → Mapper 接口/实现(dao)
   跨目录定位源码与行号。
3. 多模块单元测试（api/service/dao 三层 fixture）。
4. 全量测试套件 + Golden Eval 持续全绿；真实仓库演练。

## 现状
- `scanRepo` 本就递归（除 IGNORED_DIRS），`parseJavaFile` 以 repo 根计算相对路径 → 跨模块
  路径天然正确；`extractConfigSymbols` 已递归扫所有 pom/application*；callchain 索引已覆盖
  全仓库、接口唯一实现已跨模块解析。
- 真实缺口：`scanPom` 不解析 `<modules>`；无模块布局可见产物；无多模块 fixture 测试；
  callchain `methodsByName` 名基兜底用 `[0]` 无序取首个。

## 改动
| 文件 | 改动 |
|------|------|
| `src/repoqa-parser.ts` | 新增导出 `parsePomModules(source): PomModule[]`（`<modules>` 块内 `<module>` 正则 + 行号，忽略块外 `<module>` 标签） |
| `src/repoqa-scan.ts` | 新增 `MavenModule`、`detectMavenModules(root)`（校验 `root/<name>/pom.xml` 存在、按声明顺序、拒绝路径穿越名）、`mavenSourceRoots(root, modules)` |
| `src/repoqa-callchain.ts` | 名基兜底（同文件 + 全局）从 `[0]` 改为 `pickOverload`（同文件优先 → lineStart 最小），跨模块同名方法确定性选择 |
| `src/repoqa-worker.ts` | `indexRepo` 检测模块：ready 进度 detail 带模块数；模块布局写入证据平面 `repoqa.modules.detected`（JSON：moduleCount/modules/sourceRoots）——不动符号表/前端 |
| `src/repoqa-multimodule.test.ts` | 新增 15 用例：parsePomModules / detectMavenModules / mavenSourceRoots / 跨模块调用链（api→service→dao 实现，精确行号）/ Mapper 无实现 break / 子模块配置与 pom 依赖键 / dashboard 跨模块 scale+topApis / 名基兜底确定性 / worker 端到端（含事件）+ 单模块不产生事件 |

## 关键决策
- 不把 kind 'module' 写进符号表：前端 Sidebar/buildSymbolTree 会把 pom.xml 渲染成空文件组
  （UI 噪声），buildReActContext 也会稀释上下文；需求未要求前端/API 改动。模块布局 →
  证据平面事件 + 进度 detail + 纯函数测试。

## 验证
- `npm test` → 168 passed（153 现有 + 15 新增）
- `npm run typecheck` → 通过
- `npm run eval` → passed，50/50，三桶 100%
- 真实仓库演练：`.scratch/issue15-multimodule/repo/`（api/service/dao 三层仓库）+
  `smoke.ts` 走 `RepoQAWorker.indexRepo` → 模块检测/跨模块调用链（
  `createOrder → submitOrder → MyBatisOrderMapper.insert`）/配置键定位/确定性 break 全部 PASS