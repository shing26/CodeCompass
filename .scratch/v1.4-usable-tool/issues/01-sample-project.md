# 票 01 — 示例项目一键载入

Status: closed（已落地，2026-10-19，tag v1.4.0）

## 背景
用户批判①：克隆下来没有可看的东西，"第一眼劝退"。现状：导入是唯一入口，且要求用户先找到本机仓库；空状态只教"填本机完整路径"。仓库内无任何内置样例。

## 目标
点一下按钮，不填任何路径，30 秒内看到完整双向联动（拓扑概览 → 首条 Top API 自动链路 → 导览）。

## 实现要点（D1 裁决：自撰内嵌样例）
1. **样例内容**：自撰一个精选 TS 小仓（"任务看板 API"，约 10–14 个文件：Express 风格路由 + 中间件链 + service/repository 分层 + 一个多跳调用链），文件名与结构对齐引擎已支持的模式：
   - `app.get('/path', handler)` / `app.post(...)` 具名 handler（route 符号 + 出边）
   - `app.use(authMiddleware)` 具名中间件（`USE *` + 中间件链导览）
   - 跨文件 service/repo 调用（Top API 有真实链路）
   - 刻意不含 `@/` 别名（别名不支持，不演示坏能力）
2. **载体**：`services/control-plane/src/ingest/sample-project.ts` 导出 `SAMPLE_PROJECT: { slug, name, files: Record<path, content> }`（编译进 dist，随 npm/Docker 分发，无外部文件依赖）。文件头注明"自撰示例，非第三方源码"。
3. **服务端点**：`POST /api/repos/sample`（`routes/repos.ts`）
   - 物化到 `<dataDir>/samples/<slug>/`（mkdir -p，覆盖写，幂等）
   - 复用既有导入流程：`upsertByLocalPath` → `updateRepoStatus('indexing')` → fire-and-forget `worker.indexRepo` → `202 {repo, taskId}`（与 POST /api/repos 完全同构，含僵尸防线 `guardIndexFailure`）
4. **Web 入口**（两处，文案须过双哨）：
   - 空状态（无仓库时）主按钮「载入示例项目」
   - 导入弹窗内新增一行快捷入口（同一动作）
   - 载入后沿用既有 WS/轮询流程，自动示例链路（首条 Top API）自然触发

## 验收
1. `POST /api/repos/sample` 幂等：连点两次不产生重复 repo 行（`upsertByLocalPath` 归一化路径保证），第二次返回同一 repoId。
2. 索引完成后：repo 非空符号数、Top API 列表非空、`GET /api/repos/:id/tours` 至少 1 条（中间件链），`code://` 深链可点。
3. 控制面测试：新增端点用例（物化 + 202 + 幂等 + 错误路径 400 不建行）。
4. Web 测试：空状态按钮存在且触发导入调用；导入弹窗入口同断言。
5. 实测记录：本机索引小样仓耗时 <10s（超过则回到 spec §2.3「内嵌预解析」触发线）。

## Comments
**2026-10-19 落地。** 证据：
- 端点 `POST /api/repos/sample`（`routes/repos.ts`）：物化 → 202 → 后台索引，双击防重（indexing 中不重复起任务）；样例内容 `ingest/sample-project.ts`（自撰 11 文件，`sampleFileTarget` 带根目录包含校验）。
- 测试 `routes/repos-sample.test.ts`（3 项）：端点契约 + 幂等 + 真实索引（路由 4 个、`USE *→authMiddleware` 可解析、`POST /api/tasks→createTask→save` 链路、导览非空、边界计数 >0）。
- Web：空状态「载入示例项目（一键）」+ 导入弹窗快捷入口；Canvas/Modal 各 1 组测试。
- **真机冒烟**（临时数据目录）：`POST 202` → `ready`，`files=11 symbols=32`，tours=1（有步骤），topApis=[GET /api/tasks, POST /api/tasks, POST /api/tasks/:id/complete]，索引耗时 <10s（满足 §2.3 触发线）。
- Mimosa 对测试内路径拼接报「路径穿越」：键是编译期常量，且已加 `sampleFileTarget` 越界校验，按既有同类误报裁决保留原写法。
