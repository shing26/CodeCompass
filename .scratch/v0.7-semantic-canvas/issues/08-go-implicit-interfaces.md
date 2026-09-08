# 08: Go 隐式接口映射

Status: ready-for-agent

## 问题

GoAdapter 仅在 `var x Storage = &Impl{}` 显式赋值模式回填 `impl.interfaces`（:397-408, :519-529）；纯 duck typing（struct 实现接口方法集）无映射，`resolveCall` 遇接口接收者即 `STATIC_ANALYSIS_BREAK_DYNAMIC`（repoqa-callchain.ts:411-423）。

## 任务

1. 索引后处理（worker 建图阶段）：收集全部 interface 的方法名集合与 struct 的方法名集合；当 struct 方法集 ⊇ 某接口方法集且同名方法签名一致时，回填 `impl.interfaces`（复用现有 `implsOfInterface`/`resolveCall` 消费通路）。
2. 保守消歧：签名不一致或多个 struct 完全匹配同一接口时全部关联（接口方法调用本就动态分发，多实现是常态）；无法确定签名的（泛型/embedded）跳过并记录。
3. 反向依赖：查询接口方法名时可经接口→实现回溯到 struct 方法（现有 reverseDeps 按名匹配已部分覆盖，补一条结构化断言）。
4. gate 的 Go fixture：定义 `Storage` 接口 + 隐式实现的 struct，断言接口方法调用链可达 struct 实现。

## 验收

- 单测覆盖匹配/消歧/跳过三分支；gate 断言隐式实现边存在且调用链贯通。

## Comments

- 2026-08-28：`applyImplicitInterfaces` 在 worker 建图时运行（跨文件），签名键做
  归一化——MethodDecl 首行带 receiver 与 body 开括号，剥除后与接口 MethodElem 对齐；
  不匹配（多行签名/embedded）保守跳过。gate 断言 `FileStore satisfies Store` 通过，
  接口方法调用经 `implsOfInterface` 既有通路可达实现。
