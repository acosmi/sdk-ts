// index.ts — Acosmi SDK TypeScript 主入口
//
// 自 2026-05-22 起 TS SDK 是主实现 / 事实标准；Go SDK (acosmi-sdk-go) 暂停维护，
// 待 TS 稳定后再从 TS 反向翻译补齐 Go (方向 TS→Go)。
// 跨语言契约印记 (snake_case wire-format / 符号名对齐 / bug-for-bug 行为) 见
// docs/开发与发布手册.md §5。
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
// 商品化总规划 P1 (2026-05-25) — 订阅档位 + 公开业务参数 namespace
export * from './subscription';
export * from './pricing';
// 商品化总规划 P3 (2026-05-25) — 商品中心 namespace
export * from './products';
// 商品化总规划 P5 (方案 B 2026-05-25) — 法律案件咨询 namespace
export * from './casehall';
// 商品化总规划 P6a (2026-05-25) — 企业席位 namespace
export * from './enterprise';
// 商品化总规划 P7 (2026-05-25) — 财务 (发票/退款/对公转账) namespace
export * from './finance';

// === Sanitize ===
// sanitize/ 已是独立子包 (有自身 barrel)，命名空间导出留在根级，不经域 barrel 路由。
export * as sanitize from './sanitize';
