// agent-runs/index.ts — Agent Runs 域 barrel
//
// 收口 agent-run 类型与 AgentRunsClient 子客户端。
//
// agent-runs/client.ts 导出 AgentRunsClient 类，并 declaration-merge 一个 agentRuns
// getter 到 Client.prototype — `export { AgentRunsClient }` 已加载该模块，getter
// 增强随之执行。

// === 类型 ===
export * from './types';

// === 子客户端 (导出类 + declaration-merge agentRuns getter 到 Client.prototype) ===
export { AgentRunsClient } from './client';
