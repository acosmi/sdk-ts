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

import type { PageRequest } from '../../shared/pagination';

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

// =============================================================================
// List / Page (compliance gateway S1 — gap-register U-1)
// =============================================================================

/**
 * 证据资产分页【列表项】视图。对应后端 G1 `EvidenceAssetPageItem`。
 *
 * 与 {@link EvidenceAsset} 一致的 SDK-safe 子集 + `createTime`；时间字段为
 * ISO-8601 字符串。
 */
export interface EvidenceAssetPageItem {
  id: number;
  evidenceNo: string;
  publicVerifyCode?: string | null;
  assetType: ComplianceAssetType | string;
  name: string;
  mimeType?: string | null;
  size?: number | null;
  hashAlgorithm: ComplianceHashAlgorithm | string;
  contentHash: string;
  canonicalizationProfile?: string | null;
  digestSource: ComplianceDigestSource | string;
  privacyLevel: CompliancePrivacyLevel | string;
  status: string;
  /** 创建时间 ISO-8601。 */
  createTime: string;
}

/**
 * `listEvidenceAssets` 请求参数。
 *
 * 继承 {@link PageRequest} 的 `pageNo` / `pageSize` / `sortBy` / `sortDirection`，
 * 全部可选；省略时由服务端取默认页。
 *
 * `createTimeStart` / `createTimeEnd` 为调用方提供的【原样字符串】，后端按
 * `yyyy-MM-dd HH:mm:ss` 解析（例如 `'2026-05-01 00:00:00'`）；SDK 不做格式校验、
 * 不做时区转换，原样透传查询参数。
 */
export interface ListEvidenceAssetsRequest extends PageRequest {
  /** 资产类型过滤（`AssetTypeEnum.name()`）。 */
  assetType?: ComplianceAssetType | string;
  /** 资产状态过滤。 */
  status?: string;
  /** 创建时间下界，`yyyy-MM-dd HH:mm:ss`。 */
  createTimeStart?: string;
  /** 创建时间上界，`yyyy-MM-dd HH:mm:ss`。 */
  createTimeEnd?: string;
}

/**
 * 证据包分页【列表项】视图。对应后端 G1 `EvidencePackagePageItem`。
 */
export interface EvidencePackagePageItem {
  id: number;
  assetId: number;
  timestampTokenId?: number | null;
  chainId: string;
  packageVersion: string;
  hashAlgorithm: string;
  manifestHash: string;
  packageHash: string;
  status: string;
  /** 创建时间 ISO-8601。 */
  createTime: string;
}

/**
 * `listEvidencePackages` 请求参数。`createTimeStart` / `createTimeEnd` 语义见
 * {@link ListEvidenceAssetsRequest}。
 */
export interface ListEvidencePackagesRequest extends PageRequest {
  /** 证据包状态过滤。 */
  status?: string;
  /** 创建时间下界，`yyyy-MM-dd HH:mm:ss`。 */
  createTimeStart?: string;
  /** 创建时间上界，`yyyy-MM-dd HH:mm:ss`。 */
  createTimeEnd?: string;
}
