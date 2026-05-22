// compliance/timestamp/types.ts — SDK-safe 时间章公共领域类型。
//
// 设计原则见 compliance/evidence/types.ts 顶部说明。

import type { ComplianceHashAlgorithm } from '../evidence/types';
import type { PageRequest } from '../../shared/pagination';

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
// List / Page (compliance gateway S1 — gap-register U-1)
// =============================================================================

/**
 * 时间章分页【列表项】视图。对应后端 G1 `TimestampPageItem`。
 *
 * 与 {@link TimestampToken} 一致的 SDK-safe 子集 + `createTime`；时间字段为
 * ISO-8601 字符串。
 */
export interface TimestampPageItem {
  id: number;
  assetId: number;
  policyOid?: string | null;
  serialNumber?: string | null;
  genTime?: string | null;
  accuracy?: string | null;
  verificationStatus: ComplianceTimestampVerificationStatus | string;
  verifiedAt?: string | null;
  verificationError?: string | null;
  /** 创建时间 ISO-8601。 */
  createTime: string;
}

/**
 * `listTimestamps` 请求参数。
 *
 * 继承 {@link PageRequest} 分页 / 排序字段；全部可选。`createTimeStart` /
 * `createTimeEnd` 为调用方提供的【原样字符串】，后端按 `yyyy-MM-dd HH:mm:ss`
 * 解析；SDK 不做格式校验或时区转换。
 */
export interface ListTimestampsRequest extends PageRequest {
  /** 时间章 provider 过滤（`TsaProviderEnum.name()` 之类）。 */
  provider?: string;
  /** 校验状态过滤。 */
  verificationStatus?: ComplianceTimestampVerificationStatus | string;
  /** 创建时间下界，`yyyy-MM-dd HH:mm:ss`。 */
  createTimeStart?: string;
  /** 创建时间上界，`yyyy-MM-dd HH:mm:ss`。 */
  createTimeEnd?: string;
}

// =============================================================================
// TSA readonly views (compliance gateway S3 — gap-register U-7)
// =============================================================================

/**
 * 时间章授权机构（TSA）provider 视图。对应后端 G3 `TsaProviderVO`。
 *
 * 描述某个 TSA provider 的对外可见状态——名称、所处环境、当前是否可用。
 * 只读视图：不含 provider 端点、凭证、证书或其它内部接入材料。
 */
export interface TsaProvider {
  /** provider 名称（如 `TsaProviderEnum.name()`）。 */
  name: string;
  /** provider 所处环境（如 `production` / `sandbox`）。 */
  environment: string;
  /** 该 provider 当前是否可用。 */
  available: boolean;
}

/**
 * 时间章统计视图。对应后端 G3 `TsaStatsVO`。
 *
 * 只读聚合：时间章总数 + 按校验状态分桶的计数。
 */
export interface TsaStats {
  /** 时间章总数。 */
  total: number;
  /**
   * 按校验状态分桶的计数。键为校验状态枚举名（如 `VERIFIED` / `PENDING` /
   * `FAILED`），值为该状态下的时间章数量。
   */
  byVerificationStatus: Record<string, number>;
}
