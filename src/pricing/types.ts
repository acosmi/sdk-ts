// pricing/types.ts — 商品化总规划 P1 公开业务参数类型.
//
// 与 tk-dist `controller/admin/pricing/DistPricingConfigAdminController` + `app/pricing/AppPublicPricingController`
// 对齐. 公开端点仅返回白名单 key (tk_to_fen_ratio / usd_cny_rate / freezone_reset_timezone).

/** 公开业务参数 (key → 字符串原值, caller 自解析数值/布尔). */
export type PricingConfig = Record<string, string>;

/** 公开模型摘要 (P3 商品中心会扩展) */
export interface PublicModelSummary {
  id: string;
  name: string;
  modelId: string;
  provider: string;
  /** 商品化档位门控: 0=FREE 1=BASIC 2=PRO 3=PRO_MAX 4=ULTRA */
  minPlanTier?: number;
  isEnabled: boolean;
}

// ===========================================================================
// 商品化总规划 P4 §-1.2.B — csign 电子认证 SKU 公开类型
// ===========================================================================

/** csign SKU benefit_type. */
export type ComplianceBenefitType = 'CONTRACT' | 'IDENTITY' | 'EVIDENCE' | 'SEAL';

/** csign SKU 公开视图 (字段与 AppCompliancePricingController.PublicSkuResponse 同源).
 *
 * 不含 upstreamCostFen / status 等内部字段。 */
export interface ComplianceSku {
  skuCode: string;
  benefitType: ComplianceBenefitType | string;
  providerProduct?: string;
  unitPriceFen?: number;
  overagePriceFen?: number;
  regionScope?: string;
  description?: string;
  /** 套餐覆盖次数: {"PRO":10,"PRO_MAX":50,...} */
  includedInPlans?: Record<string, number>;
}

/** 匿名估价响应. 无用户态, 不查覆盖余额. */
export interface ComplianceQuoteResponse {
  skuCode: string;
  regionScope?: string;
  quantity?: number;
  unitPriceFen?: number;
  overagePriceFen?: number;
  subtotalFen?: number;
  available?: boolean;
  benefitType?: string;
  description?: string;
}
