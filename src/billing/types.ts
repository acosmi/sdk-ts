// billing/types.ts — 计费域类型 (entitlements / metering / wallet / 商城)。
//
// 端口自 acosmi-sdk-go/types.go (v0.19.0) 的 Entitlements / V29 Per-Model Bucket /
// Token Packages / Wallet 段。
//
// 命名约定：字段名 = Go json tag 字面量 (wire format), 不做 camelCase 重映射。
// json.Number 用 string (避免精度丢失, 金融安全)。

// =============================================================================
// Entitlements
// =============================================================================

/** 权益余额 (聚合) */
export interface EntitlementBalance {
  totalTokenQuota: number;
  totalTokenUsed: number;
  totalTokenRemaining: number;
  totalCallQuota: number;
  totalCallUsed: number;
  totalCallRemaining: number;
  activeEntitlements: number;
}

/** 单条权益明细 */
export interface EntitlementItem {
  id: string;
  type: string;
  status: string;
  tokenQuota: number;
  tokenUsed: number;
  tokenRemaining: number;
  callQuota: number;
  callUsed: number;
  callRemaining: number;
  expiresAt?: string;
  sourceId?: string;
  sourceType?: string;
  remark?: string;
  createdAt: string;
}

/** 详细余额 (含每条权益明细) */
export interface BalanceDetail {
  totalTokenQuota: number;
  totalTokenUsed: number;
  totalTokenRemaining: number;
  totalCallQuota: number;
  totalCallUsed: number;
  totalCallRemaining: number;
  activeEntitlements: number;
  entitlements: EntitlementItem[];
}

/** 核销记录 */
export interface ConsumeRecord {
  id: string;
  entitlementId: string;
  requestId: string;
  modelId?: string;
  tokensConsumed: number;
  status: string;
  createdAt: string;
}

/** 核销记录分页响应 */
export interface ConsumeRecordPage {
  records: ConsumeRecord[];
  total: number;
  page: number;
  pageSize: number;
}

// =============================================================================
// V29 Per-Model Bucket
// =============================================================================

/**
 * 单桶视图 (用户多桶 hero / 模型切换提示用)
 *
 * 字段名仍叫 ETU 但 T3 死代码清除后 = raw token (V29 系数管理已退役)。
 */
export interface ModelBucket {
  bucketId: string;
  entitlementId: string;
  /** "*" = 通配 */
  modelId: string;
  /** COMMERCIAL / GENERIC */
  bucketClass: string;
  tokenQuota: number;
  tokenUsed: number;
  tokenRemaining: number;
  callQuota: number;
  callUsed: number;
  callRemaining: number;
  allowedModelsJson?: string;
}

/** GetByModel 响应; primaryBucket 在 bucketId 为空时表示无可用桶。 */
export interface ModelByQuotaResponse {
  modelId: string;
  /** 折算后剩余 (调度判定用) */
  etuRemaining: number;
  /** 反系数估算的原始 token (UI 展示用) */
  rawTokenRemaining: number;
  hasQuota: boolean;
  primaryBucket?: ModelBucket;
}

/** 单条模型系数 (SDK TTL 8s 缓存源) */
export interface ModelCoefficient {
  modelId: string;
  tenantId: string;
  inputCoef: number;
  outputCoef: number;
  cacheReadCoef: number;
  cacheCreationCoef: number;
  version: number;
  effectiveAt: string;
}

// =============================================================================
// Token Packages (商城)
// =============================================================================

/** 流量包商品。price 用 string (Go json.Number) 避免浮点精度丢失。 */
export interface TokenPackage {
  id: string;
  name: string;
  description?: string;
  tokenQuota: number;
  callQuota?: number;
  price: string;
  validDays: number;
  isEnabled: boolean;
  sortOrder?: number;
}

/** 订单。amount 用 string (Go json.Number) 避免精度丢失。 */
export interface Order {
  id: string;
  packageId: string;
  packageName?: string;
  amount: string;
  status: string;
  payUrl?: string;
  createdAt: string;
}

/** 订单状态 */
export interface OrderStatus {
  orderId: string;
  status: string;
}

/** 下单请求 */
export interface PayPayload {
  payMethod?: string;
}

// =============================================================================
// Wallet (钱包)
// =============================================================================

/** 钱包统计。金额使用 string (Go json.Number) 避免浮点精度丢失 (金融安全) */
export interface WalletStats {
  balance: string;
  monthlyConsumption: string;
  monthlyRecharge: string;
  transactionCount: number;
}

/** 交易记录 */
export interface Transaction {
  id: string;
  type: string;
  amount: string;
  remark?: string;
  createdAt: string;
}
