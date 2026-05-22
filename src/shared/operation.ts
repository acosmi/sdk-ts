// shared/operation.ts — 跨域统一操作（operation projection）原语。
//
// 依据：能力缺口总账 §4.7 / §6.3 / §6.4 / §9.4（Phase 0.3 shared DTO）。
//
// `operationId` 是 console / api / scheduler / crabcode / mcp / 合规等多来源
// 的统一关联键（§2 边界 10）。本文件只沉淀【共享形态原语】；真实 operation
// projection 命名空间须待后端端点 + 契约就绪后落地（§9.1），在此之前 SDK
// `operations` 命名空间保持 `export {}` 占位 —— 提前写空转方法属编造契约。

import type { ComplianceProviderRequestStatus } from '../compliance/provider/types';

/** 统一操作关联键。贯通控制台 / API / MCP / CrabCode / scheduler 各来源。 */
export type OperationId = string;

/**
 * 操作来源。开放联合 —— 平台侧 5 种固定值，合规域可追加自定义来源字符串。
 * `(string & {})` 在保留 IDE 字面量补全的同时不拒绝未知来源（后端保留新增空间）。
 */
export type OperationSource =
  | 'console'
  | 'api'
  | 'scheduler'
  | 'crabcode'
  | 'mcp'
  // 开放联合：`string & NonNullable<unknown>` ≡ `string & {}`，保留字面量补全
  // 同时不拒绝未知值（`{}` 字面量被 eslint ban-types 禁用，故用等价写法）。
  | (string & NonNullable<unknown>);

/**
 * 操作状态机。开放联合，后端保留新增空间。
 *
 * 与 `compliance/status.ts` 的 `ComplianceEnvelopeStatus` 等领域状态【正交】：
 * 领域状态描述某个履约对象的业务态，`OperationStatus` 描述【一次操作】本身
 * 的执行进度。
 */
export type OperationStatus =
  | 'pending'
  | 'running'
  | 'retrying'
  | 'awaiting_callback'
  | 'awaiting_verify'
  | 'succeeded'
  | 'failed'
  | 'canceled'
  | 'unknown'
  | (string & NonNullable<unknown>);

/**
 * 本地 verify 状态（§6.4）。
 *
 * provider success 仅表示 provider request 终态；时间章 / 签署 / 验签 /
 * 证据包 / 报告发布须经后端本地 verify / evidence chain verify。`VerifyStatus`
 * 与 provider 状态是【两个独立维度】，operation projection 必须分别展示
 * （local verify failed → 业务 failed，不 billing settle）。
 */
export type VerifyStatus =
  | 'pending'
  | 'verified'
  | 'failed'
  | 'skipped'
  | 'unknown'
  | (string & NonNullable<unknown>);

/**
 * 幂等键。作用域 = tenant + principal/client + action + product；同 key 同
 * canonical request 返回原结果，同 key 异 request 拒绝（§6.3 / §2 边界 9）。
 * SDK 写接口经 `IdempotencyKeyHeader` 透传，调用方必须【持久化】key。
 */
export type IdempotencyKey = string;

/** 幂等键 HTTP header 名 —— 全 SDK 写接口的单一真相源。 */
export const IdempotencyKeyHeader = 'Idempotency-Key' as const;

/**
 * Provider request 状态。
 *
 * 复核约束（§9.4 勘误）：**不另造同名近似类型** —— 直接复用
 * `compliance/provider/types.ts` 既有 `ComplianceProviderRequestStatus`
 * （`PENDING` / `SUCCESS` / `FAILED` / `UNKNOWN` / `RETRYING`）。
 */
export type ProviderRequestStatus = ComplianceProviderRequestStatus;
