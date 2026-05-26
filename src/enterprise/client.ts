// enterprise/client.ts — 企业席位 (P6a) namespace API (商品化总规划 2026-05-25).
//
// 端点路径形如 `/api/admin/enterprises/...` (后台管理) 或 `/me/enterprises/...` (登录态).
// P6a 阶段 SDK 暴露 namespace; 真正的网关反代由后续 wave 在 nexus-v4 网关层路由白名单中开放.

import type { APIResponse } from '../shared/api-response';
import type {
  EnterpriseSummary,
  EnterpriseMember,
  OrgSubscription,
  OrgSeat,
  InviteMemberRequest,
  AssignSeatRequest,
  OrgConsumeReport,
  EnterpriseKycMyStatusView,
} from './types';
import { Client } from '../core/client';

declare module '@acosmi/sdk-ts' {
  interface Client {
    // =====================================================================
    // 企业组织 (登录态: 我所在的企业)
    // =====================================================================

    /** 列出我所在的企业 (用户作为成员加入的企业列表). */
    listMyEnterprises(signal?: AbortSignal): Promise<EnterpriseSummary[]>;

    /** 获取企业详情. */
    getEnterprise(id: number, signal?: AbortSignal): Promise<EnterpriseSummary>;

    // =====================================================================
    // 成员管理
    // =====================================================================

    /** 邀请成员加入 (P6a 简化: 直接 add, OWNER/ADMIN 可调用). */
    inviteMember(req: InviteMemberRequest, signal?: AbortSignal): Promise<EnterpriseMember>;

    /** 列出企业成员. */
    listEnterpriseMembers(enterpriseId: number, signal?: AbortSignal): Promise<EnterpriseMember[]>;

    // =====================================================================
    // 订阅 + 席位
    // =====================================================================

    /** 列出企业订阅. */
    listOrgSubscriptions(enterpriseId: number, signal?: AbortSignal): Promise<OrgSubscription[]>;

    /** 列出订阅下的席位 (1 订阅 N 席, seat_no 1..N). */
    listSeats(orgSubscriptionId: number, signal?: AbortSignal): Promise<OrgSeat[]>;

    /** 分配席位 (月度变更次数 +1, 超 3 次返 41xxx 业务码 §-1.2.D 钉死). */
    assignSeat(req: AssignSeatRequest, signal?: AbortSignal): Promise<OrgSeat>;

    /** 收回席位 (席位状态 → AVAILABLE, 累计用量保留). */
    revokeSeat(seatId: number, note?: string, signal?: AbortSignal): Promise<void>;

    // =====================================================================
    // 用量报表
    // =====================================================================

    /** 企业消耗汇总 (订阅维度池子合计; 完整账单留 P6b). */
    getOrgConsumeReport(enterpriseId: number, signal?: AbortSignal): Promise<OrgConsumeReport>;

    // =====================================================================
    // KYC 自查 (v2.0.0+, P6a Phase 3 复核)
    // =====================================================================

    /**
     * 企业 OWNER 自查 KYC 状态 — 返回登录用户作为 OWNER 的企业的最新 KYC 状态.
     * 用户不是任何企业 OWNER 时返 `{enterpriseId:undefined}` 的空 view, 不抛.
     *
     * v2.0.0+ 新增. 端点 `GET /api/distribution/enterprise/kyc/my`.
     * 单 OWNER 单企业假设; 多企业取第一个 ACTIVE OWNER 企业.
     */
    getMyEnterpriseKycStatus(signal?: AbortSignal): Promise<EnterpriseKycMyStatusView>;
  }
}

// =====================================================================
// 实现 (HTTP 路径以 tk-dist admin / me 端点对齐)
// =====================================================================

Client.prototype.listMyEnterprises = async function (
  this: Client,
  signal?: AbortSignal,
): Promise<EnterpriseSummary[]> {
  const resp = await this.doJSON<APIResponse<EnterpriseSummary[]>>(
    'GET',
    `/me/enterprises`,
    null,
    signal,
  );
  return resp.data ?? [];
};

