# 05：R5 — 服务端最小日志 sink（级别+JSONL 轮转+traceId+请求行）

> *Parent spec 同上（Q7）。*

Status: open
标签：enhancement / P2 / 来源：生产就绪度评估 差距2

## Agent Brief

**Summary:** `dataDir/logs/control-plane-YYYYMMDD.jsonl`：级别 info/warn/error，`MHW_LOG_LEVEL` 默认 info，5MB×5 轮转，error 双写 stderr；复用 SessionLogger 模式建 `Logger`；请求行中间件（method/path/status/durMs/requestId）；worker/repo 错误、LLM 调用关键事件进同一 sink（taskId 关联，chat 进程内仍走 SessionLogger 不混写）；R1 的 500 落点迁进来。

**红线：** 凭据只从 env/密钥服务读；请求体/header 永不入日志（apiKey 脱敏）；配置示例与测试零凭据字面量。

**Acceptance:** 轮转/级别/格式测 + 零凭据断言（用假 key 跑一遍确认不落盘）。

Blocked by: R1
