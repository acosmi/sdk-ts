// compliance-types.ts — SDK-safe 公共领域类型。
//
// 设计原则（严格）：
//   - 仅声明 Acosmi 领域抽象；不暴露受控证书/密钥材料、provider endpoint、
//     下游内部路由码、provider raw payload、callback signature material、
//     billing commit 内部字段、storage bucket/key、tenant id、subject snapshot id。
//   - 类型字段名严格 camelCase，对应 Java 服务端的 jackson 默认序列化。
//   - status 字符串字面量与 Java 后端枚举 name() 保持一致；前端按字面量分支判断，
//     不依赖后端文案。
//   - 时间字段统一 ISO-8601 字符串（Java LocalDateTime.toString() 默认风格）。
//   - 任何"未来扩展字段"必须先在 Java 公共 DTO 中收敛后再在此声明，杜绝 SDK 提前
//     暴露 service 内部字段。

// =============================================================================
// Evidence Asset
// =============================================================================

export type ComplianceAssetType =
  | 'CONTRACT'
  | 'CODE'
  | 'IMAGE'
  | 'DOCUMENT'
  | 'ARCHIVE'
  | 'HASH_ONLY'
  | 'URL_SNAPSHOT'
  | 'RELEASE'
  | 'LOG'
  | 'OTHER';

export type ComplianceHashAlgorithm = 'sha256' | 'sha512' | 'sm3';

export type ComplianceDigestSource = 'CLIENT' | 'COMPLIANCE_SERVICE' | 'PROVIDER';

export type CompliancePrivacyLevel = 'public' | 'private';

/** 证据资产对外稳定视图。对应后端 EvidenceAssetRespVO。 */
export interface EvidenceAsset {
  id: number;
  /** 业务编号；SDK / 前端引用时优先使用 evidenceNo。 */
  evidenceNo: string;
  /** publish 后的公开 verify code；DRAFT / 非 public privacy 时为 null。 */
  publicVerifyCode?: string | null;
  assetType: ComplianceAssetType | string;
  name: string;
  mimeType?: string | null;
  size?: number | null;
  hashAlgorithm: ComplianceHashAlgorithm | string;
  /** 资产 hash（hex 字符串）。 */
  contentHash: string;
  canonicalizationProfile?: string | null;
  digestSource: ComplianceDigestSource | string;
  privacyLevel: CompliancePrivacyLevel | string;
  status: string;
}

/** 创建证据资产请求；与 Java EvidenceAssetCreateReq 对齐。 */
export interface CreateEvidenceAssetRequest {
  /** AssetTypeEnum.name()。 */
  assetType: ComplianceAssetType | string;
  name: string;
  mimeType?: string;
  /** 'sha256' / 'sha512' / 'sm3'。 */
  hashAlgorithm: ComplianceHashAlgorithm | string;
  /** hex 字符串；hash-only 资产必填。 */
  declaredHash?: string;
  /** CLIENT / COMPLIANCE_SERVICE / PROVIDER。 */
  digestSource?: ComplianceDigestSource | string;
  /** 原文 base64；hash-only 时缺省即可。 */
  contentBase64?: string;
  /** public / private（默认 private）。 */
  privacyLevel?: CompliancePrivacyLevel | string;
  source?: string;
}

/** 公开 verify 结果。隐私边界：不暴露 PII / 合同原文 / storage / provider raw。 */
export interface PublicEvidenceVerifyResult {
  evidenceNo: string;
  assetType: string;
  hashAlgorithm: string;
  contentHash: string;
  size?: number | null;
  canonicalizationProfile?: string | null;
  verifiedAt: string;
  packageId?: number | null;
  manifestHash?: string | null;
  packageHash?: string | null;
  manifestOfflineVerify: boolean;
}

// =============================================================================
// Timestamp
// =============================================================================

export type ComplianceTimestampVerificationStatus =
  | 'PENDING'
  | 'VERIFIED'
  | 'FAILED'
  | 'LOCAL_VERIFY_FAILED'
  | 'UNKNOWN'
  | 'RETRYING';

/** 时间章 token 对外视图（不含 provider/object/tsa 内部字段）。 */
export interface TimestampToken {
  id: number;
  assetId: number;
  policyOid?: string | null;
  serialNumber?: string | null;
  /** gen_time ISO-8601；UNKNOWN/PENDING 状态可能为 null。 */
  genTime?: string | null;
  accuracy?: string | null;
  verificationStatus: ComplianceTimestampVerificationStatus | string;
  verifiedAt?: string | null;
  verificationError?: string | null;
}

/** 申请时间章请求。`provider` 字段已从服务端契约下线；SDK 永远不传。 */
export interface IssueTimestampRequest {
  name?: string;
  mimeType?: string;
  hashAlgorithm: ComplianceHashAlgorithm | string;
  /** 客户端声明 digest（hex）；contentBase64 非空时作为校验值。 */
  digest?: string;
  contentBase64?: string;
}

/** verify 请求 / 结果。 */
export interface VerifyTimestampRequest {
  tokenId: number;
}

export interface TimestampVerifyResult {
  passed: boolean;
  reason: string;
}

// =============================================================================
// Evidence Package
// =============================================================================

export interface EvidencePackage {
  id: number;
  assetId: number;
  timestampTokenId?: number | null;
  chainId: string;
  packageVersion: string;
  hashAlgorithm: string;
  manifestHash: string;
  packageHash: string;
  status: string;
}

// =============================================================================
// Report
// =============================================================================

export interface ComplianceReport {
  id: number;
  reportNo: string;
  reportType: string;
  status: string;
  assetId?: number | null;
  packageId?: number | null;
  publicUrlToken?: string | null;
  publishedAt?: string | null;
  bodyHash?: string | null;
}

export interface CreateReportRequest {
  assetId: number;
  packageId: number;
}

/** 离线复核下载 VO；建议调用方持久化作为长期可重复验证依据。 */
export interface ReportDownload {
  id: number;
  reportNo: string;
  reportType: string;
  status: string;
  bodyHash?: string | null;
  publishedAt?: string | null;
  assetEvidenceNo?: string | null;
  assetHashAlgorithm?: string | null;
  assetContentHash?: string | null;
  packageManifestHash?: string | null;
  packageHash?: string | null;
  packageHashAlgorithm?: string | null;
  timestampSerialNumber?: string | null;
  timestampGenTime?: string | null;
  timestampVerificationStatus?: string | null;
}

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

// =============================================================================
// 公共请求 options
// =============================================================================

/** Compliance 写操作选项；写操作不自动 retry，不自动 401 重放。 */
export interface ComplianceWriteOptions {
  /**
   * 调用方稳定的幂等键。写操作强烈建议持久化；缺省时服务端按 UUID 兜底，但调用方
   * 在重试 / 恢复时无法对账。
   */
  idempotencyKey?: string;
  signal?: AbortSignal;
}

/** 轮询参数（exponential backoff）。 */
export interface CompliancePollOptions {
  /** 总超时（ms），缺省 60s。 */
  timeoutMs?: number;
  /** 初始 interval（ms），缺省 1000。 */
  initialIntervalMs?: number;
  /** interval 倍增上限（ms），缺省 5000。 */
  maxIntervalMs?: number;
  /** 倍增系数，缺省 1.5。 */
  multiplier?: number;
  signal?: AbortSignal;
}
