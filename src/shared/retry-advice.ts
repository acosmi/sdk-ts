// shared/retry-advice.ts — 跨域统一失败补救建议（retryAdvice）。
//
// 依据：能力缺口总账 §6.6 / §9.4（Phase 0.3 shared DTO，缺口 R-6）。
//
// 复核约束（§9.4 勘误 F-G / §6 边界 11）：
//   - `RetryAdvice` 是【叠加层】—— 独立类型、独立字段，**不修改也不替换**
//     `core/retry.ts` 的 `RetryPolicy` 与 `compliance/errors.ts` 的
//     `ComplianceErrorInfo`（`retryable` / `terminal` / `stepUpRequired`）。
//     `RetryPolicy` 决定 SDK 传输层【是否自动重试】；`RetryAdvice` 是面向
//     调用方 / 终端用户的【补救建议投影】，二者职责不同、不可互相替代。
//   - `reason` 不开第四套错误码登记表 —— 它是既有三套登记表（Java 数值码 /
//     SDK 符号 key / Go OAuth 标准字符串）的【小写归一化映射】。本文件即
//     §6.6 要求的"既有码 → reason"映射表。

import type { ComplianceErrorInfo, ComplianceErrorKey } from '../compliance/errors';

/**
 * 失败补救原因。开放枚举的【封闭】部分 —— 这 11 个值覆盖 §6.6 要求的全集。
 *
 * 其中 `gate_closed` / `step_up_required` / `tenant_mismatch` /
 * `insufficient_scope` 与既有错误码登记表同名概念一一对应（见下方映射表），
 * 不是新造的码。
 */
export type RetryAdviceReason =
  | 'unknown'
  | 'retrying'
  | 'failed'
  | 'gate_closed'
  | 'step_up_required'
  | 'tenant_mismatch'
  | 'insufficient_scope'
  | 'quota_exceeded'
  | 'provider_timeout'
  | 'local_verify_failed'
  | 'billing_preflight_failed';

/** `RetryAdviceReason` 全集（11 项）—— 供迭代 / 校验使用。 */
export const RETRY_ADVICE_REASONS: readonly RetryAdviceReason[] = [
  'unknown',
  'retrying',
  'failed',
  'gate_closed',
  'step_up_required',
  'tenant_mismatch',
  'insufficient_scope',
  'quota_exceeded',
  'provider_timeout',
  'local_verify_failed',
  'billing_preflight_failed',
] as const;

/**
 * 失败补救建议统一模型（§6.6）。
 *
 * 高风险 / 收费动作失败后，后端 operation projection 产出本结构告诉调用方
 * 「能不能重试、要不要换幂等键、要不要人工介入」。
 */
export interface RetryAdvice {
  /** 是否值得【自动】重试。compliance 写接口几乎恒为 false（双扣红线）。 */
  retryable: boolean;
  /** 建议的重试等待时长（秒）；与 `HTTPError.retryAfter` 单位一致。 */
  retryAfter?: number;
  /**
   * 重试时是否必须沿用【同一】幂等键。
   * 同 key 同 canonical request → 服务端返回原结果（对账语义）；
   * 终态错误须改用【新】幂等键重新发起（§6.3）。
   */
  sameIdempotencyKeyRequired: boolean;
  /** 是否需要人工介入（重新登录 / step-up / 联系支持），不能纯自动恢复。 */
  manualActionRequired: boolean;
  /** 归一化失败原因。 */
  reason: RetryAdviceReason;
  /** 面向终端用户的提示文案（调用方可用自有 copy 表覆盖）。 */
  userMessage?: string;
  /** 面向开发者的诊断信息（如服务端原始 message）。 */
  developerMessage?: string;
  /** 支持工单关联码（如 `compliance:1031004004`）。 */
  supportCode?: string;
}

// =============================================================================
// 映射表 1：SDK compliance 符号 key（`ComplianceErrorKey`）→ `RetryAdviceReason`
//
// 用 `Record<ComplianceErrorKey, ...>` 强约束【穷举】：compliance/errors.ts 新增
// 任一 `ComplianceErrorKey` 而此处未补映射，本文件即编译失败 —— 映射表不会漏。
// =============================================================================

