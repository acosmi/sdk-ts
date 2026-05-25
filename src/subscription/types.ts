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

/** 用户当前订阅状态 (P3 商品中心会扩展) */
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
