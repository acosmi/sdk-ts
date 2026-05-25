// finance/types.ts — 财务 (P7) 公开类型 (商品化总规划 2026-05-25).
//
// 与 tk-dist `dist_invoice` / `dist_contract` / `dist_corporate_transfer` /
// `dist_refund_policy` / `dist_refund_record` / `dist_order_price_snapshot` /
// `dist_reconciliation` 七表族对齐. 决策 14 (对公转账零银行 API) + 决策 15 (退款规则).

/** 发票视图 (P7). */
export interface Invoice {
  id: number;
  /** 发票号 (开票后回写). */
  invoiceNo?: string;
  orderId?: number;
  /** UUID. */
  userId?: string;
  enterpriseId?: number;
  /** NORMAL / VAT_GENERAL / VAT_SPECIAL. */
  invoiceType?: string;
  title?: string;
  taxId?: string;
  bankName?: string;
  bankAccount?: string;
  contactAddress?: string;
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
