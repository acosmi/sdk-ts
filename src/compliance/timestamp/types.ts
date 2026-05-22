// compliance/timestamp/types.ts — SDK-safe 时间章公共领域类型。
//
// 设计原则见 compliance/evidence/types.ts 顶部说明。

import type { ComplianceHashAlgorithm } from '../evidence/types';

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
