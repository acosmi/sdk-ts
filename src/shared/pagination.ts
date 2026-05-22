// shared/pagination.ts — 跨域统一分页请求 / 排序原语。
//
// 依据：能力缺口总账 `docs/audit/saas-sdk-backend-capability-gap-register-2026-05-22`
// §9.4 / §9.5（Phase 0.3 shared DTO）。
//
// 复核约束（§9.4 勘误 F-F）：
//   - 分页【结果】类型【不另立结构】—— `PageResult<T>` 是既有
//     `YudaoPageResult<T>`（`{ list, total }`）的别名，不引入第二套
//     `{ items, total }` 标准，避免 billing / compliance / skills /
//     notifications 之间出现双分页类型。
//   - 分页【请求】类型 `PageRequest` 为新增【可选】共享类型，仅供后续平台
//     控制面 / compliance list 命名空间使用；**不回填改写**既有 4 处内联分页
//     签名（`page` / `pageNo` + `pageSize`），那属破坏性变更。

import type { YudaoPageResult } from './api-response';

/** 排序方向。wire 上为小写字符串。 */
export type SortDirection = 'asc' | 'desc';

/**
 * 跨域统一分页【请求】参数。
 *
 * 既有域（billing / compliance / skills / notifications）各自内联了
 * `page` / `pageNo` + `pageSize`，互不一致；本类型是为后续新命名空间
 * （平台控制面 / `compliance.list*`）提供的统一形态。
 *
 * 字段全部可选 —— 调用方省略时由服务端取默认页；排序字段白名单由各命名
 * 空间各自的 API 文档约定，SDK 不在客户端做字段校验。
 */
export interface PageRequest {
  /** 1-based 页码。 */
  pageNo?: number;
  /** 每页条数。 */
  pageSize?: number;
  /** 排序字段名（领域字段，由各命名空间文档约定白名单）。 */
  sortBy?: string;
  /** 排序方向；省略时由服务端决定默认值。 */
  sortDirection?: SortDirection;
}

/**
 * 跨域统一分页【结果】。
 *
 * **刻意做成 `YudaoPageResult<T>` 的别名** —— 全 SDK 单一分页结果结构
 * `{ list, total }`。新命名空间统一用 `PageResult<T>` 这个对外名，
 * 底层与 tk-dist 代理透传的 yudao 分页结构完全等价、零转换、零双标准。
 */
export type PageResult<T> = YudaoPageResult<T>;
