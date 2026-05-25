// casehall/types.ts — 法律案件咨询 namespace 公开类型 (商品化总规划 P5 方案 B 2026-05-25).
//
// 与 tk-dist `yudao-module-casehall` 对齐. P5 阶段 SDK 仅暴露公开端点视图;
// admin / S2S 端点 (lawyer-credential 审核等) 不在 SDK 边界, 仅 admin UI 直连。

/** 律师档案公开视图 (L1 公开端点白名单, licenseNo 等 PII L3 字段已脱敏剥离). */
export interface LawyerSummary {
  id: number;
  realName: string;
  lawFirm?: string;
  /** 执业领域 (后端 practice_area_json 解析为数组). */
  practiceAreas?: string[];
  yearsOfPractice?: number;
  avatarUrl?: string;
  location?: string;
  languages?: string;
  rating?: number;
  caseHandledCount?: number;
  /** PENDING / VERIFIED / REJECTED / EXPIRED. */
  verificationStatus?: string;
  /** ACTIVE / DISABLED / SUSPENDED. */
  status?: string;
}

/** 案件线索创建请求 (用户提交). */
export interface SubmitCaseLeadRequest {
  /** CONSULTATION / DOC_REVIEW / CASE_REPRESENT. */
  caseType?: string;
  title: string;
  summary?: string;
  location?: string;
  /** LOW / NORMAL / URGENT. */
  urgency?: string;
  /** 预算 (分). */
  budgetFen?: number;
  /** ISO 日期 yyyy-MM-dd. */
  expectedAt?: string;
}

/** 案件线索 (用户视角) — summary 仅在自己的线索返回, 不在公开市场列表中。 */
export interface CaseLead {
  id: number;
  caseType?: string;
  title: string;
  summary?: string;
  location?: string;
  urgency?: string;
  budgetFen?: number;
  expectedAt?: string;
  /** OPEN / MATCHED / CLAIMED / CLOSED / EXPIRED. */
  status: string;
  claimCount?: number;
  matchedLawyerId?: number;
  expiresAt?: string;
  createTime?: string;
}

/** 案件 (委托人视角) — description 仅双方可见。 */
export interface CaseMatter {
  id: number;
  leadId?: number;
  lawyerId: number;
  matterType?: string;
  title: string;
  description?: string;
  /** ACTIVE / ON_HOLD / CLOSED / ARCHIVED. */
  status: string;
  /** WON / LOST / SETTLED / WITHDRAWN. */
  outcome?: string;
  startedAt?: string;
  closedAt?: string;
}

/** 法律咨询单 (双方视图). */
export interface LegalConsultation {
  id: number;
  lawyerId?: number;
  /** 命中 dist_compliance_sku.sku_code, benefit_type='LEGAL_SERVICE'. */
  skuCode: string;
  matterId?: number;
  durationMin?: number;
  scheduledAt?: string;
  startedAt?: string;
  endedAt?: string;
  /** PENDING / SCHEDULED / ONGOING / DONE / CANCELED. */
  status: string;
  rating?: number;
}

/** 法律咨询预约请求. */
export interface BookConsultationRequest {
  /** 必填: LEGAL_CONSULTATION_ONCE / LEGAL_CONSULTATION_60MIN. */
  skuCode: string;
  /** 可选: 指定律师, 留空走 AI 推荐池. */
  lawyerId?: number;
  /** ISO 时刻. */
  scheduledAt?: string;
  /** 关联案件. */
  matterId?: number;
}

/** 法律服务订单 (用户视角). */
export interface LegalServiceOrder {
  id: number;
  lawyerId?: number;
  skuCode: string;
  /** 跨模块松耦合关联 distribution 主订单。 */
  distributionOrderId?: number;
  amountFen: number;
  /** PENDING / PAID / FULFILLING / DONE / REFUNDED / CANCELED. */
  status: string;
  paidAt?: string;
  doneAt?: string;
}

/** 5 Legal SKU (与 dist_compliance_sku benefit_type='LEGAL_SERVICE' 同源). */
export type LegalSkuCode =
  | 'LEGAL_CONSULTATION_ONCE'
  | 'LEGAL_CONSULTATION_60MIN'
  | 'LEGAL_DOC_REVIEW_HUMAN'
  | 'LEGAL_CASE_LEAD_CLAIM'
  | 'LEGAL_LAWYER_SERVICE_PKG';

/** 法律服务 SKU 公开视图 (与 ComplianceSku 同 schema, 仅 benefit_type 收敛为 LEGAL_SERVICE). */
export interface LegalServiceSku {
  skuCode: string;
  /** 固定 'LEGAL_SERVICE'. */
  benefitType: 'LEGAL_SERVICE' | string;
  providerProduct?: string;
  unitPriceFen?: number;
  overagePriceFen?: number;
  regionScope?: string;
  description?: string;
  includedInPlans?: Record<string, number>;
}
