// compliance/report/types.ts — SDK-safe 证据报告公共领域类型。
//
// 设计原则见 compliance/evidence/types.ts 顶部说明。

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
