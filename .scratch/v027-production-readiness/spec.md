# v0.27-B Spec：生产就绪差距修补（错误与韧性 / 安全 / 取证 / 冒烟门）

> *2026-09-12 grill 产出。输入：`assessment.md`（五面评估）+ 台账 V27-1/12/13。用户四问全按推荐裁决。*

## 问题

单机产品化成熟期缺服务运维面底线：后端挂起/重启时前端永转圈、WS 静默断流（用户「页面死状态」体感来源）、route 抛错无落点、错误契约靠英文自由文本、控制面绑全网卡零鉴权、无服务端日志与深健康检查。补完后 v0.27.0 收口发布（裁决 Q1：已交付 UI 批+P0+favicon 一并进 v0.27.0，不另发 0.26.1）。

## 裁决表

| # | 决策 | 内容 |
|---|------|------|
| Q1 | 版本切分 | 全部合并 **v0.27.0** 一次收口（含 v0.27-UI 三票、chatGuardSend P0、favicon）。 |
| Q2 | 绑定收敛 | 默认绑 **127.0.0.1**；`MHW_CP_HOST` env 逃生（`0.0.0.0`=旧行为）；CHANGELOG 标破坏性；README/doctor 同步。 |
| Q3 | 冒烟策略 | **stub LLM 进 Release 门**：本地假 LLM endpoint（env 注入），零 token；三链路+韧性断言；挂 `release.yml`。真 LLM 全链路不进 CI。 |
| Q4 | 错误码范围 | **五高频面先行**：chat、gate run、import/reindex、file/raw、delta 挂 `{error,code}`；其余端点随后续增量。错误码表入 `CONTEXT.md`。 |
| Q5 | fetch 超时档（技术裁量随 Q3） | 常规 GET 15s；导入 preview/clone/reindex 60s；LLM/evolve 流式只 timeout **到响应头到达**，流开始后续期。 |
| Q6 | WS 重连档（技术裁量） | 指数退避 1s→2s→4s→…上限 30s，无限重试直到组件卸载；重连成功即静默 refresh symbols+dashboard；断连期间沿用既有 offline-hint 呈现。 |
| Q7 | 日志 sink 形态（技术裁量） | `dataDir/logs/control-plane-YYYYMMDD.jsonl`，级别 info/warn/error，`MHW_LOG_LEVEL` 默认 info；5MB×5 轮转；error 双写 stderr；**只落 env 无凭据入文件**（Mimosa 红线：源码/示例/测试零凭据字面量，LLM apiKey 不读不打）。 |
| Q8 | 实施顺序 | R1→R2→R3→R4→R7→R5→R6。冒烟门先于取证批，R5/R6 交付时把各自断言追加进 smoke。 |

## 票池（tracer-bullet，blocking edge 标注）

| 票 | 内容 | 依赖 | 估 |
|---|------|------|----|
| 01 R1 | 全局 error 中间件 + asyncHandler：Express 4 下 sync throw/async rejection 一律 JSON 500 `{error,code:'internal_error'}`，堆栈不出网；x-mhw-request-id 贯穿；rejection 有日志落点（先 stderr 结构化，R5 升级进 sink） | — | 0.5d |
| 02 R2 | 传输韧性：RepoQAClient 统一 fetch 超时（Q5 档）+ `RepoContext` WS 指数退避重连+重连刷新（Q6）；前端错误态可见（dashboard-error/offline-hint） | — | 1d |
| 03 R3 | 错误码契约五面 + chat 人类化：五面响应挂 `code`；ChatView catch 按 code→中文文案+下一步指引（销 V27-12）；`CONTEXT.md` 错误码表 | R1 | 1d |
| 04 R4 | V27-1 绑定收敛：默认 127.0.0.1 + `MHW_CP_HOST` 逃生 + doctor/README/CHANGELOG 破坏性标 | — | 0.5d |
| 05 R5 | 服务端日志 sink：Q7 形态；请求行中间件（method/path/status/dur/requestId）；worker/repo 错误与 LLM 调用关键事件进同一 sink（taskId 关联） | R1 | 1-2d |
| 06 R6 | /health 深检（SELECT 1 + dataDir 可写，降级 503+checks）+ /api/runtime 附 uptime/RSS/activeTasks | — | 0.5d |
| 07 R7 | V27-13 UI 冒烟进 `release.yml`：build→起服务→stub LLM→真 chromium 走 选库→AskDock 提问（stub 回答到达）→门禁运行 三链路 + 「重启后端→WS 恢复刷新」韧性断言 | R1..R4 | 1-2d |

台账销项：V27-1→R4；V27-12→R3；V27-13→R7；V27-18/19 维持在册（18=clone/reindex 重试，本批不做；19=企业套件裁决，Q3 已裁其一半）。

## 验收门

- 每票：定向测试先行（vitest 两端，R7 用 Playwright）+ 全量门禁（control-plane vitest、web vitest、tsc×2、e2e gate 语义）+ Reviewer-Security 单轴照派 + 票 closed+Comments 直提推送。
- R1：单测锁「async handler throw → JSON 500 无堆栈」「sync throw 同」「request-id 头存在」。
- R2：单测锁「fetch 超时 abort 出 code:'network_timeout'」「WS close 后按序退避重连、重连触发刷新」（fake timers）。
- R4：`/health` 断言绑定地址回显；`MHW_CP_HOST=0.0.0.0` 逃生路径测试。
- R7：smoke 在本地跑通后入 `release.yml`，stub LLM 脚本零外网依赖、零凭据字面量。
- 文案守门：新增用户可见中文过 copy-guard 七词黑名单；错误人类化文案禁「读侧/写侧」「推演卡」等退场词。

## 明确不做

多用户鉴权体系、/metrics 与外置告警（V27-19 裁决不做）、全端点错误码普查、clone/reindex 重试（V27-18 留册）、chat 流协议变化。
