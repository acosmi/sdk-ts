// products/client.ts — 公开商品 API (商品化总规划 P3 §3.2).
//
// 端点: tk-dist `/api/distribution/public/products/{by-family,by-slug}` (经 Go 反代).
// 字段白名单与 controller/app/product/AppPublicProductController#toPublicResponse 同源.

import type { APIResponse } from '../shared/api-response';
import type { Product, ProductFamily, Audience, RegionScope } from './types';
import { Client } from '../core/client';

declare module '@acosmi/sdk-ts' {
  interface Client {
    /**
     * 按商品族查询在售商品. 全参可空 (后端无过滤即返全部在售).
     * @param family   商品族 (MODEL_MEMBERSHIP / TOKEN_PACK / ...)
     * @param audience 受众 (PERSONAL / ENTERPRISE / DEVELOPER)
     * @param region   区域 (CN / OS / GLOBAL); 命中时同时返回 GLOBAL 商品
     */
    listProductsByFamily(
      family?: ProductFamily,
      audience?: Audience,
      region?: RegionScope,
      signal?: AbortSignal,
    ): Promise<Product[]>;

    /**
     * 按 slug 查询单个在售商品. slug = biz_product_id (UNIQUE).
     * 找不到或已下架 → 抛 HTTP 404.
     */
    getProductBySlug(
      slug: string,
      region?: RegionScope,
      signal?: AbortSignal,
    ): Promise<Product>;
  }
}

Client.prototype.listProductsByFamily = async function (
  this: Client,
  family?: ProductFamily,
  audience?: Audience,
  region?: RegionScope,
  signal?: AbortSignal,
): Promise<Product[]> {
  const params: string[] = [];
  if (family) params.push(`family=${encodeURIComponent(family)}`);
  if (audience) params.push(`audience=${encodeURIComponent(audience)}`);
  if (region) params.push(`region=${encodeURIComponent(region)}`);
  const query = params.length > 0 ? `?${params.join('&')}` : '';
  const resp = await this.doJSON<APIResponse<Product[]>>(
    'GET',
    `/distribution/public/products/by-family${query}`,
    null,
    signal,
  );
  return Array.isArray(resp.data) ? resp.data : [];
};

Client.prototype.getProductBySlug = async function (
  this: Client,
  slug: string,
  region?: RegionScope,
  signal?: AbortSignal,
): Promise<Product> {
  if (!slug) {
    throw new Error('getProductBySlug: slug is required');
  }
  const query = region ? `?region=${encodeURIComponent(region)}` : '';
  const resp = await this.doJSON<APIResponse<Product>>(
    'GET',
    `/distribution/public/products/by-slug/${encodeURIComponent(slug)}${query}`,
    null,
    signal,
  );
  if (!resp.data) {
    throw new Error(`getProductBySlug: product not found (slug=${slug})`);
  }
  return resp.data;
};
