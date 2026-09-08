# Ticket 24.2 — Pattern Ingestion 引擎(ADR-0014)

## 目标
确定性惯例嗅探复合工具:演进建议的事实底座,零 LLM、可单测、可重放。

## 命名与位置
- worker 方法:`runConventionScan({ repoId, targetSymbol?, nearPackages? })`;
- agent 工具名:`convention_scan`(进 `buildAgentTools`);
- MCP 名(Issue 25,本 ticket 不做):`codecompass_get_conventions`。

## 嗅探轴 v1(Java 优先,TS 优雅降级为 unsupported)
1. 返回包装约定:Controller 方法返回类型分布(统一包装类 vs 裸对象);
2. 接口-实现风格:Service 接口/实现比(单接口单实现 vs 直接类);
3. Base 类惯例:BaseController/BaseDTO/BaseService 继承检测;
4. DI 风格:字段 @Autowired vs 构造器注入;
5. 包路径惯例:功能包命名 root 与分层包结构。

## 输出契约
```jsonc
ConventionProfile = {
  axes: [{ axis, verdict, coverage: {match, total}, anchors: [{file, line, symbol}], dissidents: [{file, line}] }],
  sampledAt: commit   // dirty 记 commit+dirty
}
```
- 每条断言必须 ≥1 个物理锚点,锚点过 raw-file 校验;
- 仲裁:落位目标同包/同业务域近邻优先 → 近邻分裂或缺失时全局多数 → 强制披露(异类清单进 axes[i].dissidents)。

## 验收
- golden repo fixture 单测:各轴断言/覆盖率/锚点精确匹配;
- 近邻优先场景:同包 3/3 与全仓 7/12 冲突时 verdict 取近邻,披露含全局分歧;
- 锚点有效率进 eval convention bucket(Ticket 06 消费)。

## 实现记录(2026-09-01,已完成)

### 交付物
- `services/control-plane/src/repoqa-conventions.ts`(新,~530 行):引擎核心。导出 `runConventionScan(input)`、`resolveTargetPackage(symbols, target)`、类型 `ConventionProfile / ConventionAxis / ConventionAnchor / ConventionCoverage / ConventionAxisId / ConventionScanInput`。
- `services/control-plane/src/repoqa-conventions.test.ts`(新,23 用例):解析器语义字段 2 + 五轴 golden 10 + 近邻仲裁 5 + 非爪哇降级 1 + target 解析 3 + nearPackages 覆盖 1 + 包路径切片 1。
- `services/control-plane/src/languages/JavaAdapter.ts`:类符号 `superClass`(Superclass→TypeName 简单名)、方法符号 `returnType`(Definition 前的 TypeName/GenericType/void)、字段 `signature`(声明行剥注解与尾分号,保留 `private final`)。
- `services/control-plane/src/repoqa-repos.ts` + `db.ts`:RepoSymbol 增 `superClass?/returnType?`,repo_symbols 表增 `super_class/return_type` 列 + ALTER 迁移,insertSymbolRows 16 列。
- `services/control-plane/src/repoqa-worker.ts`:公开方法 `runConventionScan({repoId, targetSymbol?, nearPackages?})`(getRepo→ready 校验→getSymbolGraph→引擎→锚点逐个过 `isValidAnchor` raw-file 校验;supported 轴锚点全灭时降级 unsupported,fail-closed);agent 工具 `convention_scan` 进 compositeTools(parameters `targetSymbol?: string`,async execute + try/catch 返回 `{error}`)。MCP 12 工具表未动(Issue 25)。

### 引擎语义
- 嗅探轴:①return_wrapping(未包装白名单 void/String/Integer/Long/Boolean/Object + 泛容器 List/Set/Collection/Map/Optional/Page/IPage;WRAPPER_SUFFIXES=[Result,Response,Vo,VO,R],**Dto 刻意不在**——OrderDto 是负载不是包装)②interface_impl_style(ServiceImpl+implements 接口 = split;被实现的接口计入 match 侧,不进 dissidents)③base_class(`/^Base\w*$/` 父类,≥半数即 verdict)④di_style(bean 类型白名单 = kind∈{service,repository,mapper,interface} 的符号名;样本口径 = 字段注入(@Autowired/@Resource/@Inject)+ 构造器注入(bean 类型 `private final` 无注解),普通可变字段不算样本;tie 判 `constructorInjected >= fieldInjected` 偏构造器)⑤package_layout(2 级包桶多数,近邻重采样不做)。
- 仲裁(ADR-0014):`nearPackages[0]` 显式覆盖 > targetSymbol 解析包 → `featurePackageOf`(前 2 段)过滤重采样;近邻 ≥2 样本且 ≥2/3 共识且 verdict 与全局冲突时推翻,`globalVerdict: {verdict, coverage}` 披露被推翻的全局主张,dissidents = 近邻少数锚点 + 被推翻全局的 anchors(去重,上限 5);近邻分裂/缺失退全局。
- 非 Java 仓全轴 `supported:false`(isJavaRepo:存在 .java 文件);测试路径符号全程排除。
- `packageOfPath` 兼容 `src/main/java/...` 与 `repo/src/main/java/...`(needle 常量统一 length,曾因 needle 换短后 slice 长度没同步吃掉一个字符 'c')。

### 与 spec 的偏离(1 处,已实现支持)
- spec 只写 `targetSymbol?`;实际引擎与 worker 均实现 `nearPackages?: string[]`(首个非空项优先于 targetSymbol 派生近邻)。这是 Ticket 24.3 EXTEND 落位的显式钩子:目标将搬去的新包惯例可能与源包不同,由 24.3 直接传包名。不传时行为与 spec 完全一致。

### 已知边界
- `ResponseEntity` 落 bare 侧(不在 WRAPPER_SUFFIXES、在泛容器语义边缘)——Spring 仓通常与 ApiResult 二选一,如需细分在 eval 阶段调参。
- 构造器注入计数是启发式(字段反推),构造器声明本身不是符号;`@RequiredArgsConstructor` Lombok 风格自然归入。
- 解析器 `returnType` 是补救字段:注解独占一行时 method signature 首行就是注解(历史坑),returnType 从 AST 类型节点取,不受影响。

### 验证
- control-plane 501/501(478 基线 + 23 新增),web 270/270,`npm run build` 四包绿,closeout gate 37/37(MCP tools=12 未变),`tsc --noEmit` 绿。
- 未做(按 spec 属 Ticket 24.6):锚点有效率进 eval convention bucket。