const COMPLIANCE_KEY_TO_RETRY_REASON: Record<ComplianceErrorKey, RetryAdviceReason> = {
  // 通用 / token / scope
  COMPLIANCE_UNAUTHORIZED: 'failed',
  COMPLIANCE_INSUFFICIENT_SCOPE: 'insufficient_scope',
  COMPLIANCE_STEP_UP_REQUIRED: 'step_up_required',
  COMPLIANCE_TOKEN_INVALID: 'failed',
  // 主体快照
  SUBJECT_SNAPSHOT_REQUIRED: 'failed',
  SUBJECT_SNAPSHOT_NOT_FOUND: 'failed',
  SUBJECT_SNAPSHOT_TENANT_MISMATCH: 'tenant_mismatch',
  // Evidence / Timestamp / Package / Report
  EVIDENCE_ASSET_NOT_FOUND: 'failed',
  EVIDENCE_ASSET_HASH_MISMATCH: 'local_verify_failed',
  EVIDENCE_ASSET_PAYLOAD_REQUIRED: 'failed',
  TIMESTAMP_TOKEN_NOT_FOUND: 'failed',
  TIMESTAMP_PROVIDER_FAILED: 'failed',
  TIMESTAMP_PROVIDER_UNKNOWN: 'unknown',
  TIMESTAMP_LOCAL_VERIFY_FAILED: 'local_verify_failed',
  TIMESTAMP_PROVIDER_NOT_AVAILABLE: 'provider_timeout',
  EVIDENCE_PACKAGE_NOT_FOUND: 'failed',
  EVIDENCE_PACKAGE_TIMESTAMP_REQUIRED: 'failed',
  EVIDENCE_PACKAGE_MANIFEST_HASH_MISMATCH: 'local_verify_failed',
  REPORT_NOT_FOUND: 'failed',
  REPORT_ALREADY_PUBLISHED: 'failed',
  REPORT_DRAFT_REQUIRED: 'failed',
  EVIDENCE_VERIFY_TARGET_REQUIRED: 'failed',
  EVIDENCE_VERIFY_TARGET_NOT_FOUND: 'failed',
  // Provider request
  PROVIDER_REQUEST_UNKNOWN_NO_RETRY: 'unknown',
  PROVIDER_CALLBACK_SOURCE_INVALID: 'failed',
  PROVIDER_NOT_CONFIGURED: 'gate_closed',
  PROVIDER_REQUEST_NOT_FOUND: 'failed',
  PROVIDER_REQUEST_IDEMPOTENCY_REQUIRED: 'failed',
  PROVIDER_REQUEST_STATUS_NOT_TERMINAL: 'retrying',
  // Envelope
  ENVELOPE_NOT_FOUND: 'failed',
  ENVELOPE_TENANT_MISMATCH: 'tenant_mismatch',
  ENVELOPE_STATE_NOT_ALLOWED: 'failed',
  ENVELOPE_GATE_CLOSED: 'gate_closed',
  CONTRACT_NOT_FOUND: 'failed',
  CONTRACT_HASH_MISMATCH: 'local_verify_failed',
  PROVIDER_AUTHORIZATION_NOT_CONFIRMED: 'failed',
  ENVELOPE_EVIDENCE_NOT_READY: 'retrying',
  // Seal approval / use
  SEAL_ASSET_NOT_FOUND: 'failed',
  SEAL_APPROVAL_NOT_FOUND: 'failed',
  SEAL_APPROVAL_STATE_NOT_APPROVED: 'failed',
  SEAL_APPROVAL_EXPIRED: 'failed',
  SEAL_APPROVAL_ALREADY_USED: 'failed',
  SEAL_APPROVAL_NONCE_USED: 'failed',
  SEAL_APPROVAL_SEAL_MISMATCH: 'failed',
  SEAL_APPROVAL_LOCATION_MISMATCH: 'failed',
  SEAL_APPROVAL_TRANSACTOR_MISMATCH: 'failed',
  SEAL_APPROVAL_CONTRACT_HASH_MISMATCH: 'local_verify_failed',
  SEAL_APPROVAL_INVALID_TRANSITION: 'failed',
  SEAL_USE_ALREADY_CONSUMED: 'failed',
  // Audit chain
  AUDIT_CHAIN_TAMPER_DETECTED: 'local_verify_failed',
  // Billing
  BILLING_COMMIT_REQUIRES_LOCAL_VERIFY: 'local_verify_failed',
  BILLING_COMMIT_REQUIRES_PROVIDER_SUCCESS: 'billing_preflight_failed',
  BILLING_CALLBACK_CANNOT_COMMIT: 'billing_preflight_failed',
  BILLING_PROVIDER_UNKNOWN_NOT_COMMITTABLE: 'billing_preflight_failed',
  BILLING_S2S_FORBIDDEN: 'failed',
  // SDK fallback
  UNKNOWN_COMPLIANCE_ERROR: 'unknown',
};

