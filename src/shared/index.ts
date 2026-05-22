// shared/index.ts — 跨域基础设施 barrel
//
// 收口错误类型、APIResponse / Yudao 分页结构，以及跨域共享 DTO
// （分页 / operation / retryAdvice / principal / gate —— 能力缺口总账
// §9.4 / §9.5 Phase 0.3）。
//
// 红线（§9.4 / §9.5）：
//   - `PageResult<T>` 是 `YudaoPageResult<T>` 的别名，不开第二套分页结果结构。
//   - `RetryAdvice` 是叠加层，不替换 `core/retry.ts` `RetryPolicy` /
//     `compliance/errors.ts` `ComplianceErrorInfo`。
//   - 共享 DTO 按关注点分文件，不堆进本 barrel。

export * from './errors';
export * from './api-response';
export * from './pagination';
export * from './operation';
export * from './retry-advice';
export * from './principal';
export * from './gate';
