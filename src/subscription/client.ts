// subscription/client.ts — 商品化总规划 P1 订阅域 API 调用 (declaration merging Client).
//
// 端点对应 tk-dist `/api/distribution/public/pricing/plans`,
// 通过 Go 网关 `/api/v4/distribution/public/pricing/plans` 反向代理 (P3 商品中心接入时落地).
// P1 阶段 SDK 暴露 namespace, 后端代理路由 P3 子窗口补.

import type { APIResponse } from '../shared/api-response';
import type { SubscriptionAudience, SubscriptionPlan, UserSubscription } from './types';
import { Client } from '../core/client';

declare module '@acosmi/sdk-ts' {
  interface Client {
    /** 列出当前可售订阅计划; audience='PERSONAL'|'ENTERPRISE' 可选过滤 */
    listPlans(
      audience?: SubscriptionAudience,
      signal?: AbortSignal,
    ): Promise<SubscriptionPlan[]>;

    /** 列出当前用户已激活订阅 (跨档位; 通常 1 条 active) */
    listUserSubscriptions(signal?: AbortSignal): Promise<UserSubscription[]>;

    /**
     * 按 planCode 精确取单个可售订阅计划 (V41 起 planCode 在 active 内唯一)。
     * 复用 listPlans 客户端过滤, 未命中返回 null。减少 C 端按字段手筛 (deep-review §12.3)。
     */
    getPlanByCode(planCode: string, signal?: AbortSignal): Promise<SubscriptionPlan | null>;
  }
}

Client.prototype.listPlans = async function (
  this: Client,
  audience?: SubscriptionAudience,
  signal?: AbortSignal,
): Promise<SubscriptionPlan[]> {
  const query = audience ? `?audience=${encodeURIComponent(audience)}` : '';
  const resp = await this.doJSON<APIResponse<SubscriptionPlan[]>>(
    'GET',
    `/distribution/public/pricing/plans${query}`,
    null,
    signal,
  );
  return Array.isArray(resp.data) ? resp.data : [];
};

Client.prototype.listUserSubscriptions = async function (
  this: Client,
  signal?: AbortSignal,
): Promise<UserSubscription[]> {
  const resp = await this.doJSON<APIResponse<UserSubscription[]>>(
    'GET',
    '/distribution/user/subscriptions',
    null,
    signal,
  );
  return Array.isArray(resp.data) ? resp.data : [];
};

Client.prototype.getPlanByCode = async function (
  this: Client,
  planCode: string,
  signal?: AbortSignal,
): Promise<SubscriptionPlan | null> {
  if (!planCode) return null;
  const plans = await this.listPlans(undefined, signal);
  return plans.find((p) => p.planCode === planCode) ?? null;
};
