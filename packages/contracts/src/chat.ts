/**
 * v1.8 — chat 流式进度契约（ADR-0024）。
 *
 * 三个**新增** SSE 事件（chat 面，增量、非破坏）：progress / hint / heartbeat。
 * 纪律：
 *   - 只带机器可读字段，中文文案由前端 copy 表映射（copy-guard 合规）；
 *   - 未知事件消费方必须忽略；`done` 仍是轮次终态唯一权威；
 *   - 阈值常量是服务端与前端共用的一把尺（禁止两边各写一份数字）。
 */
export type ChatProgressPhase = 'model' | 'tool' | 'synthesis' | 'retry';

/** 一次 ReAct 轮次内的阶段性进度（ADR-0024）。 */
export interface ChatProgressEvent {
  phase: ChatProgressPhase;
  /** 1-based 步号：一次模型调用为一步；工具调用沿用所在步号。 */
  step: number;
  /** phase=tool 时被调用的 MCP 工具名。 */
  tool?: string;
  /** phase=tool 的收尾帧附带的本次工具耗时（ms）。 */
  toolMs?: number;
  /** 与 done.turnId 同源的轮次键。 */
  turnId: string;
  /** 轮次开始至本事件的毫秒数。 */
  elapsedMs: number;
}

export const CHAT_HINT_CODES = [
  'SLOW_FIRST_TOKEN',
  'VERY_SLOW_FIRST_TOKEN',
  'TOOL_LONG_RUNNING'
] as const;

export type ChatHintCode = (typeof CHAT_HINT_CODES)[number];

/** 慢模型断点提示（ADR-0024：只提示，绝不自动 abort / 自动切模型）。 */
export interface ChatHintEvent {
  code: ChatHintCode;
  elapsedMs: number;
  profile: string;
  /** 可用档位数；仅 >1 时前端才给出「切换档位」建议。 */
  profilesAvailable: number;
}

/** 活动轮次的保底心跳（5s）；客户端可忽略，e2e 用它断言「服务端仍在线」。 */
export interface ChatHeartbeatEvent {
  elapsedMs: number;
}

/** 慢首字阈值（ms）。 */
export const CHAT_SLOW_FIRST_TOKEN_MS = 15_000;
/** 极慢首字阈值（ms）。 */
export const CHAT_VERY_SLOW_FIRST_TOKEN_MS = 45_000;
/** 单次工具调用「过长」阈值（ms）。 */
export const CHAT_TOOL_LONG_RUNNING_MS = 10_000;
/** 心跳间隔（ms）。 */
export const CHAT_HEARTBEAT_MS = 5_000;
/** 单次模型调用硬上界（ms）；env REPOQA_CHAT_LLM_TIMEOUT_MS 可覆盖。 */
export const CHAT_LLM_TIMEOUT_MS = 180_000;
