// compliance/index.ts — 合规域 barrel（重点扩张域）
//
// 暴露 envelope/审批/provider/billing 的对外稳定状态与错误码 + SDK 公共领域类型
// + 数值错误码 → symbolic key 的分类器；不暴露下游材料、provider ledger /
// distribution billing 内部 API。
//
// 子域 (evidence / timestamp / report / signing / seal-approval / provider /
// operation / template) 无自身 index.ts，barrel 直接 re-export 其 types.ts。
//
// compliance/client.ts 导出 ComplianceClient 类，并 declaration-merge 一个 compliance
// getter 到 Client.prototype — `export { ComplianceClient, ... }` 已加载该模块，
// getter 增强随之执行。

// === Scopes ===
export * from './scopes';

// === 状态与领域类型 ===
export * from './status';
export * from './types';
export * from './evidence/types';
export * from './timestamp/types';
export * from './report/types';
export * from './signing/types';
export * from './seal-approval/types';
export * from './provider/types';
export * from './operation/types';
export * from './template/types';

// === 错误码分类器 ===
export {
  classifyComplianceError,
  isComplianceBusinessError,
  type ComplianceErrorInfo,
  type ComplianceErrorKey,
} from './errors';

// === 子客户端 (导出类 + declaration-merge compliance getter 到 Client.prototype) ===
export { ComplianceClient, CompliancePollError } from './client';
