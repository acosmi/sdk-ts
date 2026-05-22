// compliance/seal-approval/types.ts — SDK-safe 用印审批公共领域类型。
//
// 设计原则见 compliance/evidence/types.ts 顶部说明。

// =============================================================================
// Seal Approval
// =============================================================================

export interface SealApproval {
  id: number;
  envelopeId?: number | null;
  contractId?: number | null;
  contractHash?: string | null;
  hashAlgorithm?: string | null;
  sealId?: number | null;
  applicantUserId?: string | null;
  approverUserId?: string | null;
  transactorId?: number | null;
  signLocationType?: string | null;
  signLocationPayload?: string | null;
  reason?: string | null;
  expiresAt?: string | null;
  status: string;
  approvedAt?: string | null;
  rejectedAt?: string | null;
  canceledAt?: string | null;
}

/** 提交审批；provider 侧字段由后端归一，SDK 调用方不传。 */
export interface SubmitSealApprovalRequest {
  envelopeId?: number;
  contractId?: number;
  contractHash?: string;
  hashAlgorithm?: string;
  sealId?: number;
  approverUserId?: string;
  transactorId?: number;
  signLocationType?: string;
  signLocationPayload?: string;
  reason?: string;
}

export interface ApproveSealApprovalQuery {
  expiresAt?: string;
  note?: string;
}

export interface RejectSealApprovalQuery {
  reason?: string;
}

export interface CancelSealApprovalQuery {
  reason?: string;
}
