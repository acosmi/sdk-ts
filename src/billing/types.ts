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
  /** 仅出现在 /grants map (toEntitlementMap 之外的 grants 端点)。 */
  createdAt?: string;
  /** list (toEntitlementMap) 与 grants 均返回 activatedAt。 */
  activatedAt?: string;
}

// 形状严格对齐网关 model.InternalBalanceResponse (entitlement.go GetBalanceDetail 直透)。
export interface BalanceDetailEntitlement {
  id: string;
  sourceOrderId?: string;
  status: string;
  tokenQuota: number;
  tokenUsed: number;
  expiresAt?: string;
}

/** 详细余额 (含每条权益明细) */
export interface BalanceDetail {
  userId: string;
  tokenRemaining: number;
  tokenTotal: number;
  callRemaining: number;
  callTotal: number;
  entitlements: BalanceDetailEntitlement[];
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
  // V32 缓存/预留/调用计数列 (ConsumeRecordDO), 旧表未迁移时为 0/缺省。
  reservedTokens?: number;
  callsConsumed?: number;
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheCreateTokens?: number;
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
/** @deprecated 系数管理已退役 (raw 1:1 计费)。网关 /entitlements/coefficients 永久返回 []。本类型仅为向后兼容保留。 */
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

/** 流量包商品。形状对齐 ConsumerPublicController.toProductView (/api/products 端点, /token-packages 代理转发)。 */
export interface TokenPackage {
  id: string;
  name: string;
  description?: string;
  originalPriceCent: number;
  campaignPriceCent: number;
  renewalPriceCent: number;
  /** 折扣率 0~1 (BigDecimal, JSON 数字); 0 表示无折扣 */
  discountRate: number;
  modelsJson?: string;
  productImage?: string;
  features?: string[];
  billingCycle: string;
  featured: boolean;
  eyebrow?: string;
  promo?: string;
  usage?: string;
  sortOrder: number;
}

/** 支付方式枚举字面量 (来自 /payment-options)。 */
export type PaymentMethod = 'WECHAT_NATIVE' | 'ALIPAY_PRECREATE' | 'BANK_TRANSFER';

/** 下单请求 */
export interface PayPayload {
  /** 支付方式枚举字面量 (来自 /payment-options)。字段名必须是 paymentMethod (后端 BuyRequest.paymentMethod)。 */
  paymentMethod?: PaymentMethod;
  deviceId?: string;
  /** 幂等请求 ID */
  clientRequestId?: string;
}

/** 下单 / 订单状态响应 (OrderPaymentService.BuyResponse, buy 与状态查询共用)。 */
export interface BuyResponse {
  orderId: number;
  orderNo: string;
  productId?: string;
  productName?: string;
  amountFen: number;
  orderStatus: string;
  paymentMethod: string;
  paymentStatus: string;
  qrCodeContent?: string;
  payUrl?: string;
  paymentExpiresAt?: string;
  /** 对公转账信息 (BANK_TRANSFER 时), 形状为后端嵌套对象 */
  bankTransferInfo?: Record<string, unknown>;
}

/** 我的订单列表行 (toOrderMap)。 */
export interface OrderListItem {
  id: string;
  bizOrderId?: string;
  productName?: string;
  amountCent: number;
  originalPriceCent?: number;
  discountRate?: string;
  paymentMethod?: string;
  payStatus: string;
  commissionStatus?: string;
  issueStatus?: string;
  channelCode?: string;
  createdAt?: string;
  payTime?: string;
}

/** @deprecated 旧形状与任何真实端点都不符; buy/状态查询改用 BuyResponse, 列表用 OrderListItem。 */
export type Order = BuyResponse;

/** @deprecated getOrderStatus 现返回 BuyResponse (无 status 字段)。 */
export type OrderStatus = BuyResponse;

// =============================================================================
// Wallet (钱包)
// =============================================================================

// Go wallet.go 用 float64 (非 json.Number) → wire 是 JSON 数字, 故用 number (与全局 amount=string 约定不同, 因为这是 Go float64 端点)。
/** 钱包统计。 */
export interface WalletStats {
  balance: number;
  monthlyConsumption: number;
  monthlyRecharge: number;
  transactionCount: number;
}

/** 交易记录 */
export interface Transaction {
  id: string;
  type: string;
  amount: number;
  remark?: string;
  createdAt: string;
}
