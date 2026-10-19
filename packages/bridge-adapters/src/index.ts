/**
 * ⚠️ **冻结面，非产品面（2026-10-19 定位裁决，ADR-0021）**——本包的四个适配器是
 * harness 编排面的**模拟桩**（stub/coding/browser 输出占位文本，不执行真实
 * 任务），被 `services/control-plane/src/routes/workbench.ts` 的
 * `/api/tasks|harnesses|workspaces` 使用，而该组端点**零 Web 消费方**。
 * 包保留以维持既有测试与迁移成本，但不构成对使用者的承诺：不得基于它做
 * 宣传或新编排；复活或删除都需先过定位规则。
 */
export type { AdapterContext, BridgeAdapter } from './types';
export { StubAdapter } from './stub';
export { ShellAdapter } from './shell';
export { BrowserAdapter } from './browser';
export { CodingAdapter } from './coding';
