# 01 — Stack Trace Parser（确定性堆栈解析器 + 符号反查）

Status: done

> 2026-09-01: 交付 `repoqa-stacktrace.ts` + 13 测试全绿；Java（含 Caused by/Native Method/无行号/Unknown Source）、TS/JS（V8/裸位置）、通用兜底、噪音过滤（反射/JDK 帧）、同文件优先反查。

## 目标
新文件 `services/control-plane/src/repoqa-stacktrace.ts`，零 LLM：

- `parseStackTrace(text: string): ParsedStackFrame[]`
  - Java 优先：`at com.foo.Bar.baz(Bar.java:123)`（含 `Caused by:` 链内的帧）；顶层帧 = 崩溃点（文本序第一帧）。
  - TS/JS 兼容：`at baz (src/foo.ts:12:34)` 或 `at Object.baz (D:\x\foo.ts:12:34)`。
  - 通用兜底：`Class.method(File.ext:123)` 出现在任意行也计入（保守正则，避免误捕日志噪音）。
  - 输出 frame：`{ className, method, file, line, raw }`；无行号的帧保留 `line: undefined`。
- `resolveFramesToSymbols(frames, symbols)`：按 className 简名/方法名反查符号表，同文件优先；返回 `{ matches: Array<{ frame, symbol }>, unmatched: ParsedStackFrame[] }`。
- 导出 `stackTraceSummary(parsed)` 供 prompt/事件引用（帧数、命中数、崩溃点描述）。

## 边界
- v1 只承诺 Java + TS/JS；Python/Go 格式不承诺（解析不到就 unmatched，调用方标 BREAK）。
- 不做路径归一化猜测：file 只原样透传。

## 验收
- `repoqa-stacktrace.test.ts`：Java 标准堆栈（多帧 + Caused by）、TS 堆栈、无行号帧、噪音行不误捕、反查同文件优先与 unmatched。
- 全量 vitest 绿。
