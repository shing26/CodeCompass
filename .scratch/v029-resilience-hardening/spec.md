# v0.29 安全+韧性收口批 spec

> 2026-09-15 grill 定案。选线：安全+韧性收口（V27-11 去极客化带 UX 票留下一场独立战役）。
> 版本预claim：v0.29。来源：v0.27 生产就绪度评估遗留台账 V27-18..23 + 票04 异名对尾巴。
> 用户两项授权假设随计划批准生效：①V27-20 采「拆」（EvolveStream 留、import 202 挂账）；②V27-21 采「强尺统一」。

## 票池

| 票 | 账 | 一句 |
|---|---|---|
| 01 | V27-21 | 掩码强尺统一（P0）：三裸面收编 + maskSecrets 处置 + eval 护航 + CONTEXT 词条 |
| 02 | V27-18 | cloneGitRepo 网络类失败 2 次指数退避 |
| 03 | V27-22 | MCP 深链展示面对齐（cockpitBaseUrl helper，5+1 成对改） |
| 04 | V27-23 | StatusStepper 轮询 ready 复位 |
| 05 | 票04尾巴 | 异名对收口（Anchor/IndexingProgress re-export + unknown-phase 兜底） |
| 06 | V27-20 | EvolveStream 走 TimedFetch（半票）；import 202 化拆新行挂账 |
| 07 | V27-19 | 企业套件裁决销项（不做清单+重评触发条件） |

## 纪律

- 每票独立 commit、全门禁护航（tsc/638+/354/26/e2e 62/UI 冒烟/docker；e2e 与 docker 串行防 VirtualAlloc）。
- 执行序按风险：01→02→03→04→05→06→07。
- 新发现裸面（native tool loop 零掩码）系 2026-09-15 侦察增量，台账 V27-21 原文未记——票 01 面内更正。
- CHANGELOG 0.29.0 段留发布准备批（发布令另下）。
