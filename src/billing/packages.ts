// client/packages.ts — 端口自 acosmi-sdk-go/client.go (Token Packages / 商城 section)

import type { APIResponse, YudaoPageResult } from '../shared/api-response';
import type {
  BuyResponse,
  OrderListItem,
  PayPayload,
  TokenPackage,
} from './types';
import { OrderTerminalError } from '../shared/errors';
import { Client } from '../core/client';
import { isOrderSuccess, isOrderTerminal } from '../core/http';

declare module '@acosmi/sdk-ts' {
  interface Client {
    /** 获取商城流量包列表 (兼容 yudao 分页和直接数组两种格式) */
    listTokenPackages(signal?: AbortSignal): Promise<TokenPackage[]>;
    /** 获取流量包详情 */
    getTokenPackageDetail(packageID: string, signal?: AbortSignal): Promise<TokenPackage>;
    /** 购买流量包 (创建订单) */
    buyTokenPackage(packageID: string, payload: PayPayload | null, signal?: AbortSignal): Promise<BuyResponse>;
    /** 查询订单支付状态 */
    getOrderStatus(orderID: string, signal?: AbortSignal): Promise<BuyResponse>;
    /** 查询我的订单列表 */
    listMyOrders(signal?: AbortSignal): Promise<OrderListItem[]>;
    /**
     * 轮询订单支付状态直到终态
     * 成功支付返回 BuyResponse; 终态失败抛 OrderTerminalError
     * 终态判定基于 paymentStatus (回退 orderStatus)
     * pollIntervalMs <= 0 时默认 2 秒
     */
    waitForPayment(orderID: string, pollIntervalMs: number, signal?: AbortSignal): Promise<BuyResponse>;
  }
}

Client.prototype.listTokenPackages = async function (this: Client, signal?: AbortSignal) {
  const raw = await this.doJSON<APIResponse<unknown>>('GET', '/token-packages', null, signal);
  // 尝试 yudao 分页格式
  if (raw.data && typeof raw.data === 'object' && 'list' in raw.data) {
    const page = raw.data as YudaoPageResult<TokenPackage>;
    if (Array.isArray(page.list)) return page.list;
  }
  // 降级: 直接数组
  if (Array.isArray(raw.data)) return raw.data as TokenPackage[];
  throw new Error('decode token packages: unexpected shape');
};

Client.prototype.getTokenPackageDetail = async function (
  this: Client,
  packageID: string,
  signal?: AbortSignal,
) {
  const resp = await this.doJSON<APIResponse<TokenPackage>>(
    'GET',
    `/token-packages/${encodeURIComponent(packageID)}`,
    null,
    signal,
  );
  return resp.data;
};

Client.prototype.buyTokenPackage = async function (
  this: Client,
  packageID: string,
  payload: PayPayload | null,
  signal?: AbortSignal,
) {
  const body = payload ?? null;
  const resp = await this.doJSON<APIResponse<BuyResponse>>(
    'POST',
    `/token-packages/${encodeURIComponent(packageID)}/buy`,
    body,
    signal,
  );
  return resp.data;
};

Client.prototype.getOrderStatus = async function (
  this: Client,
  orderID: string,
  signal?: AbortSignal,
) {
  const resp = await this.doJSON<APIResponse<BuyResponse>>(
    'GET',
    `/token-packages/orders/${encodeURIComponent(orderID)}/status`,
    null,
    signal,
  );
  return resp.data;
};

Client.prototype.listMyOrders = async function (this: Client, signal?: AbortSignal) {
  const raw = await this.doJSON<APIResponse<unknown>>('GET', '/token-packages/my', null, signal);
  if (raw.data && typeof raw.data === 'object' && 'list' in raw.data) {
    const page = raw.data as YudaoPageResult<OrderListItem>;
    if (Array.isArray(page.list)) return page.list;
  }
  if (Array.isArray(raw.data)) return raw.data as OrderListItem[];
  throw new Error('decode orders: unexpected shape');
};

Client.prototype.waitForPayment = async function (
  this: Client,
  orderID: string,
  pollIntervalMs: number,
  signal?: AbortSignal,
) {
  if (pollIntervalMs <= 0) pollIntervalMs = 2000;
  while (true) {
    const status = await this.getOrderStatus(orderID, signal);
    const st = status.paymentStatus ?? status.orderStatus;
    if (isOrderTerminal(st)) {
      if (isOrderSuccess(st)) return status;
      throw new OrderTerminalError(orderID, st);
    }
    await sleepWithSignal(pollIntervalMs, signal);
  }
};

async function sleepWithSignal(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return;
  if (signal && signal.aborted) throw new Error('aborted');
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => {
      if (signal && abortHandler) signal.removeEventListener('abort', abortHandler);
      resolve();
    }, ms);
    let abortHandler: (() => void) | undefined;
    if (signal) {
      abortHandler = () => {
        clearTimeout(t);
        signal.removeEventListener('abort', abortHandler!);
        reject(new Error('aborted'));
      };
      signal.addEventListener('abort', abortHandler);
    }
  });
}
