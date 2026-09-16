# scan 精度基线报告（v0.31 · V31-01 / V31-02 第一增量）

> 2026-09-16 ｜ 依据 spec：`.scratch/v031-precision/spec.md` §3（度量口径 M1/M2）
> 样本与 v0.21 dogfooding 取证同源，**可复跑**：`scripts/precision/scan_precision.ts`

## 1. 结论（先读这段）

1. **仓库此前从未度量过真实仓库精度**——只有 97 题合成 eval。本次建了 harness，三个真实仓可一条命令复跑。
2. v0.21 留下的 43% / 31% / 83% 是**孤儿桶占符号总数的比例**（噪声水位），**不是**假阳性率；真实假阳性由 top-10 抽样逐条核验，本次三仓均为 **10/10**。
3. 本次第一增量修掉四类根因后：**本仓孤儿 1182 → 689（−42%）**、**petclinic 184 → 45（−76%）**、lazygit 3288 → 3229（−2%，Go receiver 绑定未修，符合预期）。
4. 抽样仍 100% 假阳性，但**构成已换**：修复前是「该有边却没有边」，修复后主要是**类型声明**（class/interface/record 天生没有"调用者"概念）与**分派缺口**（Go 跨文件 receiver、构建器链、DOM 事件绑定、模块级 JSX）。这两类是下一步的靶心，见 §5。

## 2. 方法

```bash
# 首次需 network 或本机已有克隆（v0.21 的 ~/.mhw/clones/lazygit-* 会被自动复用）
node_modules/.bin/tsx services/control-plane/... # 见下方实测命令
cd D:/CodeCompass
NODE_OPTIONS=--max-old-space-size=4096 \
  services/control-plane/node_modules/.bin/tsx scripts/precision/scan_precision.ts self lazygit petclinic

# 复算 M1（读 out/*.json + verdicts/*.json）
… scan_precision.ts --score
```

- 索引链与产品一致：`worker.indexRepo` → `worker.getSymbolGraph` → `runScan`（与 MCP 工具同一条引擎路径）。
- 克隆复用并记录 HEAD sha；抽样用固定种子（`SEED=20260916`）保证跨轮可比。
- 判定为人工/agent 逐条核验，核验方式与理由写入 `scripts/precision/verdicts/<repo>.json`（外部引用 grep + 结构判断）。

## 3. 基线数字（before → after）

| 样本 | 版本 | 符号数 | 孤儿桶 total | 占符号比 | wiredExcluded | top-10 假阳性 |
|---|---|---|---|---|---|---|
| **self**（CodeCompass, TS） | v0.21 取证 | 1406 | 1166 | 83% | — | 8/10 |
| | 本次修复前 | 1745 | 1182 | 68% | 4 | 10/10 |
| | **本次修复后** | 1912 | **689** | 36% | 4 | 10/10（构成已换） |
| **lazygit**（Go） | v0.21 取证 | 45423 | 19629 | 43% | — | 10/10 |
| | 本次修复前 | 10523 | 3288 | 31.2% | 7 | 10/10 |
| | **本次修复后** | 10523 | **3229** | 30.7% | 7 | 10/10 |
| **petclinic**（Java） | v0.21 取证 | 595 | 184 | 31% | — | 9/10 |
| | 本次修复前 | 595 | 152 | 25.5% | 30 | 10/10 |
| | **本次修复后** | 595 | **45** | **7.6%** | 41 | 10/10（构成已换） |

注：lazygit 符号数 45423 → 10523 是 v0.22 的 vendor 排除生效（lazygit 约 44% 的 .go 文件在 `vendor/`），不是本次改动。

## 4. 本次落地的修复（V31-02 第一增量）

