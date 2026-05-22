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

// =============================================================================
// Seal Use — List / Page (compliance gateway S6 — gap-register U-4)
// =============================================================================

/**
 * 用印执行记录分页【列表项】视图。对应后端 G6 `SealUsePageItem`。
 *
 * 一次用印执行（seal use）描述【该次盖章动作本身】的执行进度——envelope /
 * contract / seal / 审批联动后真正调用 provider 落章的那一笔记录，与
 * envelope 领域状态正交。SDK-safe 视图——不含 provider raw payload / 证书 /
 * storage key。时间字段为 ISO-8601 字符串。
 */
export interface SealUsePageItem {
  id: number;
  envelopeId: number;
  contractId: number;
  sealId: number;
  /** 用印执行状态。 */
  usageStatus: string;
  /** 签署位置类型（坐标 / 关键字 / 域字段等）。 */
  signLocationType?: string | null;
  /** 调起时间 ISO-8601。 */
  invokedAt?: string | null;
  /** 成功落章时间 ISO-8601。 */
  consumedAt?: string | null;
  /** 失败时的错误原因（如有）。 */
  failureReason?: string | null;
  /** 创建时间 ISO-8601。 */
  createTime: string;
}

/**
 * `listSealUses` 请求参数。
 *
 * 继承 {@link PageRequest} 分页 / 排序字段；全部可选。`createTimeStart` /
 * `createTimeEnd` 为调用方提供的【原样字符串】，后端按 `yyyy-MM-dd HH:mm:ss`
 * 解析；SDK 不做格式校验或时区转换。
 */
export interface ListSealUsesRequest extends PageRequest {
  /** 印章 id 过滤。 */
  sealId?: number;
  /** 签署 envelope id 过滤。 */
  envelopeId?: number;
  /** 用印执行状态过滤。 */
  usageStatus?: string;
  /** 创建时间下界，`yyyy-MM-dd HH:mm:ss`。 */
  createTimeStart?: string;
  /** 创建时间上界，`yyyy-MM-dd HH:mm:ss`。 */
  createTimeEnd?: string;
}
