// compliance/signing/types.ts — SDK-safe 签署 envelope 公共领域类型。
//
// 设计原则见 compliance/evidence/types.ts 顶部说明。

import type { PageRequest } from '../../shared/pagination';

// =============================================================================
// Signing Envelope
// =============================================================================

export interface SigningEnvelope {
  id: number;
  envelopeNo: string;
  applicantUserId?: string | null;
  status: string;
  primaryContractId?: number | null;
  contractHash?: string | null;
  hashAlgorithm?: string | null;
  billingGroupId?: string | null;
  chainId?: string | null;
  requestId?: string | null;
  pendingReason?: string | null;
  signedAt?: string | null;
  evidenceReadyAt?: string | null;
  committedAt?: string | null;
}

/** 创建 envelope 请求；只保留调用方业务字段，内部主体快照和履约通道由后端推导。 */
export interface CreateSigningEnvelopeRequest {
  envelopeNo?: string;
  requestId?: string;
  /** 调用方稳定 idempotency-key（不传则由 Idempotency-Key header 兜底）。 */
  idempotencyKey?: string;
  billingGroupId?: string;
  chainId?: string;
}

/** sign 请求；service 默认闸门关闭，SDK 写示例必须处理 ENVELOPE_GATE_CLOSED 错误。 */
export interface SignEnvelopeRequest {
  approvalRequestId?: number;
  contractId?: number;
  contractHash?: string;
  sealId?: number;
  signLocationType?: string;
  signLocationPayload?: string;
  transactorId?: number;
  requestId?: string;
  idempotencyKey?: string;
}

/** H5 短链请求。 */
export interface CreateH5SigningUrlRequest extends SignEnvelopeRequest {}

// =============================================================================
// List / Page (compliance gateway S1 — gap-register U-1)
// =============================================================================

/**
 * 签署 envelope 分页【列表项】视图。对应后端 G1 `SigningEnvelopePageItem`。
 *
 * 与 {@link SigningEnvelope} 一致的 SDK-safe 子集 + `createTime`；时间字段为
 * ISO-8601 字符串。
 */
export interface SigningEnvelopePageItem {
  id: number;
  envelopeNo: string;
  applicantUserId?: string | null;
  status: string;
  primaryContractId?: number | null;
  contractHash?: string | null;
  hashAlgorithm?: string | null;
  billingGroupId?: string | null;
  chainId?: string | null;
  requestId?: string | null;
  pendingReason?: string | null;
  signedAt?: string | null;
  evidenceReadyAt?: string | null;
  committedAt?: string | null;
  /** 创建时间 ISO-8601。 */
  createTime: string;
}

/**
 * `listSigningEnvelopes` 请求参数。
 *
 * 继承 {@link PageRequest} 分页 / 排序字段；全部可选。`createTimeStart` /
 * `createTimeEnd` 为调用方提供的【原样字符串】，后端按 `yyyy-MM-dd HH:mm:ss`
 * 解析；SDK 不做格式校验或时区转换。
 */
export interface ListSigningEnvelopesRequest extends PageRequest {
  /** envelope 状态过滤。 */
  status?: string;
  /** 创建时间下界，`yyyy-MM-dd HH:mm:ss`。 */
  createTimeStart?: string;
  /** 创建时间上界，`yyyy-MM-dd HH:mm:ss`。 */
  createTimeEnd?: string;
}

// =============================================================================
// Envelope Completion (compliance gateway S4 — gap-register U-10 / U-12)
// =============================================================================

/**
 * 签署 envelope 下挂的合同【列表项】视图。对应后端 G4 `EnvelopeContractItem`。
 *
 * 一个 envelope 可挂多份合同；本视图描述合同的元数据与哈希指纹，便于离线复核。
 * SDK-safe 子集——不含合同原文 / storage key / provider raw payload。时间字段
 * 为 ISO-8601 字符串。
 */
export interface EnvelopeContractItem {
  /** 合同行 id（数值主键）。 */
  id: number;
  /** 所属 envelope id。 */
  envelopeId: number;
  /** 合同编号。 */
  contractNo: string;
  /** 合同标题。 */
  title: string;
  /** 合同文件 MIME 类型。 */
  mimeType: string;
  /** 合同文件字节数。 */
  size: number;
  /** 哈希算法（如 `sha256`）。 */
  hashAlgorithm: string;
  /** 合同原文内容哈希。 */
  contentHash: string;
  /** 签署后内容哈希（未签署时缺省）。 */
  signedContentHash?: string;
  /** 合同状态。 */
  status: string;
  /** 创建时间 ISO-8601。 */
  createTime: string;
}

/**
 * `voidEnvelope` 请求体。作废一个签署 envelope，`reason` 为必填的作废原因。
 */
export interface VoidEnvelopeRequest {
  /** 作废原因（必填，随 JSON body 提交）。 */
  reason: string;
}
