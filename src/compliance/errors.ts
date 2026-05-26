// compliance/errors.ts — Java numeric ErrorCode → SDK symbolic key.
//
// 设计原则：
//   - Java 后端通过 cn.iocoder.yudao.module.compliance.enums.ErrorCodeConstants 暴露
//     数值错误码（1-031-xxx-xxx）。本文件按段位 + 具体码值映射为 SDK 内部 symbolic key，
//     仅作 SDK 分支判断 / 文档说明，不作为 wire response 反序列化字段。
//   - 不要尝试从后端 message 文案做正则识别 — message 是中文可变的，code 才是合同。
//   - retryable / terminal / stepUpRequired 严格按"是否安全自动重发"语义：
//       * stepUpRequired: 客户端引导用户重新做 OAuth introspection / step-up，不要静默 retry。
//       * retryable: 仅对幂等的网络/资源短暂错误为 true（当前默认全为 false，因为
//         compliance 写接口严禁自动重发）。
//       * terminal: 不需要 SDK 再次轮询；用户必须用新 idempotency-key 重新发起。
//
// =============================================================================
// v1.9.0+ admin 写端点行为变更 (主仓 K10AdminController IMPL-E + IMPL-F)
// =============================================================================
//
// 主仓 csign / compliance-billing admin 写端点 (POST `/api/admin/csign/seals` /
// `/api/distribution/compliance-billing/commit|cancel|refund` 等) 在 v1.9.0+ 改用
// 标准 HTTP 状态码语义, 不再统一返 `200 + CommonResult{ok:false, code:N}`:
//
//   - 跨租户访问别人的资源 → `HTTPError statusCode=403` (FORBIDDEN)
//   - 资源不存在 / 已删除      → `HTTPError statusCode=404` (NOT_FOUND)
//   - 印章/能力未配置        → `HTTPError statusCode=501` (NOT_IMPLEMENTED, 主仓
//                              `GlobalErrorCodeConstants.NOT_IMPLEMENTED`, 旧
//                              `NOT_CONFIGURED_CODE` 别名指向同一码)
//   - 业务校验失败          → `HTTPError statusCode=400` + CommonResult.error code/message
//
// 这些是通用 HTTP 状态码契约, 不属于 compliance 1-031-xxx-xxx 业务段位, 故本文件
// 不引入新数值码. 集成方应对:
//
//   try {
//     await client.compliance.someAdminWriteMethod(...);
//   } catch (e) {
//     if (e instanceof HTTPError) {
//       if (e.statusCode === 403) /* 跨租户 */;
//       if (e.statusCode === 404) /* 资源不存在 */;
//       if (e.statusCode === 501) /* 印章未配置 */;
//     }
//   }
//
// 不再读 `CommonResult.ok` 字段判定 admin 写端点成功 — v1.9.0+ HTTP 状态码即真相,
// 4xx/5xx 必抛 HTTPError, 不再 `200 + {ok:false}` 静默失败.

import type { BusinessError } from '../shared/errors';

/**
 * SDK 内部 symbolic key；用于代码分支判断与文档。**不是 wire contract**。
 */
