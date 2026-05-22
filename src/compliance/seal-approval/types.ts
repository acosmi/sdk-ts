// compliance/seal-approval/types.ts — SDK-safe 用印审批公共领域类型。
//
// 设计原则见 compliance/evidence/types.ts 顶部说明。

import type { PageRequest } from '../../shared/pagination';

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

// =============================================================================
// List / Page (compliance gateway S1 — gap-register U-1)
// =============================================================================

/**
 * 用印审批分页【列表项】视图。对应后端 G1 `SealApprovalPageItem`。
 *
 * 与 {@link SealApproval} 一致的 SDK-safe 子集 + `createTime`；时间字段为
 * ISO-8601 字符串。
 */
export interface SealApprovalPageItem {
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
  /** 创建时间 ISO-8601。 */
  createTime: string;
}

/**
 * `listSealApprovals` 请求参数。
 *
 * 继承 {@link PageRequest} 分页 / 排序字段；全部可选。`createTimeStart` /
 * `createTimeEnd` 为调用方提供的【原样字符串】，后端按 `yyyy-MM-dd HH:mm:ss`
 * 解析；SDK 不做格式校验或时区转换。
 */
export interface ListSealApprovalsRequest extends PageRequest {
  /** 审批状态过滤。 */
  status?: string;
  /** 创建时间下界，`yyyy-MM-dd HH:mm:ss`。 */
  createTimeStart?: string;
  /** 创建时间上界，`yyyy-MM-dd HH:mm:ss`。 */
  createTimeEnd?: string;
}
