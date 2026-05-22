// index.ts — Acosmi SDK TypeScript 主入口
//
// 端口源: acosmi-sdk-go v0.19.0 (一字不差对齐)
//
// 双格式红线: AnthropicAdapter + OpenAIAdapter 等地位 (对应两个不同下游产品)。
//
// 本文件只从各业务域 barrel re-export — 每个 barrel 是该域对外切片的单一真相源。
// 公共导出符号集合与逐域 export 完全等价；业务方法的 side-effect / declaration-merging
// 注入由各域 barrel 内部承载 (见 core / billing / skills / notifications / agent-runs /
// compliance / support 各 index.ts)。

export * from './core';
export * from './shared';
export * from './auth';
export * from './models';
export * from './billing';
export * from './skills';
export * from './notifications';
export * from './agent-runs';
export * from './compliance';
export * from './support';

// === Sanitize ===
// sanitize/ 已是独立子包 (有自身 barrel)，命名空间导出留在根级，不经域 barrel 路由。
export * as sanitize from './sanitize';
