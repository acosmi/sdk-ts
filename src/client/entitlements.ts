// client/entitlements.ts — 端口自 acosmi-sdk-go/client.go (Entitlements + V29 Per-Model Bucket section)
//
// declaration merging 扩展 Client class.

import type {
  APIResponse,
  BalanceDetail,
  ConsumeRecordPage,
  EntitlementBalance,
  EntitlementItem,
  ModelBucket,
  ModelByQuotaResponse,
  ModelCoefficient,
} from '../types';
import { Client } from '../client';
import { coefCacheTTLMs } from '../client-helpers';

declare module '@acosmi/sdk-ts' {
  interface Client {
    /** 查询当前用户的权益余额 (聚合) */
    getBalance(signal?: AbortSignal): Promise<EntitlementBalance>;
    /** 查询详细余额 (含每条权益明细) */
    getBalanceDetail(signal?: AbortSignal): Promise<BalanceDetail>;
    /** 查询当前用户权益列表; status: "ACTIVE" / "EXPIRED" / "" (全部) */
    listEntitlements(status: string, signal?: AbortSignal): Promise<EntitlementItem[]>;
    /** 查询核销记录 (分页) */
    listConsumeRecords(page: number, pageSize: number, signal?: AbortSignal): Promise<ConsumeRecordPage>;
    /** 领取当月免费额度 — 幂等: 已领取时返回已有权益 */
    claimMonthlyFree(signal?: AbortSignal): Promise<EntitlementItem>;
    /** 查询当前用户在指定模型下的剩余 token (raw + ETU) */
    getByModel(modelID: string, signal?: AbortSignal): Promise<ModelByQuotaResponse>;
    /** 列出当前用户的全部桶 */
    listBuckets(signal?: AbortSignal): Promise<ModelBucket[]>;
    /** 拉取模型系数表; SDK 自带 8s TTL 内存缓存以减小调用风暴. */
    listCoefficients(signal?: AbortSignal): Promise<ModelCoefficient[]>;
    /** 手动失效系数缓存 (admin 调价后建议立即调一次) */
    invalidateCoefficientCache(): void;
  }
}

Client.prototype.getBalance = async function (this: Client, signal?: AbortSignal) {
  const resp = await this.doJSON<APIResponse<EntitlementBalance>>(
    'GET',
    '/entitlements/balance',
    null,
    signal,
  );
  return resp.data;
};

Client.prototype.getBalanceDetail = async function (this: Client, signal?: AbortSignal) {
  const resp = await this.doJSON<APIResponse<BalanceDetail>>(
    'GET',
    '/entitlements/balance-detail',
    null,
    signal,
  );
  return resp.data;
};

Client.prototype.listEntitlements = async function (this: Client, status: string, signal?: AbortSignal) {
  let path = '/entitlements';
  if (status !== '') {
    path += `?status=${encodeURIComponent(status)}`;
  }
  const resp = await this.doJSON<APIResponse<EntitlementItem[]>>('GET', path, null, signal);
  return resp.data;
};

Client.prototype.listConsumeRecords = async function (
  this: Client,
  page: number,
  pageSize: number,
  signal?: AbortSignal,
) {
  const path = `/entitlements/consume-records?page=${page}&pageSize=${pageSize}`;
  const resp = await this.doJSON<APIResponse<ConsumeRecordPage>>('GET', path, null, signal);
  return resp.data;
};

Client.prototype.claimMonthlyFree = async function (this: Client, signal?: AbortSignal) {
  const resp = await this.doJSON<APIResponse<EntitlementItem>>(
    'POST',
    '/entitlements/claim-monthly',
    null,
    signal,
  );
  return resp.data;
};

Client.prototype.getByModel = async function (this: Client, modelID: string, signal?: AbortSignal) {
  if (modelID === '') throw new Error('modelID required');
  const path = `/entitlements/by-model?modelId=${encodeURIComponent(modelID)}`;
  const resp = await this.doJSON<APIResponse<ModelByQuotaResponse>>('GET', path, null, signal);
  return resp.data;
};

Client.prototype.listBuckets = async function (this: Client, signal?: AbortSignal) {
  const resp = await this.doJSON<APIResponse<ModelBucket[]>>(
    'GET',
    '/entitlements/buckets',
    null,
    signal,
  );
  return resp.data;
};

Client.prototype.listCoefficients = async function (this: Client, signal?: AbortSignal) {
  // 简单内存缓存 + TTL (8s)
  if (this.coefCacheData && Date.now() - this.coefCacheTimeMs < coefCacheTTLMs) {
    return [...this.coefCacheData]; // shallow copy 防外部篡改
  }
  const resp = await this.doJSON<APIResponse<ModelCoefficient[]>>(
    'GET',
    '/entitlements/coefficients',
    null,
    signal,
  );
  this.coefCacheData = [...resp.data];
  this.coefCacheTimeMs = Date.now();
  return resp.data;
};

Client.prototype.invalidateCoefficientCache = function (this: Client) {
  this.coefCacheData = null;
  this.coefCacheTimeMs = 0;
};
