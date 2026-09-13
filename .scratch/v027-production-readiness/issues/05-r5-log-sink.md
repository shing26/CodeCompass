# 05：R5 — 服务端最小日志 sink（级别+JSONL 轮转+traceId+请求行）

> *Parent spec 同上（Q7）。*

Status: closed
标签：enhancement / P2 / 来源：生产就绪度评估 差距2

## Agent Brief

**Summary:** `dataDir/logs/control-plane-YYYYMMDD.jsonl`：级别 info/warn/error，`MHW_LOG_LEVEL` 默认 info，5MB×5 轮转，error 双写 stderr；复用 SessionLogger 模式建 `Logger`；请求行中间件（method/path/status/durMs/requestId）；worker/repo 错误、LLM 调用关键事件进同一 sink（taskId 关联，chat 进程内仍走 SessionLogger 不混写）；R1 的 500 落点迁进来。

**红线：** 凭据只从 env/密钥服务读；请求体/header 永不入日志（apiKey 脱敏）；配置示例与测试零凭据字面量。

**Acceptance:** 轮转/级别/格式测 + 零凭据断言（用假 key 跑一遍确认不落盘）。

## Comments（2026-09-13 实施收口）

- 落地：`log-sink.ts` ServerLogger（appendFileSync 同步写消灭 flush 竞态、级别 fail-soft、error 先 stderr 后文件、mask+4096 截断、5MB×5 轮转+14 天日期保留+sweepStale、写失败 dead 永久降级永不冒泡）；http.ts 请求行中间件（**只用 req.path 不带 query**，close 补 aborted 行）；errorMiddleware 经 res.locals.serverLogger 走 sink（fallback 保 R1 行为）；server.ts 起停/LAN 告警/events 事件（progress 过滤）；chat SessionLogger 边界不动。
- Reviewer-Security P1×3 修：**P1-1** 日志写失败=进程整机死（res.on('finish') 裸监听器 throw→uncaughtException）→ write 全防护+dead 标志；**P1-2** 「index 失败 error 行」落在永不命中死分支（index.done 恒 ready，真事件是 repoqa.index.error）→ 改对事件并给 payload 补 repoId（types+worker 发射点）；**P1-3** 5MB×5 封顶不成立（按天文件名旧文件永不清理+跨天 bytes 错判）→ day 跟踪+RETENTION_DAYS=14 sweep+rotate 失败重 stat 不重置 0。
- P2 采纳：级别大小写不敏感+options.env→process.env 回退链（.env 生效）；构造 fail-soft；单行截断；aborted 痕迹；多进程 rotate 注释为已知限制；P2-7 测试修正（语义断言防全局 stderr 噪音假红、500 关联集成测、真 ServerLogger 同 requestId info+error）。
- 测试：log-sink 10、http-logging 4、http-error +1（sink 路由）、假 key 落盘面已由 mask 测钉（DSN 口令不落盘）。门禁：cp 624/624、tsc、build、e2e 60/60；实机 ~/.mhw/logs jsonl 请求行可见（boundHost 127.0.0.1 同步复证）。
- 插曲：Mimosa 静态扫描对 fs.rmSync 误报「命令注入高危」， maintainer 裁决「保持原写法」（参数化 API，无 shell）。

Blocked by: R1