/** SDK compliance 符号 key → `RetryAdviceReason`。未知 key 兜底 `unknown`。 */
export function retryReasonForComplianceKey(key: ComplianceErrorKey): RetryAdviceReason {
  return COMPLIANCE_KEY_TO_RETRY_REASON[key] ?? 'unknown';
}

// =============================================================================
// 映射表 2：Go OAuth 标准错误字符串 → `RetryAdviceReason`
//
// 仅登记与 `RetryAdviceReason` 有同名概念的标准 OAuth 错误；其余按 `failed`。
// =============================================================================

const OAUTH_ERROR_TO_RETRY_REASON: Record<string, RetryAdviceReason> = {
  insufficient_scope: 'insufficient_scope',
  invalid_token: 'failed',
  invalid_grant: 'failed',
  invalid_request: 'failed',
  access_denied: 'failed',
  unsupported_grant_type: 'failed',
};

/** Go OAuth 标准错误字符串 → `RetryAdviceReason`。未登记的兜底 `unknown`。 */
export function retryReasonForOAuthError(oauthError: string): RetryAdviceReason {
  return OAUTH_ERROR_TO_RETRY_REASON[oauthError] ?? 'unknown';
}

// =============================================================================
// 叠加投影：`ComplianceErrorInfo` → `RetryAdvice`
//
// 这是 §9.4「叠加不替换」约束的具体实现 —— 纯函数，【只读】`ComplianceErrorInfo`、
// 不修改它，产出独立的 `RetryAdvice`。`compliance/errors.ts` 与
// `csign sdk-client.ts:classifyVerifyError` 完全不受影响。
// =============================================================================

/**
 * 把 `ComplianceErrorInfo`（compliance/errors.ts `classifyComplianceError` 的产出）
 * 投影为统一 `RetryAdvice`。
 *
 * 语义：
 *   - `retryable` 直接透传 `info.retryable`（compliance 写接口恒 false）。
 *   - 终态错误（`info.terminal`）→ 须改用【新】幂等键 →
 *     `sameIdempotencyKeyRequired=false`、`manualActionRequired=true`。
 *   - step-up 错误 → 重新做 OAuth introspection 后用【同一】幂等键重试 →
 *     `sameIdempotencyKeyRequired=true`、`manualActionRequired=true`。
 *   - 其余（非终态、非 step-up）→ 沿用同一幂等键对账重发。
 *
 * 不读、不写 `ComplianceErrorInfo` 以外的状态；入参不被 mutate。
 */
export function complianceErrorToRetryAdvice(info: ComplianceErrorInfo): RetryAdvice {
  return {
    retryable: info.retryable,
    sameIdempotencyKeyRequired: !info.terminal,
    manualActionRequired: info.terminal || info.stepUpRequired,
    reason: retryReasonForComplianceKey(info.key),
    developerMessage: info.message,
    supportCode: `compliance:${info.code}`,
  };
}
