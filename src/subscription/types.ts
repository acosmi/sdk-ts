// subscription/types.ts — 商品化总规划 P1 订阅档位类型 (与 tk-dist DistSubscriptionPlanDO 对齐).
//
// 端口自 tk-dist `controller/app/pricing/AppPublicPricingController.PublicPlanResponse`.

/** 订阅档位受众 */
export type SubscriptionAudience = 'PERSONAL' | 'ENTERPRISE';

/** 滚存策略 */
export type RolloverPolicy = 'NONE' | 'PARTIAL' | 'FULL';

/** 公开订阅计划 (字段白名单, 不含 feature_gate / seat_rule_json 等内部字段) */
export interface SubscriptionPlan {
  id: number;
  planCode: string;
  audience: SubscriptionAudience;
  tierLevel: number;
  planName: string;
  planDesc: string;
  billingCycle: string;
  basePriceFen: number;
  /** 档位标准额度。付费档单位 = 微 Credits (÷1000 = Credits): BASIC 0.6亿 / PRO 3亿 / PRO_MAX 9亿 / ULTRA 24亿 Credits。 */
  tokenQuota: number;
  seatMin?: number | null;
  seatMax?: number | null;
  rolloverPolicy?: RolloverPolicy | null;
  basePlanCode?: string | null;
  /** 与 base_plan_code 一组使用; v1 钉死 BASIC=null=1.0 / PRO=5 / PRO_MAX=20 / ULTRA=100 */
  tkMultiplier?: string | null;
  /** 同上; v1 钉死 BASIC=null=1.0 / PRO=3.3 / PRO_MAX=10 / ULTRA=33 */
  priceMultiplier?: string | null;
  /** grant_policy 摘要 (P3 商品中心补) */
  grantPolicyDigest?: Record<string, unknown> | null;
}

/** C 端会员中心订阅概览 — 严格对齐网关 GET /entitlements/membership (membership.go membershipResponse)。 */
export interface Membership {
  hasActive: boolean;
  planCode: string;
  planName: string;
  tier: string;
  billingCycle: string;
  status: string;
  expiresAt: string;
  priceFen: number;
  /** 周期总额度。有活跃付费订阅 (hasActive=true) 时单位 = 微 Credits (÷1000 = Credits 代币); 免费档 = 原始 Token。 */
  tokenQuota: number;
  /** 当前周期已用 (后端 float64)。单位同 tokenQuota: 付费=微Credits / 免费=Token。 */
  tokenUsed: number;
  periodStart: string;
  /** isFree = !hasActive (无活跃付费订阅即免费档) */
  isFree: boolean;
}

/** 由活跃权益推导的订阅层级 — 对齐网关 GET /entitlements/subscription (entitlement.go GetSubscription)。 */
export interface SubscriptionTier {
  /** "free" | "pro" (后端按权益类型推导) */
  subscriptionType: string;
  activeEntitlementTypes: string[];
}

/** @deprecated 网关未暴露订阅列表端点; 该形状不对应任何真实响应。请改用 Membership + getMembership()。保留仅为向后兼容。 */
export interface UserSubscription {
  id: number;
  userId: string;
  planId: number;
  planCode?: string;
  audience?: SubscriptionAudience;
  /** active / paused / cancelled */
  status: string;
  /** ISO date — yyyy-MM-dd 字符串 (Java LocalDate.toString) */
  nextDeductDate?: string | null;
  agreementNo?: string | null;
}
