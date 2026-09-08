# M3 取证报告：scan dogfooding 回访（compass-copilot 首个真实任务）

> 执行：2026-09-07，compass-copilot@32efa0b+（M2 后），LLM 路径 + 确定性路径双轨取证。
> 仓库：lazygit（Go，1228 files / 10523 symbols）、spring-petclinic-microservices（Java 多模块，206 files / 595 symbols）。
> 证据文件：本目录 `*-scan.json`、`lazygit-reverse-deps-Run.json`、`llm-*.txt`（JSONL 会话日志在 `~/.compass-copilot/sessions/`）。

## 一、0.22.0 四修复验证（引擎层，确定性路径）——全部通过

| # | 修复 | 验证方法 | 结果 |
|---|---|---|---|
| ① | vendor 排除 | lazygit 文件数 + scan 载荷 grep "vendor/" | **1228 files**（修复前 workbench 索引 2349）；vendor 残留 **0** ✓ |
| ② | Go 调用边静态解析 | `reverse_deps Run`（lazygit） | **209 个调用者**，精确命中 `pkg/app/entry_point.go` `Start` 的 **callLine 177**——0.22.0 声明里"有真实调用点却报零调用者"的冤杀点已复活 ✓ |
| ③ | isTestPath 补全 | 双仓库 scan 载荷 grep `_test.go`/`.test.`/`test_*.py` | 残留 **0** ✓ |
| ④ | 空桶引导 | deepChains total=0 的 nextAction | 中性文案 "No candidates found by this bucket's deterministic rules — nothing to act on here."（不再指向不存在的候选）✓ |
| — | 孤儿率回归 | orphanedPublic.total / symbolCount | lazygit **31.3%**（3295/10523）——与 0.22.0 声明的 43%→31.3% 精确吻合 ✓ |

## 二、issue 04 取证（孤儿桶 DI/入口点假阳性）——坐实，needs-triage 应转正

petclinic orphanedPublic（184 项）中确认的框架入口假阳性：

- **main() × 2**：`SpringBootAdminApplication.main`、`ApiGatewayApplication.main`——微服务进程入口，绝无静态调用者是常态
- **@SpringBootApplication 类 × 2**：`SpringBootAdminApplication`、`ApiGatewayApplication`
- **@Bean 方法**：`ApiGatewayApplication.loadBalancedRestTemplate` / `loadBalancedWebClientBuilder` / `routerFunction` / `defaultCustomizer`
- **Feign 客户端类**：`CustomersServiceClient`、`VisitsServiceClient`（声明式客户端，容器实例化）

**危险引导仍在**：orphanedPublic 的 nextAction 至今为 "Plan a safe teardown with codecompass_module_evolution (DEPRECATE) before deleting anything."——对含进程入口和 DI 装配点的桶直接建议 DEPRECATE 拆除。

**给线 A 的修复建议**：候选识别层（`@Bean`/`@FeignClient`/`@SpringBootApplication`/`main` 标注或命名识别）降权或移出 orphanedPublic；nextAction 措辞改为"先验证框架可达性（反射/DI/入口点），再考虑拆除"。issue 06 同理见下。

## 三、issue 06 取证（hubs getter/setter 占榜）——Go 仓库形态坐实

- lazygit hubs top-10：**3/10 严格访问器**（`Commit.Hash`、`MergeConflictsController.context`、`LocalCommitsController.context`）+ **2/10 宽口径属性式**（`View.InnerWidth`、`Views.regularView`）≈ 30-50%
- Go 无 `get/set` 前缀惯例——占榜形态是 **`Type.field` 属性名方法**；petclinic（Java）top-10 为 0，但 Java 的 get/set 需在更深列表核对
- 0.22.0 备忘的"命名+行数双条件"过滤建议方向正确，Go 侧需按 `Type.field` 形态识别

## 四、对话层验证（真实 LLM 会话）——发现并修复两个编排层 bug

| Bug | 级别 | 现象 | 根因 | 修复 |
|---|---|---|---|---|
| M3-01 | P1 | 步数耗尽后答案为空：模型 3 轮工具调用打满 `MAX_STEPS=3`，合成答案的回合永不发生，用户看到空白 | 工具循环无强制合成回合 | 修复：循环退出时若最后一轮是工具轮，追加一次无工具合成请求（`agent.ts`，含回归单测） |
| M3-02 | P2 | 用户问"能否删除"，模型自作主张执行 `module_evolution` DEPRECATE 拆除计划 | system prompt 未约束演进工具的使用时机 | 修复：纪律第 6 条——演进工具仅在用户明确要求时调用；"能否删"给分析判断；孤儿桶候选必须 SUSPECT 框架可达性 |

修复后复验（同问题重跑）：答案完整（五桶表格 + 删除概率分级：main 入口=低、@Bean 配置=中低、纯辅助=高）；sources 干净（仅 list_repos + scan，无演进管线）；SUSPECT 框架全程在线。lazygit 会话：hubs top-5 如实汇报、不为迎合问题编造噪音、孤儿误报分析含 reverse_deps 验证步骤。

另记录：一次 lazygit 会话早退（connect 后无输出即退出，未复现，疑似管道 EOF 竞态）——低置信 flake，留观。

## 五、结论

- CodeCompass 0.22.0 的四修复**在 MCP stdio + 真实 LLM 会话路径上全部复验通过**，dogfooding 闭环成立。
- issue 04/06 证据齐备，建议转正进入线 A 下一版本（修复方向见上）。
- copilot 编排层两 bug 已修复（24/24 单测），对话层判断质量达到"可解释、可溯源、不越权"的预期形态。

## 六、增补（2026-09-07 晚，三轮用户对抗性测试后）

**新引擎层发现（给线 A）：孤儿桶总数跨索引不稳定。** 同一 petclinic 仓库（206 files / 595 symbols 不变），上午索引 orphanedPublic total=**184**（孤儿率 30.9%），晚间重索引 total=**154**（25.9%），相差 30。0.22.0 门禁宣称 golden eval 完全确定性——孤儿桶 total 的跨索引稳定性需要引擎侧排查（怀疑与 FS-watcher 残留或符号去重时序有关）。附注：copilot 的 LLM 在无 [cite: N] 锚点时报出的 154 恰与最新引擎输出一致——锚点缺失使数字漂移无法追溯，cite 纪律的价值被反向证明。

**编排层修复追加（`a1183b1`/`db846e5`）**：system prompt 第 8 条（语言一致性 / remove_repo 误用纠正 / 禁通配 target / cite 强化）；重试回合可见化（重新生成前输出提示，消除双答案观感）。

**用户真机复验结论（第三轮）**：零泄漏 ✓、演进管线零擅自执行 ✓（模型改为先请求确认——rule 7 生效）、答案结构完整 ✓。质量层残留（模型行为限制，prompt 已约束但执行力依模型）：桶名/通配 target 的建议仍会出现（引擎 fail-closed 兜底）、正文 [cite: N] 锚点时有时无、中英术语混杂。**M4 输入**：拆除计划卡片化、cite 点击渲染、默认模型选型对比（当前模型有文本假调用倾向）。