export type ComplianceErrorKey =
  // 通用 / token / scope
  | 'COMPLIANCE_UNAUTHORIZED'
  | 'COMPLIANCE_INSUFFICIENT_SCOPE'
  | 'COMPLIANCE_STEP_UP_REQUIRED'
  | 'COMPLIANCE_TOKEN_INVALID'
  // 主体快照
  | 'SUBJECT_SNAPSHOT_REQUIRED'
  | 'SUBJECT_SNAPSHOT_NOT_FOUND'
  | 'SUBJECT_SNAPSHOT_TENANT_MISMATCH'
  // Evidence / Timestamp / Package / Report
  | 'EVIDENCE_ASSET_NOT_FOUND'
  | 'EVIDENCE_ASSET_HASH_MISMATCH'
  | 'EVIDENCE_ASSET_PAYLOAD_REQUIRED'
  | 'TIMESTAMP_TOKEN_NOT_FOUND'
  | 'TIMESTAMP_PROVIDER_FAILED'
  | 'TIMESTAMP_PROVIDER_UNKNOWN'
  | 'TIMESTAMP_LOCAL_VERIFY_FAILED'
  | 'TIMESTAMP_PROVIDER_NOT_AVAILABLE'
  | 'EVIDENCE_PACKAGE_NOT_FOUND'
  | 'EVIDENCE_PACKAGE_TIMESTAMP_REQUIRED'
  | 'EVIDENCE_PACKAGE_MANIFEST_HASH_MISMATCH'
  | 'REPORT_NOT_FOUND'
  | 'REPORT_ALREADY_PUBLISHED'
  | 'REPORT_DRAFT_REQUIRED'
  | 'EVIDENCE_VERIFY_TARGET_REQUIRED'
  | 'EVIDENCE_VERIFY_TARGET_NOT_FOUND'
  // Provider request
  | 'PROVIDER_REQUEST_UNKNOWN_NO_RETRY'
  | 'PROVIDER_CALLBACK_SOURCE_INVALID'
  | 'PROVIDER_NOT_CONFIGURED'
  | 'PROVIDER_REQUEST_NOT_FOUND'
  | 'PROVIDER_REQUEST_IDEMPOTENCY_REQUIRED'
  | 'PROVIDER_REQUEST_STATUS_NOT_TERMINAL'
  // Envelope
  | 'ENVELOPE_NOT_FOUND'
  | 'ENVELOPE_TENANT_MISMATCH'
  | 'ENVELOPE_STATE_NOT_ALLOWED'
  | 'ENVELOPE_GATE_CLOSED'
  | 'CONTRACT_NOT_FOUND'
  | 'CONTRACT_HASH_MISMATCH'
  | 'PROVIDER_AUTHORIZATION_NOT_CONFIRMED'
  | 'ENVELOPE_EVIDENCE_NOT_READY'
  // Seal approval
  | 'SEAL_ASSET_NOT_FOUND'
  | 'SEAL_APPROVAL_NOT_FOUND'
  | 'SEAL_APPROVAL_STATE_NOT_APPROVED'
  | 'SEAL_APPROVAL_EXPIRED'
  | 'SEAL_APPROVAL_ALREADY_USED'
  | 'SEAL_APPROVAL_NONCE_USED'
  | 'SEAL_APPROVAL_SEAL_MISMATCH'
  | 'SEAL_APPROVAL_LOCATION_MISMATCH'
  | 'SEAL_APPROVAL_TRANSACTOR_MISMATCH'
  | 'SEAL_APPROVAL_CONTRACT_HASH_MISMATCH'
  | 'SEAL_APPROVAL_INVALID_TRANSITION'
  | 'SEAL_USE_ALREADY_CONSUMED'
  // Audit chain
  | 'AUDIT_CHAIN_TAMPER_DETECTED'
  // Billing
  | 'BILLING_COMMIT_REQUIRES_LOCAL_VERIFY'
  | 'BILLING_COMMIT_REQUIRES_PROVIDER_SUCCESS'
  | 'BILLING_CALLBACK_CANNOT_COMMIT'
  | 'BILLING_PROVIDER_UNKNOWN_NOT_COMMITTABLE'
  | 'BILLING_S2S_FORBIDDEN'
  // SDK fallback
  | 'UNKNOWN_COMPLIANCE_ERROR';

/** 单个错误的 SDK 视图。 */
export interface ComplianceErrorInfo {
  /** Java numeric error code (wire contract)。 */
  code: number;
  /** 服务端原始 message（中文，可变）；仅用于日志/展示。 */
  message: string;
  /** SDK 分支判断用 symbolic key。 */
  key: ComplianceErrorKey;
  /** 是否安全自动重试 — compliance 写接口几乎全为 false。 */
  retryable: boolean;
  /** 是否已经是终态 — 用户必须用新 idempotency-key 重新发起。 */
  terminal: boolean;
  /** 高风险动作需要 step-up / introspection。 */
  stepUpRequired: boolean;
}

// =============================================================================
// numeric → symbolic 映射（与 Java ErrorCodeConstants 同步）。
// =============================================================================

