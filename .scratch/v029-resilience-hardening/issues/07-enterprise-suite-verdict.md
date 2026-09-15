# 07：T7 — 企业级套件裁决销项（V27-19：不做清单 + 重评触发条件）

> *Parent spec：`.scratch/v029-resilience-hardening/spec.md`。*

Status: closed
标签：边界 / P3 / 来源：v0.27 生产就绪度评估（低优先项）+「Local-First 产品身份」定论（memory：CodeCompass=MCP 确定性工具面，Web 仅演示厅）。

## 裁决（三项全不做，附理由与重评触发条件）

| 候选 | 裁决 | 理由 | 何时重评 |
|---|---|---|---|
| `/metrics` 指标暴露（Prometheus 等） | **不做** | 单机 Local-First 无抓取方；R6 已交付 /api/runtime（uptime/rss/indexingJobs，仅回环）覆盖「人看一眼」需求；暴露标准 metrics 面=给零鉴权控制面新增攻击面与承诺面 | 出现多租户/服务器托管部署形态（与 V27-1 R4 的 LAN 暴露收敛裁决同轴） |
| 外置告警（webhook/钉钉等） | **不做** | 无守护进程形态；日志 sink（R5，jsonl+retention）+ /health 深检（R6）已是本机排障面 | 同上，或产品出现「长时间无人值守跑批」诉求 |
| 配置 fail-fast + `.env.example` | **不做** | loadConfig 现行容错哲学（非法值退默认）契合单机工具定位，fail-fast 把用户挡在启动门外；环境变量面已在 README/票面文档化，.env.example 是重复事实源 | 配置项数量再翻倍或出现静默误配真实案例 |

## 销账

- 生产就绪度评估七差距中，①-⑥ 已随 v0.27-B R1-R7 / v0.29 T1-T6 落地，⑦（企业套件）即本票裁决关闭——评估维度正式清零。
- 本票零代码。总账 V27-19 划销；重开须新 grilling（本票表格为基线）。
