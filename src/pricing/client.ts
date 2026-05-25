// pricing/client.ts — 公开业务参数 API (商品化总规划 P1 §13.2).
//
// 端点: tk-dist `/api/distribution/public/pricing/config` + `/models` (经 Go 反代).
// P1 SDK 仅暴露 namespace; P3 商品中心接入时网关路由补.

import type { APIResponse } from '../shared/api-response';
import type {
  PricingConfig,
  PublicModelSummary,
  ComplianceSku,
  ComplianceQuoteResponse,
} from './types';
import { Client } from '../core/client';

declare module '@acosmi/sdk-ts' {
  interface Client {
    /**
     * 查询公开业务参数. 不传 key → 默认返三件 (tk_to_fen_ratio/usd_cny_rate/freezone_reset_timezone);
     * 传 key (白名单内) → 仅返该 key. caller 自解析数值/布尔.
     */
    getPricingConfig(key?: string, signal?: AbortSignal): Promise<PricingConfig>;

    /** 公开模型列表 (P3 商品中心会重做; P1 阶段后端 stub 返空数组) */
    listPublicModels(signal?: AbortSignal): Promise<PublicModelSummary[]>;

    // =========================================================================
    // 商品化总规划 P4 §-1.2.B — csign 电子认证 SKU (公开匿名可读)
    // =========================================================================

    /**
     * 列出 csign 公开 SKU (匿名可调用).
     * @param region 区域 CN / OS / GLOBAL (空 fallback CN, 同时返回 GLOBAL)
     */
    listComplianceSkus(region?: string, signal?: AbortSignal): Promise<ComplianceSku[]>;

    /**
     * 匿名估价 (无用户态, 不查覆盖余额, 仅返回 overage 价 × 数量).
     * 真实用户报价含套餐覆盖需走登录后服务端 quote 端点。
     */
    quoteCompliance(
      skuCode: string,
      quantity?: number,
      region?: string,
      signal?: AbortSignal,
    ): Promise<ComplianceQuoteResponse>;
  }
}

Client.prototype.getPricingConfig = async function (
  this: Client,
  key?: string,
  signal?: AbortSignal,
): Promise<PricingConfig> {
  const query = key ? `?key=${encodeURIComponent(key)}` : '';
  const resp = await this.doJSON<APIResponse<PricingConfig>>(
    'GET',
    `/distribution/public/pricing/config${query}`,
    null,
    signal,
  );
  return resp.data ?? {};
};

Client.prototype.listPublicModels = async function (
  this: Client,
  signal?: AbortSignal,
): Promise<PublicModelSummary[]> {
  const resp = await this.doJSON<APIResponse<PublicModelSummary[]>>(
    'GET',
    '/distribution/public/pricing/models',
    null,
    signal,
  );
  return Array.isArray(resp.data) ? resp.data : [];
};

// =============================================================================
// 商品化总规划 P4 §-1.2.B — csign 电子认证 SKU
// =============================================================================

Client.prototype.listComplianceSkus = async function (
  this: Client,
  region?: string,
  signal?: AbortSignal,
): Promise<ComplianceSku[]> {
  const query = region ? `?region=${encodeURIComponent(region)}` : '';
  const resp = await this.doJSON<APIResponse<ComplianceSku[]>>(
    'GET',
    `/distribution/public/compliance/skus${query}`,
    null,
    signal,
  );
  return Array.isArray(resp.data) ? resp.data : [];
};

Client.prototype.quoteCompliance = async function (
  this: Client,
  skuCode: string,
  quantity?: number,
  region?: string,
  signal?: AbortSignal,
): Promise<ComplianceQuoteResponse> {
  if (!skuCode) {
    throw new Error('quoteCompliance: skuCode is required');
  }
  const params: string[] = [`skuCode=${encodeURIComponent(skuCode)}`];
  if (quantity != null) params.push(`quantity=${quantity}`);
  if (region) params.push(`region=${encodeURIComponent(region)}`);
  const resp = await this.doJSON<APIResponse<ComplianceQuoteResponse>>(
    'GET',
    `/distribution/public/compliance/quote?${params.join('&')}`,
    null,
    signal,
  );
  return resp.data ?? { skuCode, available: false };
};
