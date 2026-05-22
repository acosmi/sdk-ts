// compliance/evidence/types.ts — SDK-safe 证据资产 / 证据包公共领域类型。
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