const CODE_TO_KEY: Record<number, ComplianceErrorKey> = {
  // 通用 / token / scope (1-031-000-xxx)
  1031000001: 'COMPLIANCE_UNAUTHORIZED',
  1031000002: 'COMPLIANCE_TOKEN_INVALID',
  1031000003: 'COMPLIANCE_TOKEN_INVALID',
  1031000004: 'COMPLIANCE_TOKEN_INVALID',
  1031000005: 'COMPLIANCE_TOKEN_INVALID',
  1031000006: 'COMPLIANCE_TOKEN_INVALID',
  1031000007: 'COMPLIANCE_TOKEN_INVALID',
  1031000008: 'COMPLIANCE_TOKEN_INVALID',
  1031000009: 'COMPLIANCE_TOKEN_INVALID',
  1031000010: 'COMPLIANCE_TOKEN_INVALID',
  1031000011: 'COMPLIANCE_TOKEN_INVALID',
  1031000012: 'COMPLIANCE_INSUFFICIENT_SCOPE',
  1031000013: 'COMPLIANCE_STEP_UP_REQUIRED',
  // Subject snapshot (1-031-001-xxx)
  1031001001: 'SUBJECT_SNAPSHOT_NOT_FOUND',
  1031001002: 'SUBJECT_SNAPSHOT_TENANT_MISMATCH',
  1031001003: 'SUBJECT_SNAPSHOT_REQUIRED',
  // Evidence / Timestamp / Package / Report (1-031-002-xxx)
  1031002001: 'EVIDENCE_ASSET_NOT_FOUND',
  1031002002: 'SUBJECT_SNAPSHOT_TENANT_MISMATCH',
  1031002003: 'EVIDENCE_ASSET_HASH_MISMATCH',
  1031002004: 'EVIDENCE_ASSET_PAYLOAD_REQUIRED',
  1031002005: 'EVIDENCE_ASSET_PAYLOAD_REQUIRED',
  1031002006: 'TIMESTAMP_TOKEN_NOT_FOUND',
  1031002007: 'TIMESTAMP_PROVIDER_FAILED',
  1031002008: 'TIMESTAMP_PROVIDER_UNKNOWN',
  1031002009: 'TIMESTAMP_LOCAL_VERIFY_FAILED',
  1031002010: 'TIMESTAMP_PROVIDER_NOT_AVAILABLE',
  1031002011: 'EVIDENCE_PACKAGE_NOT_FOUND',
  1031002012: 'EVIDENCE_PACKAGE_TIMESTAMP_REQUIRED',
  1031002013: 'EVIDENCE_PACKAGE_MANIFEST_HASH_MISMATCH',
  1031002014: 'REPORT_NOT_FOUND',
  1031002015: 'REPORT_ALREADY_PUBLISHED',
  1031002016: 'REPORT_DRAFT_REQUIRED',
  1031002017: 'EVIDENCE_VERIFY_TARGET_REQUIRED',
  1031002018: 'EVIDENCE_VERIFY_TARGET_NOT_FOUND',
  // Provider request (1-031-003-xxx)
  1031003001: 'PROVIDER_REQUEST_UNKNOWN_NO_RETRY',
  1031003002: 'PROVIDER_CALLBACK_SOURCE_INVALID',
  1031003003: 'PROVIDER_NOT_CONFIGURED',
  1031003010: 'PROVIDER_REQUEST_NOT_FOUND',
  1031003011: 'PROVIDER_REQUEST_IDEMPOTENCY_REQUIRED',
  1031003012: 'PROVIDER_REQUEST_STATUS_NOT_TERMINAL',
  // Envelope (1-031-004-xxx)
  1031004001: 'ENVELOPE_NOT_FOUND',
  1031004002: 'ENVELOPE_TENANT_MISMATCH',
  1031004003: 'ENVELOPE_STATE_NOT_ALLOWED',
  1031004004: 'ENVELOPE_GATE_CLOSED',
  1031004005: 'CONTRACT_NOT_FOUND',
  1031004006: 'CONTRACT_HASH_MISMATCH',
  1031004007: 'CONTRACT_NOT_FOUND',
  1031004008: 'PROVIDER_AUTHORIZATION_NOT_CONFIRMED',
  1031004009: 'PROVIDER_AUTHORIZATION_NOT_CONFIRMED',
  1031004010: 'ENVELOPE_EVIDENCE_NOT_READY',
  // Seal approval / use (1-031-005-xxx)
  1031005001: 'SEAL_ASSET_NOT_FOUND',
  1031005010: 'SEAL_APPROVAL_NOT_FOUND',
  1031005011: 'SEAL_APPROVAL_NOT_FOUND',
  1031005012: 'SEAL_APPROVAL_STATE_NOT_APPROVED',
  1031005013: 'SEAL_APPROVAL_EXPIRED',
  1031005014: 'SEAL_APPROVAL_ALREADY_USED',
  1031005015: 'SEAL_APPROVAL_NONCE_USED',
  1031005016: 'SEAL_APPROVAL_SEAL_MISMATCH',
  1031005017: 'SEAL_APPROVAL_LOCATION_MISMATCH',
  1031005018: 'SEAL_APPROVAL_TRANSACTOR_MISMATCH',
  1031005019: 'SEAL_APPROVAL_CONTRACT_HASH_MISMATCH',
  1031005020: 'SEAL_APPROVAL_INVALID_TRANSITION',
  1031005030: 'SEAL_USE_ALREADY_CONSUMED',
  // Billing (1-031-006-xxx)
  1031006004: 'BILLING_COMMIT_REQUIRES_LOCAL_VERIFY',
  1031006005: 'BILLING_COMMIT_REQUIRES_PROVIDER_SUCCESS',
  1031006007: 'BILLING_CALLBACK_CANNOT_COMMIT',
  1031006008: 'BILLING_PROVIDER_UNKNOWN_NOT_COMMITTABLE',
  1031006009: 'BILLING_S2S_FORBIDDEN',
  // Audit (1-031-007-xxx)
  1031007011: 'AUDIT_CHAIN_TAMPER_DETECTED',
};

