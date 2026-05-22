// compliance/signing/types.ts — SDK-safe 签署 envelope 公共领域类型。
//
// 设计原则见 compliance/evidence/types.ts 顶部说明。

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
