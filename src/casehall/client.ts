// casehall/client.ts — 法律案件咨询 namespace API (商品化总规划 P5 方案 B 2026-05-25).
//
// 端点路径形如 `/casehall/app/...` (C 端公开) 或 `/casehall/me/...` (登录态).
// P5 阶段 SDK 暴露 namespace; 真正的网关反代与登录态校验由后续窗口在
// nexus-v4 网关层路由白名单中开放。
//
// admin 板块 9 模块 (`/casehall/admin/...`) 不在 SDK 边界, 仅 admin UI 直连。

import type { APIResponse } from '../shared/api-response';
import type {
  LawyerSummary,
  SubmitCaseLeadRequest,
  CaseLead,
  CaseMatter,
  LegalConsultation,
  BookConsultationRequest,
  LegalServiceOrder,
  LegalServiceSku,
} from './types';
import { Client } from '../core/client';

declare module '@acosmi/sdk-ts' {
  interface Client {
    // =========================================================================
    // 律师库 (C 端公开)
    // =========================================================================

    /** 列出已认证律师 (公开端点, 仅返回 VERIFIED + ACTIVE 状态; PII L3 字段已脱敏). */
    listLawyers(
      params?: { practiceArea?: string; location?: string; pageNo?: number; pageSize?: number },
      signal?: AbortSignal,
    ): Promise<LawyerSummary[]>;

    /** 获取律师公开详情 (脱敏)。 */
    getLawyer(id: number, signal?: AbortSignal): Promise<LawyerSummary>;

    // =========================================================================
    // 案件线索 (C 端登录态)
    // =========================================================================

    /** 提交案件线索 (登录态)。 */
    submitCaseLead(req: SubmitCaseLeadRequest, signal?: AbortSignal): Promise<{ id: number }>;

    /** 我的案件线索列表。 */
    listMyCaseLeads(signal?: AbortSignal): Promise<CaseLead[]>;

    /** 我的案件列表 (委托后)。 */
    getMyCases(signal?: AbortSignal): Promise<CaseMatter[]>;

    // =========================================================================
    // 法律咨询
    // =========================================================================

    /** 预约法律咨询 (skuCode 必填; lawyerId 可选, 留空走 AI 推荐池)。 */
    bookConsultation(req: BookConsultationRequest, signal?: AbortSignal): Promise<{ consultationId: number }>;

    /** 我的咨询单列表。 */
    listMyConsultations(signal?: AbortSignal): Promise<LegalConsultation[]>;

    // =========================================================================
    // 法律服务订单 & SKU
    // =========================================================================

    /** 我的法律服务订单列表。 */
    listMyLegalOrders(signal?: AbortSignal): Promise<LegalServiceOrder[]>;

    /** 列出公开的 LEGAL_SERVICE SKU (匿名可调用, 复用 dist_compliance_sku benefit_type='LEGAL_SERVICE')。 */
    listLegalSKUs(region?: string, signal?: AbortSignal): Promise<LegalServiceSku[]>;
  }
}

// --- Lawyer ---

Client.prototype.listLawyers = async function (
  this: Client,
  params?: { practiceArea?: string; location?: string; pageNo?: number; pageSize?: number },
  signal?: AbortSignal,
): Promise<LawyerSummary[]> {
  const qs = new URLSearchParams();
  if (params?.practiceArea) qs.set('practiceArea', params.practiceArea);
  if (params?.location) qs.set('location', params.location);
  if (params?.pageNo != null) qs.set('pageNo', String(params.pageNo));
  if (params?.pageSize != null) qs.set('pageSize', String(params.pageSize));
  const q = qs.toString() ? `?${qs.toString()}` : '';
  const resp = await this.doJSON<APIResponse<LawyerSummary[]>>(
    'GET',
    `/casehall/app/lawyers${q}`,
    null,
    signal,
  );
  return resp.data ?? [];
};

Client.prototype.getLawyer = async function (
  this: Client,
  id: number,
  signal?: AbortSignal,
): Promise<LawyerSummary> {
  const resp = await this.doJSON<APIResponse<LawyerSummary>>(
    'GET',
    `/casehall/app/lawyers/${id}`,
    null,
    signal,
  );
  if (!resp.data) throw new Error(`lawyer ${id} not found`);
  return resp.data;
};

// --- Case Lead ---

Client.prototype.submitCaseLead = async function (
  this: Client,
  req: SubmitCaseLeadRequest,
  signal?: AbortSignal,
): Promise<{ id: number }> {
  const resp = await this.doJSON<APIResponse<{ id: number }>>(
    'POST',
    `/casehall/me/case-leads`,
    req,
    signal,
  );
  return resp.data ?? { id: 0 };
};

Client.prototype.listMyCaseLeads = async function (
  this: Client,
  signal?: AbortSignal,
): Promise<CaseLead[]> {
  const resp = await this.doJSON<APIResponse<CaseLead[]>>(
    'GET',
    `/casehall/me/case-leads`,
    null,
    signal,
  );
  return resp.data ?? [];
};

Client.prototype.getMyCases = async function (
  this: Client,
  signal?: AbortSignal,
): Promise<CaseMatter[]> {
  const resp = await this.doJSON<APIResponse<CaseMatter[]>>(
    'GET',
    `/casehall/me/cases`,
    null,
    signal,
  );
  return resp.data ?? [];
};

// --- Consultation ---

Client.prototype.bookConsultation = async function (
  this: Client,
  req: BookConsultationRequest,
  signal?: AbortSignal,
): Promise<{ consultationId: number }> {
  const resp = await this.doJSON<APIResponse<{ consultationId: number }>>(
    'POST',
    `/casehall/me/consultations`,
    req,
    signal,
  );
  return resp.data ?? { consultationId: 0 };
};

Client.prototype.listMyConsultations = async function (
  this: Client,
  signal?: AbortSignal,
): Promise<LegalConsultation[]> {
  const resp = await this.doJSON<APIResponse<LegalConsultation[]>>(
    'GET',
    `/casehall/me/consultations`,
    null,
    signal,
  );
  return resp.data ?? [];
};

// --- Order & SKU ---

Client.prototype.listMyLegalOrders = async function (
  this: Client,
  signal?: AbortSignal,
): Promise<LegalServiceOrder[]> {
  const resp = await this.doJSON<APIResponse<LegalServiceOrder[]>>(
    'GET',
    `/casehall/me/orders`,
    null,
    signal,
  );
  return resp.data ?? [];
};

Client.prototype.listLegalSKUs = async function (
  this: Client,
  region?: string,
  signal?: AbortSignal,
): Promise<LegalServiceSku[]> {
  const q = region ? `?region=${encodeURIComponent(region)}&benefitType=LEGAL_SERVICE` : `?benefitType=LEGAL_SERVICE`;
  const resp = await this.doJSON<APIResponse<LegalServiceSku[]>>(
    'GET',
    `/casehall/app/legal-skus${q}`,
    null,
    signal,
  );
  return resp.data ?? [];
};
