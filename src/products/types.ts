// products/types.ts — 商品化总规划 P3 商品中心类型 (与 tk-dist DistProductMappingDO + AppPublicProductController 对齐).
//
// 端口自 tk-dist `controller/app/product/AppPublicProductController.toPublicResponse`.
// 公开端点字段白名单严格 — feature_gate_json / retired_at / sales_channel_json / price_snapshot_policy 不暴露.

/** 商品族 (与 V47 dist_product_mapping.product_family 对齐) */
export type ProductFamily =
  | 'MODEL_MEMBERSHIP'
  | 'TOKEN_PACK'
  | 'COMPLIANCE'
  | 'LEGAL'
  | 'DESIGN_AGENT'
  | 'ENTERPRISE';

/** 受众 */
export type Audience = 'PERSONAL' | 'ENTERPRISE' | 'DEVELOPER';

/** 计费模式 */
export type BillingMode = 'ONE_TIME' | 'SUBSCRIPTION' | 'METERED' | 'HYBRID';

/** 地区范围 */
export type RegionScope = 'CN' | 'OS' | 'GLOBAL';

/** 商品族枚举常量 (供 UI dropdown / 校验使用, 与后端 enum 严格对齐) */
export const ProductFamilyEnum = {
  MODEL_MEMBERSHIP: 'MODEL_MEMBERSHIP',
  TOKEN_PACK: 'TOKEN_PACK',
  COMPLIANCE: 'COMPLIANCE',
  LEGAL: 'LEGAL',
  DESIGN_AGENT: 'DESIGN_AGENT',
  ENTERPRISE: 'ENTERPRISE',
} as const satisfies Record<ProductFamily, ProductFamily>;

export const AudienceEnum = {
  PERSONAL: 'PERSONAL',
  ENTERPRISE: 'ENTERPRISE',
  DEVELOPER: 'DEVELOPER',
} as const satisfies Record<Audience, Audience>;

export const BillingModeEnum = {
  ONE_TIME: 'ONE_TIME',
  SUBSCRIPTION: 'SUBSCRIPTION',
  METERED: 'METERED',
  HYBRID: 'HYBRID',
} as const satisfies Record<BillingMode, BillingMode>;

export const RegionScopeEnum = {
  CN: 'CN',
  OS: 'OS',
  GLOBAL: 'GLOBAL',
} as const satisfies Record<RegionScope, RegionScope>;

/**
 * 公开商品响应 (字段白名单严格).
 * <p>
 * 后端 toPublicResponse 仅输出以下字段; 不会出现 featureGateJson / retiredAt / salesChannelJson / priceSnapshotPolicy.
 * displayMetadataJson 是后端原文字符串 (caller 自 JSON.parse, 缺省可能为 null).
 */
export interface Product {
  id: number;
  /** 公开 slug = biz_product_id (V1 建表 UNIQUE) */
  publicSlug: string;
  displayName: string;
  productFamily: ProductFamily | null;
  audience: Audience | null;
  billingMode: BillingMode | null;
  regionScope: RegionScope | null;
  basePriceFen: number | null;
  tokenQuota: number | null;
  /** 后端原文 JSON 字符串 (含 title/subtitle/badge/highlights/icon 等), 由 caller 自解析 */
  displayMetadataJson: string | null;
}
