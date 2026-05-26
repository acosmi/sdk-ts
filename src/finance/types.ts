// finance/types.ts — 财务 (P7) 公开类型 (商品化总规划 2026-05-25).
//
// 与 tk-dist `dist_invoice` / `dist_contract` / `dist_corporate_transfer` /
// `dist_refund_policy` / `dist_refund_record` / `dist_order_price_snapshot` /
// `dist_reconciliation` 七表族对齐. 决策 14 (对公转账零银行 API) + 决策 15 (退款规则).

/**
 * 发票视图 (P7).
 *
 * P2-016 PII 分级说明 (与 tk-dist `DistInvoiceDO` `@Sensitive` 注解严格对齐):
 *  - L0 公开/系统: id / invoiceNo / orderId / enterpriseId / invoiceType / amountFen /
 *                  taxRate / taxAmountFen / status / issuedAt / pdfUrl
 *  - L2 登录态半遮: title / contactAddress
 *  - L3 仅 admin/自己解密读: taxId / bankAccount / contactPhone / bankName
 *
 * listMyInvoices() 由后端 VO 视图返脱敏值 ("130********9876" 等), SDK 类型不强制 PII 级
 * 是因服务端已脱敏; 但 admin 直读 mapper 时该接口仍承载明文 — 调用方 (Web/Desktop) 必须
 * 自行判定上下文, 不要在公开页直接渲染 L3 字段.
 *
 * ---
 *
 * **v1.9.0+ 真落盘加密** (主仓 K10a PII Aspect IMPL-A→IMPL-F 闭环):
 *
 * - V51 finance 7 表族 (`dist_invoice` / `dist_corporate_transfer` / `dist_refund_record` 等)
 *   敏感列改走 `@FieldEncrypt` 切面真加密落盘 (此前是 ALL明文); V63 列宽 VARCHAR→TEXT
 *   兜密文; V64 backfill 老明文 → v2 payload. 切硬模式需运维显式设
 *   `ENCRYPTION_STRICT_MODE=true`, 默认 fail-OPEN 兼容老明文读取直至切换.
 *
 * - **payload 协议 keyVersion v1/v2** (调用方无感, 仅 debug dump DB 可见):
 *   - v1 格式: `enc::v1::wrap::iv::ct`, AAD = `"field"` (旧版兜底)
 *   - v2 格式: `enc::v2::wrap::iv::ct::aad`, AAD = `"acosmi:pii:" + tableName.columnName`
 *     (新版, 跨字段 ciphertext 不互换, 跨表/列加密上下文绑定防 confused-deputy 攻击)
 *
 * - **角色严格化** (v1.9.0+, 主仓 SensitiveSerializer.normalizeAuthority):
 *   yudao 通用 `ROLE_ADMIN` 不再被识别为 `platform_admin` 视角 (旧别名 fail-OPEN 已根治).
 *   调用方传 token 必须真有以下角色之一才能解密 L3 字段:
 *   - `ROLE_PLATFORM_ADMIN` — 平台管理员 (跨租户 admin)
 *   - `ROLE_S2S` — 服务对服务调用
 *   - `ROLE_LAWYER` — 律师 (仅自己 L1/L2, L3 仍脱敏)
 *   - `ROLE_CONSUMER` — 消费者 (仅自己 L1/L2, L3 仍脱敏)
 *
 *   未匹配上述任一者 → 视同 guest, L2/L3 全脱敏返回.
 *   详细矩阵见 `docs/pii-role-matrix.md`.
 */
export interface Invoice {
  id: number;
  /** 发票号 (开票后回写). L0. */
  invoiceNo?: string;
  orderId?: number;
  /** UUID. L0 (用户对自己可见, admin 跨用户聚合视为 L2). */
  userId?: string;
  enterpriseId?: number;
  /** NORMAL / VAT_GENERAL / VAT_SPECIAL. L0. */
  invoiceType?: string;
  /** 抬头. L2. */
  title?: string;
  /** 税号. L3 — 服务端按上下文脱敏/加密. */
  taxId?: string;
  /** 开户行. L3. */
  bankName?: string;
  /** 银行账号. L3 — `@FieldEncrypt` 存储加密. */
  bankAccount?: string;
  /** 收件地址. L2. */
  contactAddress?: string;
  /** 联系手机. L3 — `@FieldEncrypt` 存储加密. */
  contactPhone?: string;
  amountFen?: number;
  /** 6% 默认. */
  taxRate?: number;
  taxAmountFen?: number;
  /** PENDING / ISSUED / VOIDED / REISSUED. */
  status?: string;
  issuedAt?: string;
  pdfUrl?: string;
}

