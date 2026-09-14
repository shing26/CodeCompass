import express from 'express';
import type { HttpDeps } from './deps';
import { registerGraphRoutes } from './analysis-graph';
import { registerGateRoutes } from './analysis-gate';
import { registerStreamRoutes } from './analysis-stream';

/**
 * v0.25.0 批次 2：分析域——符号图/反向依赖/Tour/驾驶舱/radar/Delta/子图
 * RAG/ONBOARDING/chunks/query SSE/evolve SSE。自 http.ts 按域拆出。
 *
 * V27-30 (B3 increment 2)：原 515 行巨注册 `registerAnalysisRoutes` 再按
 * 子域物理拆分为三个注册件（graph 读侧 / gate 门禁 / stream SSE 流），本文件
 * 缩为组成根——对 http.ts 的导入面与函数签名不变。路由路径跨域互不重叠
 * （symbols/reverse-deps/tours/dashboard/radar/subgraph-context/export/
 * chunks vs architecture-delta/gate/run/gate-runs vs query/evolve），
 * Express 匹配语义与拆分前完全一致；测试面（repoqa-http/gate-runs/evolve/
 * events/workbench-cards 等）逐端点护航。
 */
export function registerAnalysisRoutes(app: express.Express, deps: HttpDeps): void {
  registerGraphRoutes(app, deps);
  registerGateRoutes(app, deps);
  registerStreamRoutes(app, deps);
}
