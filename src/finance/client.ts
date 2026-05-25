// finance/client.ts — 财务 (P7) namespace API (商品化总规划 2026-05-25).
//
// 决策 14 对公转账: 弹窗 + 企微对接销售/财务, 零银行 API.
// 决策 15 退款规则: 订阅不退 / token 包 7 天未用全额 / 服务交付后不退.
//
// 端点路径形如 /api/distribution/finance/*. admin 板块 (审批/财务工作台) 由 admin UI
// 直连 /api/admin/finance/**, 不在 SDK 边界.

import type { APIResponse } from '../shared/api-response';
import type {
  Invoice,
  RequestInvoiceInput,
  RefundRecord,
  RequestRefundInput,
  CorporateTransfer,
  InitiateCorporateTransferInput,
  InitiateCorporateTransferResult,
} from './types';
import { Client } from '../core/client';

declare module '@acosmi/sdk-ts' {
  interface Client {
    // ========================================================================
    // 退款 (决策 15)
    // ========================================================================

    /** 申请退款 (决策 15: 按 policyCode 自动判定; NO_REFUND 即时拒)。 */
    requestRefund(req: RequestRefundInput, signal?: AbortSignal): Promise<RefundRecord>;

    /** 我的退款记录。 */
    listMyRefunds(signal?: AbortSignal): Promise<RefundRecord[]>;

    // ========================================================================
    // 发票
    // ========================================================================

    /** 申请开票。 */
    requestInvoice(req: RequestInvoiceInput, signal?: AbortSignal): Promise<Invoice>;

    /** 我的发票列表。 */
    listMyInvoices(signal?: AbortSignal): Promise<Invoice[]>;

    // ========================================================================
    // 对公转账 (决策 14: 弹窗 + 企微对接)
    // ========================================================================

    /**
     * 发起对公转账 — 决策 14:
     * 服务端创建 INITIATED 记录, 返回销售名片二维码 + 销售企微 ID + 财务邮箱,
     * 前端据此渲染弹窗引导用户加销售企微, 零银行 API.
     */
    initiateCorporateTransfer(
      req: InitiateCorporateTransferInput,
      signal?: AbortSignal,
    ): Promise<InitiateCorporateTransferResult>;

    /** 上传对公转账凭证 URL。 */
    uploadCorporateTransferProof(
      id: number,
      proofUrl: string,
      signal?: AbortSignal,
    ): Promise<boolean>;

    /** 我的对公转账记录。 */
    listMyCorporateTransfers(signal?: AbortSignal): Promise<CorporateTransfer[]>;
  }
}

// --- Refund ---

Client.prototype.requestRefund = async function (
  this: Client,
  req: RequestRefundInput,
  signal?: AbortSignal,
): Promise<RefundRecord> {
  const resp = await this.doJSON<APIResponse<RefundRecord>>(
    'POST',
    `/api/distribution/finance/refund/request`,
    req,
    signal,
  );
  if (!resp.data) throw new Error('refund/request: empty response');
  return resp.data;
};

Client.prototype.listMyRefunds = async function (
  this: Client,
  signal?: AbortSignal,
): Promise<RefundRecord[]> {
  const resp = await this.doJSON<APIResponse<RefundRecord[]>>(
    'GET',
    `/api/distribution/finance/refund/my`,
    null,
    signal,
  );
  return resp.data ?? [];
};

// --- Invoice ---

Client.prototype.requestInvoice = async function (
  this: Client,
  req: RequestInvoiceInput,
  signal?: AbortSignal,
): Promise<Invoice> {
  const resp = await this.doJSON<APIResponse<Invoice>>(
    'POST',
    `/api/distribution/finance/invoice/request`,
    req,
    signal,
  );
  if (!resp.data) throw new Error('invoice/request: empty response');
  return resp.data;
};

Client.prototype.listMyInvoices = async function (
  this: Client,
  signal?: AbortSignal,
): Promise<Invoice[]> {
  const resp = await this.doJSON<APIResponse<Invoice[]>>(
    'GET',
    `/api/distribution/finance/invoice/my`,
    null,
    signal,
  );
  return resp.data ?? [];
};

// --- Corporate Transfer (决策 14) ---

Client.prototype.initiateCorporateTransfer = async function (
  this: Client,
  req: InitiateCorporateTransferInput,
  signal?: AbortSignal,
): Promise<InitiateCorporateTransferResult> {
  const resp = await this.doJSON<APIResponse<InitiateCorporateTransferResult>>(
    'POST',
    `/api/distribution/finance/corporate-transfer/initiate`,
    req,
    signal,
  );
  if (!resp.data) throw new Error('corporate-transfer/initiate: empty response');
  return resp.data;
};

Client.prototype.uploadCorporateTransferProof = async function (
  this: Client,
  id: number,
  proofUrl: string,
  signal?: AbortSignal,
): Promise<boolean> {
  // P2-017: 后端契约是 @RequestParam("proofUrl"), 走 query (非 body).
  // URLSearchParams 自动 URI-encode, 但与 path 拼接需注意: path 不可含 '?'.
  // 改为 encodeURIComponent 直拼, 等价但 0 依赖 URLSearchParams 行为, 更鲁棒.
  const path =
    `/api/distribution/finance/corporate-transfer/${encodeURIComponent(String(id))}/upload-proof`
    + `?proofUrl=${encodeURIComponent(proofUrl)}`;
  const resp = await this.doJSON<APIResponse<boolean>>('POST', path, null, signal);
  return resp.data ?? false;
};

Client.prototype.listMyCorporateTransfers = async function (
  this: Client,
  signal?: AbortSignal,
): Promise<CorporateTransfer[]> {
  const resp = await this.doJSON<APIResponse<CorporateTransfer[]>>(
    'GET',
    `/api/distribution/finance/corporate-transfer/my`,
    null,
    signal,
  );
  return resp.data ?? [];
};
