// compliance/report/types.ts — SDK-safe 证据报告公共领域类型。
//
// 设计原则见 compliance/evidence/types.ts 顶部说明。

import type { PageRequest } from '../../shared/pagination';

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
// List / Page (compliance gateway S1 — gap-register U-1)
// =============================================================================

/**
 * 证据报告分页【列表项】视图。对应后端 G1 `ReportPageItem`。
 *
 * 与 {@link ComplianceReport} 一致的 SDK-safe 子集 + `createTime`；时间字段为
 * ISO-8601 字符串。
 */
export interface ReportPageItem {
  id: number;
  reportNo: string;
  reportType: string;
  status: string;
  assetId?: number | null;
  packageId?: number | null;
  publicUrlToken?: string | null;
  publishedAt?: string | null;
  bodyHash?: string | null;
  /** 创建时间 ISO-8601。 */
  createTime: string;
}

/**
 * `listReports` 请求参数。
 *
 * 继承 {@link PageRequest} 分页 / 排序字段；全部可选。`createTimeStart` /
 * `createTimeEnd` 为调用方提供的【原样字符串】，后端按 `yyyy-MM-dd HH:mm:ss`
 * 解析；SDK 不做格式校验或时区转换。
 */
export interface ListReportsRequest extends PageRequest {
  /** 报告状态过滤。 */
  status?: string;
  /** 创建时间下界，`yyyy-MM-dd HH:mm:ss`。 */
  createTimeStart?: string;
  /** 创建时间上界，`yyyy-MM-dd HH:mm:ss`。 */
  createTimeEnd?: string;
}
