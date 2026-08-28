# scripts/e2e — 收口回归基线

`closeout_gate.py` 是 v0.6 收口的长期回归门禁（取代已丢失的 `codecompass_e2e_harness.sh`
与旧 AC-1~AC-12 清单，见 `.scratch/v0.6-closeout/spec.md`）。纯 Python 标准库，无第三方依赖。

## 运行

```bash
# 前置：Node >= 24 且已构建（services/control-plane/dist 存在）；本机有 git
python scripts/e2e/closeout_gate.py
```

脚本会：在临时目录构建多语言 fixture（Java Spring + TS axios、Python FastAPI、Go Gin，
polyglot 仓库带两个 git commit），用随机空闲端口启动构建产物中的 control-plane，
逐条输出 PASS/FAIL，末尾汇总写入 `e2e-result.json`，失败时退出码为 1。

参数：`--node <exe>` 指定 node；`--keep` 保留临时 fixture；`--skip-hot-reload` 跳过 watcher 场景。

## 断言集

1. `doctor --json` 全部检查通过（Node/SQLite ABI/端口/数据目录/Ollama）
2. 版本一致性：root package.json == cli.ts VERSION == CHANGELOG 顶部，engines >=24
3. Java+TS / Python / Go 三仓 dashboard 消费面非空（techStack / configKeys / routes / topApis）
4. Module Scope：符号带 moduleName/qualifiedName（v0.7）
5. 扫描过滤：`weights.pt` 不计入预算并上报 skippedBinaryCount（v0.7）
6. 跨语言桥接（正向）：TS axios 调用点 → Java 路由的链路连通
7. reverse-deps 端点解析同语言 caller
8. 确定性调用链：route → service → repository hop
9. `/query` SSE 流：call-chain 产出 mermaid 图 + 源码锚点（模拟 Web 客户端消费）
10. `/symbols` 的 symbolType 真实枚举（>90% 非 UNKNOWN）
11. architecture-delta：新增 controller 类产生 addedRoutes + mermaid
12. ADR-0003 masking：`.env` 的 key 名可见、值（SECRET_KEY）不出现在任何 API 载荷
13. venv 过滤：`env_py310/` 内容不入索引（v0.7）
14. FastAPI Depends：endpoint 链入 get_db，无 "Depends" 死节点（v0.7）
15. Go 隐式接口：FileStore 满足 Store 接口（v0.7）
16. FS watcher 热重载：新方法无需重导即被索引

## 已知边界（断言按实际能力建模，限制记录在 issue）

- 桥接为**正向**：TS 调用点可链入 Java 路由；反向索引（reverse-deps）不含跨语言 caller。
- architecture-delta 的路由粒度是 **controller 类级**：在既有 controller 内加
  `@GetMapping` 方法不产生 addedRoutes。
- 单文件解析失败不阻断导入：worker 记录 `repoqa.index.warning` 事件后跳过该文件。