/** 开票申请 request. */
export interface RequestInvoiceInput {
  orderId?: number;
  enterpriseId?: number;
  invoiceType?: 'NORMAL' | 'VAT_GENERAL' | 'VAT_SPECIAL';
  title: string;
  taxId?: string;
  bankName?: string;
  bankAccount?: string;
  contactAddress?: string;
  contactPhone?: string;
  amountFen: number;
  taxRate?: number;
}

/** 退款规则字典 (决策 15). */
export interface RefundPolicy {
  id: number;
  /** SUBSCRIPTION_NO_REFUND / TOKEN_PACK_7DAY_UNUSED / ... */
  policyCode: string;
  /** MODEL_MEMBERSHIP / TOKEN_PACK / COMPLIANCE / LEGAL_SERVICE. */
  productFamily?: string;
  /** 退款窗口期 (NULL = 不退). */
  refundWindowDays?: number;
  /** NO_REFUND / FULL_IF_UNUSED / PRORATA_UNUSED. */
  refundRule?: string;
  requireProof?: boolean;
  status?: string;
  description?: string;
}

/** 退款记录. */
export interface RefundRecord {
  id: number;
  orderId: number;
  /** UUID. */
  userId: string;
  policyCode?: string;
  requestedAmountFen?: number;
  approvedAmountFen?: number;
  /** 实退 (扣已用). */
  actualAmountFen?: number;
  reason?: string;
  /** PENDING / APPROVED / REFUNDED / REJECTED. */
  status?: string;
  /** UUID. */
  operatorUserId?: string;
  refundedAt?: string;
  rejectedReason?: string;
}

/** 退款申请 request. */
export interface RequestRefundInput {
  orderId: number;
  /** 直传 policyCode; 留空可用 productFamily + anyUsage 派生. */
  policyCode?: string;
  productFamily?: 'MODEL_MEMBERSHIP' | 'TOKEN_PACK' | 'COMPLIANCE' | 'LEGAL_SERVICE';
  anyUsage?: boolean;
  requestedAmountFen: number;
  reason?: string;
}

/** 对公转账记录 (决策 14). */
export interface CorporateTransfer {
  id: number;
  orderId?: number;
  contractId?: number;
  /** UUID. */
  userId?: string;
  enterpriseId?: number;
  amountFen?: number;
  payerBank?: string;
  payerAccount?: string;
  receiverBank?: string;
  receiverAccount?: string;
  /** UUID. */
  salesRepUserId?: string;
  /** UUID. */
  financeUserId?: string;
  wechatGroupUrl?: string;
  /** INITIATED / WAITING_PROOF / PROOF_RECEIVED / CONFIRMED / FAILED. */
  status?: string;
  proofUrl?: string;
  confirmedAt?: string;
  note?: string;
}

/** 对公转账发起 request. */
export interface InitiateCorporateTransferInput {
  orderId?: number;
  enterpriseId?: number;
  contractId?: number;
  amountFen: number;
  payerBank?: string;
  payerAccount?: string;
  note?: string;
}

/**
 * 对公转账发起 response (决策 14).
 * 前端拿到 qrUrl + salesWechatId + financeEmail 后渲染弹窗,
 * 引导用户加销售企微 / 邮件财务对接, 零银行 API 路径.
 */
export interface InitiateCorporateTransferResult {
  id: number;
  /** 销售名片二维码 URL (ops 配置). */
  qrUrl?: string;
  /** 销售企微 ID. */
  salesWechatId?: string;
  /** 财务对接邮箱. */
  financeEmail?: string;
}