Client.prototype.getEnterprise = async function (
  this: Client,
  id: number,
  signal?: AbortSignal,
): Promise<EnterpriseSummary> {
  const resp = await this.doJSON<APIResponse<EnterpriseSummary>>(
    'GET',
    `/api/admin/enterprises/${id}`,
    null,
    signal,
  );
  if (!resp.data) throw new Error(`enterprise ${id} not found`);
  return resp.data;
};

Client.prototype.inviteMember = async function (
  this: Client,
  req: InviteMemberRequest,
  signal?: AbortSignal,
): Promise<EnterpriseMember> {
  const resp = await this.doJSON<APIResponse<EnterpriseMember>>(
    'POST',
    `/api/admin/enterprise-members`,
    req,
    signal,
  );
  if (!resp.data) throw new Error('invite member failed');
  return resp.data;
};

Client.prototype.listEnterpriseMembers = async function (
  this: Client,
  enterpriseId: number,
  signal?: AbortSignal,
): Promise<EnterpriseMember[]> {
  const resp = await this.doJSON<APIResponse<EnterpriseMember[]>>(
    'GET',
    `/api/admin/enterprise-members/by-enterprise/${enterpriseId}`,
    null,
    signal,
  );
  return resp.data ?? [];
};

Client.prototype.listOrgSubscriptions = async function (
  this: Client,
  enterpriseId: number,
  signal?: AbortSignal,
): Promise<OrgSubscription[]> {
  const resp = await this.doJSON<APIResponse<OrgSubscription[]>>(
    'GET',
    `/api/admin/org-subscriptions/by-enterprise/${enterpriseId}`,
    null,
    signal,
  );
  return resp.data ?? [];
};

Client.prototype.listSeats = async function (
  this: Client,
  orgSubscriptionId: number,
  signal?: AbortSignal,
): Promise<OrgSeat[]> {
  const resp = await this.doJSON<APIResponse<OrgSeat[]>>(
    'GET',
    `/api/admin/org-seats/by-subscription/${orgSubscriptionId}`,
    null,
    signal,
  );
  return resp.data ?? [];
};

Client.prototype.assignSeat = async function (
  this: Client,
  req: AssignSeatRequest,
  signal?: AbortSignal,
): Promise<OrgSeat> {
  const resp = await this.doJSON<APIResponse<OrgSeat>>(
    'POST',
    `/api/admin/org-seats/assign`,
    req,
    signal,
  );
  if (!resp.data) throw new Error('assign seat failed');
  return resp.data;
};

Client.prototype.revokeSeat = async function (
  this: Client,
  seatId: number,
  note?: string,
  signal?: AbortSignal,
): Promise<void> {
  const qs = note ? `?note=${encodeURIComponent(note)}` : '';
  await this.doJSON<APIResponse<boolean>>(
    'POST',
    `/api/admin/org-seats/${seatId}/revoke${qs}`,
    null,
    signal,
  );
};

Client.prototype.getOrgConsumeReport = async function (
  this: Client,
  enterpriseId: number,
  signal?: AbortSignal,
): Promise<OrgConsumeReport> {
  const resp = await this.doJSON<APIResponse<OrgConsumeReport>>(
    'GET',
    `/api/admin/enterprise-settlements/overview/${enterpriseId}`,
    null,
    signal,
  );
  if (!resp.data) {
    return {
      enterpriseId,
      subscriptionCount: 0,
      totalPoolTk: 0,
      totalUsedTk: 0,
      totalPriceFen: 0,
    };
  }
  return resp.data;
};

// =====================================================================
// KYC 自查 (v2.0.0+, P6a Phase 3 复核)
// =====================================================================

Client.prototype.getMyEnterpriseKycStatus = async function (
  this: Client,
  signal?: AbortSignal,
): Promise<EnterpriseKycMyStatusView> {
  const resp = await this.doJSON<APIResponse<EnterpriseKycMyStatusView>>(
    'GET',
    `/api/distribution/enterprise/kyc/my`,
    null,
    signal,
  );
  return resp.data ?? {};
};
