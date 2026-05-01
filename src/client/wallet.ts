// client/wallet.ts — 端口自 acosmi-sdk-go/client.go (Wallet section)

import type { APIResponse, Transaction, WalletStats } from '../types';
import { Client } from '../client';

declare module '../client' {
  interface Client {
    /** 获取钱包统计 (余额/月消费/月充值) */
    getWalletStats(signal?: AbortSignal): Promise<WalletStats>;
    /** 获取最近交易记录 */
    getWalletTransactions(signal?: AbortSignal): Promise<Transaction[]>;
  }
}

Client.prototype.getWalletStats = async function (this: Client, signal?: AbortSignal) {
  const resp = await this.doJSON<APIResponse<WalletStats>>('GET', '/wallet/stats', null, signal);
  return resp.data;
};

Client.prototype.getWalletTransactions = async function (this: Client, signal?: AbortSignal) {
  const resp = await this.doJSON<APIResponse<Transaction[]>>(
    'GET',
    '/wallet/transactions',
    null,
    signal,
  );
  return resp.data;
};
