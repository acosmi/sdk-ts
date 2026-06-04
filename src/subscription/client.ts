// subscription/client.ts — 商品化总规划 P1 订阅域 API 调用 (declaration merging Client).
//
// 端点对应 tk-dist `/api/distribution/public/pricing/plans`,
// 通过 Go 网关 `/api/v4/distribution/public/pricing/plans` 反向代理 (P3 商品中心接入时落地).
// P1 阶段 SDK 暴露 namespace, 后端代理路由 P3 子窗口补.
//
// 当前订阅的规范入口是网关 GET /entitlements/membership (getMembership) —— C 端会员中心订阅概览。
// 旧的 /distribution/user/subscriptions 路径网关从未暴露 (恒 404), 已移除; listUserSubscriptions 现委托 getMembership。

import type { APIResponse } from '../shared/api-response';
import type {
  Membership,
  SubscriptionAudience,
  SubscriptionPlan,
  SubscriptionTier,
} from './types';
import { Client } from '../core/client';

declare module '@acosmi/sdk-ts' {
  interface Client {
    /** 列出当前可售订阅计划; audience='PERSONAL'|'ENTERPRISE' 可选过滤 */
    listPlans(
      audience?: SubscriptionAudience,
      signal?: AbortSignal,
    ): Promise<SubscriptionPlan[]>;

    /** 查询当前用户会员/订阅概览 (C 端会员中心)。无活跃订阅时 hasActive=false/isFree=true。 */
    getMembership(signal?: AbortSignal): Promise<Membership>;

    /** 由活跃权益推导订阅层级 (free/pro)。 */
    getSubscriptionTier(signal?: AbortSignal): Promise<SubscriptionTier>;

    /** 订阅支付前绑定硬闸。返回 {ok:true} 表示已绑定手机/邮箱可放行支付。
     *  未绑定时网关返回 HTTP 403 + 业务码 41001 (doJSON 抛 HTTPError), 调用方应据此引导用户先绑定联系方式再支付。 */
    subscriptionPrecheck(signal?: AbortSignal): Promise<{ ok: boolean }>;

    /** @deprecated 网关无订阅列表端点; 旧实现打 /distribution/user/subscriptions 恒 404。改用 getMembership()。
     *  本方法现委托 getMembership(): 有活跃订阅返回单元素数组, 否则空数组。 */
    listUserSubscriptions(signal?: AbortSignal): Promise<Membership[]>;

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

Client.prototype.getMembership = async function (
  this: Client,
  signal?: AbortSignal,
): Promise<Membership> {
  const resp = await this.doJSON<APIResponse<Membership>>(
    'GET',
    '/entitlements/membership',
    null,
    signal,
  );
  return resp.data;
};

Client.prototype.getSubscriptionTier = async function (
  this: Client,
  signal?: AbortSignal,
): Promise<SubscriptionTier> {
  const resp = await this.doJSON<APIResponse<SubscriptionTier>>(
    'GET',
    '/entitlements/subscription',
    null,
    signal,
  );
  return resp.data;
};

Client.prototype.subscriptionPrecheck = async function (
  this: Client,
  signal?: AbortSignal,
): Promise<{ ok: boolean }> {
  const resp = await this.doJSON<APIResponse<{ ok: boolean }>>(
    'GET',
    '/consumer/subscriptions/precheck',
    null,
    signal,
  );
  return resp.data;
};

Client.prototype.listUserSubscriptions = async function (
  this: Client,
  signal?: AbortSignal,
): Promise<Membership[]> {
  const m = await this.getMembership(signal);
  return m.hasActive ? [m] : [];
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
