// compliance/provider/types.ts — SDK-safe provider request 公共领域类型。
//
// 设计原则见 compliance/evidence/types.ts 顶部说明。

// =============================================================================
// Provider Request
// =============================================================================

export type ComplianceProviderRequestStatus =
  | 'PENDING'
  | 'SUCCESS'
  | 'FAILED'
  | 'UNKNOWN'
  | 'RETRYING';

export interface ProviderRequestStatusView {
  id: number;
  status: ComplianceProviderRequestStatus | string;
  /** SUCCESS / FAILED 终态。 */
  terminal: boolean;
  /** 当前状态是否允许 SDK 安全重试请求（仅对 RETRYING 为 true）。 */
  retryable: boolean;
  businessNo?: string | null;
  contractNo?: string | null;
  sealId?: string | null;
  attemptCount?: number | null;
  reconciliationStatus?: string | null;
  nextRetryAt?: string | null;
  requestedAt?: string | null;
  respondedAt?: string | null;
}
