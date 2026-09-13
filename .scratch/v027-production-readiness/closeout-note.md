# v0.27-B 收口战报（差距修补批，2026-09-13）

> Parent spec: `.scratch/v0.27-production-readiness/spec.md`（Q1–Q8 裁决）。
> 实施顺序照 Q8：R1→R2→R3→R4→R7→R5→R6，七票全 closed。

## 提交链

| 票 | commit | 内容 | 门禁 |
|---|---|---|---|
| 票池 | `06d2ed3` | 评估入档 + Q1-Q8 裁决 + 七票 | docs |
| R1 | `f7edce1` | error 中间件+asyncHandler 13 处+掩码共享 | cp 598、e2e 60×2 |
| R2 | `6a20281` | fetch 首字节预算分层 + WS 指数退避重连 | web 344 |
| R3 | `ffcc027` | 28 码五面契约+chat 人类化+三出口掩码 | cp 603、web 349、e2e 60 |
| R4 | `8668353` | 默认绑 127.0.0.1+MHW_CP_HOST 逃生+Docker/README | cp 609、e2e 60 |
| R7 | `fbe78d6` | UI 冒烟（stub LLM）挂 release.yml 发布门 | 本地 3 轮 PASS |
| R5 | `8ab8636` | ServerLogger 日志 sink+请求行/events/500 关联 | cp 624、e2e 60、实机落盘 |
| R6 | `bc478bd` | /health 深检（skipped 三态+TTL）+回环限流 runtime 指标 | cp 630、e2e 60、smoke PASS |

## Review 账（每票照派 Reviewer-Security）

- P0：**0**。P1：**14**（R1×1、R2×2、R3×2、R5×3、R6×3、R7×1 票面治理、R4×0→全修）全部当场修复或按裁决移交。
- P2：~30，采纳即修，超范围的登记台账六条（V27-18 clone 重试、V27-19 企业套件、V27-20 import 202 化+EvolveStream DI、V27-21 掩码尺统一、V27-22 MCP 深链绑定面、V27-23 索引进度条常驻）。
- 关键战果：R1 首测即自曝 DSN 裸落 stderr；R3 坐实 SSE error 帧被前端静默吞成空答案；R6 坐实 activeOpCount 注释语义失实（字段实名化 indexingJobs）。

## 评估五面对照（修补后）

| 面 | 修前 | 修后 |
|---|---|---|
| 容错 | 部分具备（缺 fetch 超时/WS 重连） | 补齐 R2；import 202 化留 V27-20 |
| 日志 | chat 面优、服务端零 | 补齐 R5（级别+轮转+retention+fail-soft+关联 id） |
| 配置 | 外部化有、无分级 | R4 补 host；fail-fast/.env.example 留 V27-19 |
| 监控告警 | /health 口头 ok | R6 深检+进程指标（回环限流）；/metrics 裁决不做 |
| 错误处理 | 形状统一无契约 | R1 终端中间件+R3 码表契约+CONTEXT.md 权威表 |

## 遗留（等用户令）

1. **v0.27.0 收口发布**（Q1 裁决：v0.27-UI 三票 + P0 + favicon + 本批七票合并一次发）：CHANGELOG 0.27.0 段（**R4 默认回环为破坏性变更**需醒目）、六处版本 bump、tag push、CI/Release 双绿观察 + UI smoke 首跑验证。
2. 台账新六条（V27-18..23）与 V27-11 去极客化战役：v0.28 候选池。
3. 实机备注：/health version 字段回显 '0.6.0' 为 server.ts 硬编码历史残留（与 e2e 版本一致性检查不冲突，收口批顺手修或登账）。