const STEP_UP_KEYS = new Set<ComplianceErrorKey>(['COMPLIANCE_STEP_UP_REQUIRED']);

const TERMINAL_KEYS = new Set<ComplianceErrorKey>([
  'ENVELOPE_GATE_CLOSED',
  'PROVIDER_NOT_CONFIGURED',
  'PROVIDER_REQUEST_UNKNOWN_NO_RETRY',
  'BILLING_CALLBACK_CANNOT_COMMIT',
  'BILLING_COMMIT_REQUIRES_LOCAL_VERIFY',
  'BILLING_COMMIT_REQUIRES_PROVIDER_SUCCESS',
  'BILLING_PROVIDER_UNKNOWN_NOT_COMMITTABLE',
  'BILLING_S2S_FORBIDDEN',
  'SEAL_APPROVAL_NONCE_USED',
  'SEAL_APPROVAL_EXPIRED',
  'SEAL_APPROVAL_CONTRACT_HASH_MISMATCH',
  'SEAL_APPROVAL_SEAL_MISMATCH',
  'SEAL_APPROVAL_LOCATION_MISMATCH',
  'SEAL_APPROVAL_TRANSACTOR_MISMATCH',
  'SEAL_USE_ALREADY_CONSUMED',
  'CONTRACT_HASH_MISMATCH',
  'TIMESTAMP_LOCAL_VERIFY_FAILED',
  'EVIDENCE_PACKAGE_MANIFEST_HASH_MISMATCH',
  'AUDIT_CHAIN_TAMPER_DETECTED',
  'PROVIDER_REQUEST_NOT_FOUND',
  'EVIDENCE_ASSET_HASH_MISMATCH',
  'EVIDENCE_VERIFY_TARGET_NOT_FOUND',
  'REPORT_ALREADY_PUBLISHED',
]);

// 真正"网络层 / 资源短暂不可用"才允许 retryable=true。compliance 错误几乎全部 false。
const RETRYABLE_KEYS = new Set<ComplianceErrorKey>([]);

/**
 * 把一个 BusinessError 分类为 compliance 视图。
 * 非 compliance 段位的错误码会回退到 UNKNOWN_COMPLIANCE_ERROR，调用方应该当作业务错误处理。
 */
export function classifyComplianceError(err: BusinessError): ComplianceErrorInfo {
  const key = CODE_TO_KEY[err.code] ?? 'UNKNOWN_COMPLIANCE_ERROR';
  return {
    code: err.code,
    message: err.message,
    key,
    retryable: RETRYABLE_KEYS.has(key),
    terminal: TERMINAL_KEYS.has(key),
    stepUpRequired: STEP_UP_KEYS.has(key),
  };
}

/**
 * 判断 BusinessError 是否属于 compliance 段位（1-031-xxx-xxx）。
 * 不在段位的错误码可能来自其它 yudao 模块，按通用业务错误处理即可。
 */
export function isComplianceBusinessError(err: BusinessError): boolean {
  return err.code >= 1031000000 && err.code <= 1031999999;
}