| # | 根因 | 修复 | 证据 |
|---|---|---|---|
| 1 | TS 适配器用**纯 JS dialect** 解析：类型注解与 JSX 全是语法错误节点（探针：8 token 的 .tsx 片段 9 个错误节点） | `parser.configure({ dialect: 'jsx ts' })`（`TypeScriptAdapter.ts`） | 本仓符号 1745 → 1911（终于读全了）；孤儿 1182 → 699 |
| 2 | **裸函数调用无调用边**（`foo()` 被 `parts.length < 2` 丢弃） | 补裸调用边，按 Python(v0.7)/Go(v0.22) 同名解析规则绑定 | 本仓孤儿继续下降；`App`/`onKeyDown` 等类 |
| 3 | **JSX 使用无调用边**（`<BrandMark />` 是组件被"使用"的唯一形式） | 新增 JSX 标签边（小写内建元素排除，`<Foo.Bar/>` 取末段） | 同上 |
| 4 | **局部变量类型不记录**（`const c = new RepoQAClient()` 无类型 → 其方法调用全部 dynamic；`scope.locals` 是只读的死字段） | 用类型注解或 `new X()` 初始化器回填 `scope.locals` | 本仓 693 → 689（部分生效，工厂返回实例仍待修） |
| 5 | **DI 注解白名单只到 @Bean/@FeignClient** | 补 `@Component/@Service/@Repository/@Controller/@RestController/@PostConstruct/@PreDestroy/@Scheduled` | petclinic wiredExcluded 30 → 41 |
| 6 | **HTTP handler 方法是入口点却进孤儿桶**（Java/FastAPI 的 handler 是带 displayPath 的 method，TS/Express 的才是 route kind） | 孤儿桶跳过「带 displayPath 的方法」，与 route 同一理由 | petclinic 的 `getOwnerDetails` 类消失 |
| 7 | **DTO 访问器**（record/bean 的 `owner.id()`，不带 get 前缀） | 新增 `isFieldAccessor`：方法名命中所属类型的字段名且 ≤5 行 → 视为访问器 | petclinic 152 → 45 的主因 |

## 5. 残余根因与下一步（按预期收益排序）

| 优先级 | 残余根因 | 观测 | 预期 |
|---|---|---|---|
| **P0** | **类型声明进孤儿桶**（class/interface/record 占三仓 top-10 的 6–7 条） | 类型没有"调用者"这个概念，除非追踪引用（import/字段类型/泛型）——目前所有适配器都不追踪 | 采样可过半改善；需裁决「收窄桶语义」或「补类型引用边」 |
| **P0** | **Go 跨文件 receiver 绑定**（`declaredTypes` 按文件构建，`app.Run()`/`self.setupRepo()` 落 dynamic） | lazygit 7/10 抽样、占其孤儿总量主因；CHANGELOG 已登记两处 | 唯一能压低头号仓库的项；机制清楚（提到 per-repo 类型表），但**必须守"宁 dynamic 不猜测"** |
| P1 | **分派缺口**：构建器链（`OwnerDetails.builder()...`）、DOM 事件绑定（`onclick`/`addEventListener`）、模块级 JSX（`main.tsx` 的 `<App/>`）、属性值引用（`onKeyDown={fn}`） | 三仓各 1–3 条 | 中；部分可用「无 enclosing symbol 时挂到模块节点」统一解 |
| P2 | 测试脚手架目录（`cmd/integration_test/`）不在 `isTestPath` 模式内 | lazygit 1/10 | 小，补模式即可 |

## 6. 口径与诚实性说明

- **抽样是 top-N，不是随机样本**：桶按位置排序取前 10，天然过代表"最显眼"的残余类；因此**不能用它直接估计全桶假阳性率**。全桶口径需要分层随机抽样（下一增量可加 `--sample seeded` 结果作为第二口径，harness 已同时输出 seeded 抽样）。
- **M1 目标 <5% 尚未达成**，本报告不给结论性数字替代品；下一步按 §5 P0 两项推进后再复测。
- v0.21 的 43%/31%/83% 与其 top-10 判定（10/10、9/10、8/10 假）在本文中分别记作「水位」与「率」，两者不可混用（这是定位文档 §1.5 引用时的口径歧义来源）。
