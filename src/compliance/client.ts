// compliance/client.ts — Compliance 域 SDK-facing subclient。
//
// 设计原则（严格）：
//   - 走独立 base URL（client.complianceURL(path)），不复用 /api/v4 路径。
//   - GET 认证读走 retryOn401=true（与 agent-runs 同节奏，幂等安全）。
//   - 公开 verify 走 publicRead：无 token 匿名请求，有 token 附带 Authorization 以保留
//     审计上下文；public 端点不应要求认证 → 401 不触发 forceRefresh，也不做 refresh replay。
//   - POST 写操作走专属 helper：发送前 ensureToken 一次确保 token fresh；遇到 401
//     直接抛 HTTPError，不自动重放 — compliance 写接口可能在 provider 侧落幂等写入，
//     SDK 自动重放会导致 provider 重复请求 / 重复扣费风险。
//   - 写操作支持 Idempotency-Key header；调用方应持久化 key，重试 / 恢复时复用。
//   - polling helper 按 verificationStatus / provider request status 分类：UNKNOWN /
//     RETRYING / PENDING 继续轮询；VERIFIED / SUCCESS → 返回；FAILED / LOCAL_VERIFY_FAILED
//     → 抛 typed error；总超时后抛 polling timeout（不自动重发原请求）。
//   - SDK 不传 provider 字段；服务端按配置选择 provider，不再接受调用方指定。

import { Client } from '../core/client';
import type { BusinessError } from '../shared/errors';
import type { APIResponse } from '../shared/api-response';
import { apiResponseBusinessError } from '../shared/api-response';
import {
  maxErrorBodySize,
  parseHTTPErrorWithHeader,
  readLimited,
} from '../core/http';
import type { PageRequest, PageResult } from '../shared/pagination';
import type { CompliancePollOptions, ComplianceWriteOptions } from './types';
import type {
  CreateEvidenceAssetRequest,
  EvidenceAsset,
  EvidenceAssetPageItem,
  EvidencePackage,
  EvidencePackagePageItem,
  ListEvidenceAssetsRequest,
  ListEvidencePackagesRequest,
  PublicEvidenceVerifyResult,
} from './evidence/types';
import type {
  ComplianceTimestampVerificationStatus,
  IssueTimestampRequest,
  ListTimestampsRequest,
  TimestampPageItem,
  TimestampToken,
  TimestampVerifyResult,
  VerifyTimestampRequest,
} from './timestamp/types';
import type {
  ComplianceReport,
  CreateReportRequest,
  ListReportsRequest,
  ReportDownload,
  ReportPageItem,
} from './report/types';
import type {
  CreateH5SigningUrlRequest,
  CreateSigningEnvelopeRequest,
  ListSigningEnvelopesRequest,
  SignEnvelopeRequest,
  SigningEnvelope,
  SigningEnvelopePageItem,
} from './signing/types';
import type {
  ApproveSealApprovalQuery,
  CancelSealApprovalQuery,
  ListSealApprovalsRequest,
  RejectSealApprovalQuery,
  SealApproval,
  SealApprovalPageItem,
  SubmitSealApprovalRequest,
} from './seal-approval/types';
import type {
  ComplianceProviderRequestStatus,
  ProviderRequestStatusView,
} from './provider/types';
import {
  classifyComplianceError,
  isComplianceBusinessError,
  type ComplianceErrorInfo,
} from './errors';

declare module '@acosmi/sdk-ts' {
  interface Client {
    /** SDK-facing 时间章与电子证据 / 合同签署能力。 */
    readonly compliance: ComplianceClient;
  }
}

const cache = new WeakMap<Client, ComplianceClient>();

Object.defineProperty(Client.prototype, 'compliance', {
  configurable: true,
  enumerable: false,
  get(this: Client): ComplianceClient {
    let existing = cache.get(this);
    if (!existing) {
      existing = new ComplianceClient(this);
      cache.set(this, existing);
    }
    return existing;
  },
});

/**
 * compliance 业务方法默认轮询参数。
 */
const DEFAULT_POLL: Required<Omit<CompliancePollOptions, 'signal'>> = {
  timeoutMs: 60_000,
  initialIntervalMs: 1_000,
  maxIntervalMs: 5_000,
  multiplier: 1.5,
};

/**
 * 当 compliance polling 检测到终态失败 / 已过 timeout / step-up 时抛出。
 *
 * 分类逻辑：终态失败优先于 timeout；timeout 不算 retryable，调用方必须用新 idempotency-key
 * 重新发起整条链路。
 */
export class CompliancePollError extends Error {
  readonly kind: 'timeout' | 'terminal_failure' | 'step_up_required' | 'unknown';
  readonly lastInfo?: ComplianceErrorInfo;

  constructor(
    message: string,
    kind: 'timeout' | 'terminal_failure' | 'step_up_required' | 'unknown',
    lastInfo?: ComplianceErrorInfo,
  ) {
    super(message);
    this.name = 'CompliancePollError';
    this.kind = kind;
    this.lastInfo = lastInfo;
  }
}

interface WriteContext {
  idempotencyKey?: string;
  signal?: AbortSignal;
}

export class ComplianceClient {
  constructor(private readonly client: Client) {}

  // =========================================================================
  // Evidence Asset
  // =========================================================================

  /** 创建证据资产（写）。 */
  createEvidenceAsset(
    req: CreateEvidenceAssetRequest,
    opts: ComplianceWriteOptions = {},
  ): Promise<EvidenceAsset> {
    return this.write<EvidenceAsset>(
      'POST',
      '/compliance/evidence/assets',
      req,
      writeCtx(opts),
    );
  }

  /** 读 — 证据资产详情。 */
  getEvidenceAsset(id: number, signal?: AbortSignal): Promise<EvidenceAsset> {
    return this.read<EvidenceAsset>(
      'GET',
      `/compliance/evidence/assets/${encodeURIComponent(id)}`,
      null,
      signal,
    );
  }

  /**
   * 读 — 证据资产分页列表（compliance gateway S1）。
   *
   * 走 GET 读路径（允许 401 单次刷新重放）。返回 yudao `PageResult<T>`
   * （`{ total, list }`）。所有过滤项可选；`createTimeStart` / `createTimeEnd`
   * 由调用方按 `yyyy-MM-dd HH:mm:ss` 提供，SDK 原样透传。
   */
  listEvidenceAssets(
    req: ListEvidenceAssetsRequest = {},
    signal?: AbortSignal,
  ): Promise<PageResult<EvidenceAssetPageItem>> {
    return this.read<PageResult<EvidenceAssetPageItem>>(
      'GET',
      `/compliance/evidence/assets/page${pageQuery(req, ['assetType', 'status', 'createTimeStart', 'createTimeEnd'])}`,
      null,
      signal,
    );
  }

  /**
   * 公开 verify。隐私边界：返回字段不含 PII / 合同原文 / storage / provider raw。
   *
   * 匿名可调用：未 login 时走匿名请求，不会抛 `not authorized, call login() first`。
   * 已 login / 已持有 token 时附带 `Authorization` 以保留审计上下文。public 端点不
   * 应要求认证 — 收到 401 直接抛 HTTPError，不触发 `forceRefresh`，也不做 refresh
   * replay。
   */
  verifyEvidencePublic(
    params: { evidenceNo?: string; publicVerifyCode?: string },
    signal?: AbortSignal,
  ): Promise<PublicEvidenceVerifyResult> {
    const q = new URLSearchParams();
    if (params.evidenceNo) q.set('evidenceNo', params.evidenceNo);
    if (params.publicVerifyCode) q.set('publicVerifyCode', params.publicVerifyCode);
    const qs = q.toString();
    return this.publicRead<PublicEvidenceVerifyResult>(
      'GET',
      `/compliance/evidence/verify${qs ? '?' + qs : ''}`,
      signal,
    );
  }

  // =========================================================================
  // Timestamp
  // =========================================================================

  /** 申请时间章（写）。SDK 永远不传 provider 字段。 */
  issueTimestamp(
    req: IssueTimestampRequest,
    opts: ComplianceWriteOptions = {},
  ): Promise<TimestampToken> {
    return this.write<TimestampToken>('POST', '/compliance/timestamps', req, writeCtx(opts));
  }

  /** 给已有资产申请时间章。SDK 永远不传 provider 字段。 */
  issueTimestampForAsset(
    assetId: number,
    opts: ComplianceWriteOptions = {},
  ): Promise<TimestampToken> {
    return this.write<TimestampToken>(
      'POST',
      `/compliance/evidence/assets/${encodeURIComponent(assetId)}/timestamp`,
      null,
      writeCtx(opts),
    );
  }

  /** 读 — 时间章 token 详情。 */
  getTimestamp(id: number, signal?: AbortSignal): Promise<TimestampToken> {
    return this.read<TimestampToken>(
      'GET',
      `/compliance/timestamps/${encodeURIComponent(id)}`,
      null,
      signal,
    );
  }

  /**
   * 读 — 时间章分页列表（compliance gateway S1）。
   *
   * 走 GET 读路径。返回 yudao `PageResult<T>`。所有过滤项可选；`createTimeStart` /
   * `createTimeEnd` 由调用方按 `yyyy-MM-dd HH:mm:ss` 提供，SDK 原样透传。
   */
  listTimestamps(
    req: ListTimestampsRequest = {},
    signal?: AbortSignal,
  ): Promise<PageResult<TimestampPageItem>> {
    return this.read<PageResult<TimestampPageItem>>(
      'GET',
      `/compliance/timestamps/page${pageQuery(req, ['provider', 'verificationStatus', 'createTimeStart', 'createTimeEnd'])}`,
      null,
      signal,
    );
  }

  /** verify — 本地离线校验已申请的时间章。 */
  verifyTimestamp(
    req: VerifyTimestampRequest,
    opts: ComplianceWriteOptions = {},
  ): Promise<TimestampVerifyResult> {
    return this.write<TimestampVerifyResult>(
      'POST',
      '/compliance/timestamps/verify',
      req,
      writeCtx(opts),
    );
  }

  /**
   * 轮询到 VERIFIED 终态。
   * - VERIFIED → 返回 token；
   * - FAILED / LOCAL_VERIFY_FAILED → 抛 {@link CompliancePollError} kind='terminal_failure'；
   * - UNKNOWN / RETRYING / PENDING → 继续轮询直到 timeout；
   * - timeout → 抛 {@link CompliancePollError} kind='timeout'。
   */
  async waitForTimestampVerified(
    id: number,
    opts: CompliancePollOptions = {},
  ): Promise<TimestampToken> {
    return this.poll<TimestampToken>(
      () => this.getTimestamp(id, opts.signal),
      (t) => classifyTimestamp(t.verificationStatus as ComplianceTimestampVerificationStatus),
      opts,
    );
  }

  // =========================================================================
  // Evidence Package
  // =========================================================================

  /** 构建证据包（写）。 */
  buildEvidencePackage(
    assetId: number,
    timestampTokenId?: number,
    opts: ComplianceWriteOptions = {},
  ): Promise<EvidencePackage> {
    const tsParam = timestampTokenId == null
      ? ''
      : '?timestampTokenId=' + encodeURIComponent(timestampTokenId);
    return this.write<EvidencePackage>(
      'POST',
      `/compliance/evidence/assets/${encodeURIComponent(assetId)}/packages${tsParam}`,
      null,
      writeCtx(opts),
    );
  }

  /**
   * 读 — 证据包分页列表（compliance gateway S1）。
   *
   * 走 GET 读路径。返回 yudao `PageResult<T>`。所有过滤项可选；`createTimeStart` /
   * `createTimeEnd` 由调用方按 `yyyy-MM-dd HH:mm:ss` 提供，SDK 原样透传。
   */
  listEvidencePackages(
    req: ListEvidencePackagesRequest = {},
    signal?: AbortSignal,
  ): Promise<PageResult<EvidencePackagePageItem>> {
    return this.read<PageResult<EvidencePackagePageItem>>(
      'GET',
      `/compliance/evidence/packages/page${pageQuery(req, ['status', 'createTimeStart', 'createTimeEnd'])}`,
      null,
      signal,
    );
  }

  // =========================================================================
  // Report
  // =========================================================================

  /** 创建证据报告（写）。 */
  createReport(
    req: CreateReportRequest,
    opts: ComplianceWriteOptions = {},
  ): Promise<ComplianceReport> {
    return this.write<ComplianceReport>('POST', '/compliance/reports', req, writeCtx(opts));
  }

  /** 读 — 报告详情。 */
  getReport(id: number, signal?: AbortSignal): Promise<ComplianceReport> {
    return this.read<ComplianceReport>(
      'GET',
      `/compliance/reports/${encodeURIComponent(id)}`,
      null,
      signal,
    );
  }

  /**
   * 读 — 证据报告分页列表（compliance gateway S1）。
   *
   * 走 GET 读路径。返回 yudao `PageResult<T>`。所有过滤项可选；`createTimeStart` /
   * `createTimeEnd` 由调用方按 `yyyy-MM-dd HH:mm:ss` 提供，SDK 原样透传。
   */
  listReports(
    req: ListReportsRequest = {},
    signal?: AbortSignal,
  ): Promise<PageResult<ReportPageItem>> {
    return this.read<PageResult<ReportPageItem>>(
      'GET',
      `/compliance/reports/page${pageQuery(req, ['status', 'createTimeStart', 'createTimeEnd'])}`,
      null,
      signal,
    );
  }

  /**
   * 发布报告（写，step-up 必须）。
   *
   * `@status gated` — step-up 闸门未闭合前服务端会一致返回
   * `COMPLIANCE_STEP_UP_REQUIRED`（数值码 1031000013）。SDK 不会自动重试、不伪成功；
   * 调用方需要引导用户重新做 OAuth introspection 或重新登录后再次调用本方法
   *（使用同一 idempotency-key）。方法状态分级见 `docs/compliance.md` Method Status。
   */
  publishReport(id: number, opts: ComplianceWriteOptions = {}): Promise<ComplianceReport> {
    return this.write<ComplianceReport>(
      'POST',
      `/compliance/reports/${encodeURIComponent(id)}/publish`,
      null,
      writeCtx(opts),
    );
  }

  /**
   * 下载报告（读）。返回 {@link ReportDownload}：报告 hash + 资产 hash + 证据包 hash +
   * 时间章 serial/genTime，足以离线复核。
   * 不返回 bodyCanonicalJson / storage key / subject snapshot id。
   */
  downloadReport(id: number, signal?: AbortSignal): Promise<ReportDownload> {
    return this.read<ReportDownload>(
      'GET',
      `/compliance/reports/${encodeURIComponent(id)}/download`,
      null,
      signal,
    );
  }

  // =========================================================================
  // Signing Envelope
  // =========================================================================

  /** 创建 envelope（写）。返回 envelope id。 */
  createSigningEnvelope(
    req: CreateSigningEnvelopeRequest,
    opts: ComplianceWriteOptions = {},
  ): Promise<number> {
    return this.write<number>(
      'POST',
      '/compliance/signing-envelopes',
      req,
      writeCtx(opts),
    );
  }

  /** 读 — envelope 详情。租户由服务端从 compliance token principal 推导。 */
  getSigningEnvelope(
    envelopeId: number,
    signal?: AbortSignal,
  ): Promise<SigningEnvelope> {
    return this.read<SigningEnvelope>(
      'GET',
      `/compliance/signing-envelopes/${encodeURIComponent(envelopeId)}`,
      null,
      signal,
    );
  }

  /**
   * 读 — 签署 envelope 分页列表（compliance gateway S1）。
   *
   * 走 GET 读路径。返回 yudao `PageResult<T>`。所有过滤项可选；`createTimeStart` /
   * `createTimeEnd` 由调用方按 `yyyy-MM-dd HH:mm:ss` 提供，SDK 原样透传。
   */
  listSigningEnvelopes(
    req: ListSigningEnvelopesRequest = {},
    signal?: AbortSignal,
  ): Promise<PageResult<SigningEnvelopePageItem>> {
    return this.read<PageResult<SigningEnvelopePageItem>>(
      'GET',
      `/compliance/signing-envelopes/page${pageQuery(req, ['status', 'createTimeStart', 'createTimeEnd'])}`,
      null,
      signal,
    );
  }

  /**
   * 正式签署（写，step-up 必须）。
   *
   * `@status gated` — 服务端闸门关闭时会一致返回 `ENVELOPE_GATE_CLOSED` (1031004004)。
   * SDK 不重试、不伪成功；调用方应该将该错误展示为"功能未开放"。
   */
  signEnvelope(
    envelopeId: number,
    req: SignEnvelopeRequest,
    opts: ComplianceWriteOptions = {},
  ): Promise<void> {
    return this.write<void>(
      'POST',
      `/compliance/signing-envelopes/${encodeURIComponent(envelopeId)}/sign`,
      req,
      writeCtx(opts),
    );
  }

  /**
   * 创建 H5 签署短链（写，step-up 必须）。
   *
   * `@status gated` — 同 {@link signEnvelope}：服务端闸门关闭时 SDK 不重试、不伪成功。
   */
  createH5SigningUrl(
    envelopeId: number,
    req: CreateH5SigningUrlRequest,
    opts: ComplianceWriteOptions = {},
  ): Promise<string> {
    return this.write<string>(
      'POST',
      `/compliance/signing-envelopes/${encodeURIComponent(envelopeId)}/h5-url`,
      req,
      writeCtx(opts),
    );
  }

  /** 同步 provider 状态（写但只读对账，不创建新 provider 请求）。 */
  syncSigningEnvelopeStatus(
    envelopeId: number,
    opts: ComplianceWriteOptions = {},
  ): Promise<void> {
    return this.write<void>(
      'POST',
      `/compliance/signing-envelopes/${encodeURIComponent(envelopeId)}/sync-provider-status`,
      null,
      writeCtx(opts),
    );
  }

  // =========================================================================
  // Seal Approval
  // =========================================================================

  /**
   * 提交用印审批申请（写）。
   *
   * `@status production-ready` — 服务端以 `Idempotency-Key` + 业务请求指纹做重放保护：
   * 同 key + 同请求 → 返回原审批 id；同 key + 不同请求 → 拒绝复用幂等键。强烈建议调用方
   * 持久化 `idempotencyKey`，网络重试 / 任务恢复时复用，避免重复创建审批单。
   */
  submitSealApproval(
    req: SubmitSealApprovalRequest,
    opts: ComplianceWriteOptions = {},
  ): Promise<number> {
    return this.write<number>(
      'POST',
      '/compliance/seal-approvals',
      req,
      writeCtx(opts),
    );
  }

  /**
   * 审批通过用印申请（写，step-up 必须）。
   *
   * `@status gated` — step-up 未闭合前服务端会返回 `COMPLIANCE_STEP_UP_REQUIRED`。
   * SDK 不重试、不伪成功。方法状态分级见 `docs/compliance.md` Method Status。
   */
  approveSealApproval(
    id: number,
    query: ApproveSealApprovalQuery,
    opts: ComplianceWriteOptions = {},
  ): Promise<void> {
    const q = new URLSearchParams();
    if (query.expiresAt) q.set('expiresAt', query.expiresAt);
    if (query.note) q.set('note', query.note);
    const qs = q.toString();
    return this.write<void>(
      'POST',
      `/compliance/seal-approvals/${encodeURIComponent(id)}/approve${qs ? '?' + qs : ''}`,
      null,
      writeCtx(opts),
    );
  }

  rejectSealApproval(
    id: number,
    query: RejectSealApprovalQuery,
    opts: ComplianceWriteOptions = {},
  ): Promise<void> {
    const q = new URLSearchParams();
    if (query.reason) q.set('reason', query.reason);
    const qs = q.toString();
    return this.write<void>(
      'POST',
      `/compliance/seal-approvals/${encodeURIComponent(id)}/reject${qs ? '?' + qs : ''}`,
      null,
      writeCtx(opts),
    );
  }

  cancelSealApproval(
    id: number,
    query: CancelSealApprovalQuery,
    opts: ComplianceWriteOptions = {},
  ): Promise<void> {
    const q = new URLSearchParams();
    if (query.reason) q.set('reason', query.reason);
    const qs = q.toString();
    return this.write<void>(
      'POST',
      `/compliance/seal-approvals/${encodeURIComponent(id)}/cancel${qs ? '?' + qs : ''}`,
      null,
      writeCtx(opts),
    );
  }

  listPendingSealApprovals(
    signal?: AbortSignal,
  ): Promise<SealApproval[]> {
    return this.read<SealApproval[]>(
      'GET',
      '/compliance/seal-approvals/pending',
      null,
      signal,
    );
  }

  getSealApproval(id: number, signal?: AbortSignal): Promise<SealApproval> {
    return this.read<SealApproval>(
      'GET',
      `/compliance/seal-approvals/${encodeURIComponent(id)}`,
      null,
      signal,
    );
  }

  /**
   * 读 — 用印审批分页列表（compliance gateway S1）。
   *
   * 与 {@link listPendingSealApprovals}（仅 pending、不分页）不同，本方法支持分页与
   * 状态 / 时间过滤。走 GET 读路径。返回 yudao `PageResult<T>`。所有过滤项可选；
   * `createTimeStart` / `createTimeEnd` 由调用方按 `yyyy-MM-dd HH:mm:ss` 提供，
   * SDK 原样透传。
   */
  listSealApprovals(
    req: ListSealApprovalsRequest = {},
    signal?: AbortSignal,
  ): Promise<PageResult<SealApprovalPageItem>> {
    return this.read<PageResult<SealApprovalPageItem>>(
      'GET',
      `/compliance/seal-approvals/page${pageQuery(req, ['status', 'createTimeStart', 'createTimeEnd'])}`,
      null,
      signal,
    );
  }

  // =========================================================================
  // Provider Request (read-only)
  // =========================================================================

  getProviderRequest(id: number, signal?: AbortSignal): Promise<ProviderRequestStatusView> {
    return this.read<ProviderRequestStatusView>(
      'GET',
      `/compliance/provider-requests/${encodeURIComponent(id)}`,
      null,
      signal,
    );
  }

  /**
   * 轮询 provider request 到 SUCCESS / FAILED 终态。
   * - SUCCESS / FAILED → 返回最后视图；
   * - UNKNOWN / RETRYING / PENDING → 继续轮询；
   * - timeout → 抛 {@link CompliancePollError} kind='timeout'，不自动重发原 provider 请求。
   *
   * SUCCESS 不代表 billing 已 commit；调用方仍需通过业务侧 envelope / asset 终态判断。
   */
  async waitForProviderRequestTerminal(
    id: number,
    opts: CompliancePollOptions = {},
  ): Promise<ProviderRequestStatusView> {
    return this.poll<ProviderRequestStatusView>(
      () => this.getProviderRequest(id, opts.signal),
      (v) => classifyProviderStatus(v.status as ComplianceProviderRequestStatus),
      opts,
    );
  }

  // =========================================================================
  // Error classification (re-export for convenience)
  // =========================================================================

  classifyError(err: unknown): ComplianceErrorInfo | null {
    if (!isBusinessErrorLike(err)) return null;
    if (!isComplianceBusinessError(err)) return null;
    return classifyComplianceError(err);
  }

  // =========================================================================
  // Internal helpers
  // =========================================================================

  /**
   * 读路径：GET / 公开 verify。允许 401 单次刷新后重放（GET 幂等安全）。
   * 与 client.doJSONFullInternal 行为一致；不复用其代码因为 base URL 不同。
   */
  private async read<T>(
    method: 'GET' | 'HEAD' | 'OPTIONS',
    path: string,
    body: unknown | null,
    signal: AbortSignal | undefined,
    extraHeaders: Record<string, string> = {},
  ): Promise<T> {
    return this.executeJson<T>(method, path, body, signal, {
      retryOn401: true,
      extraHeaders,
    });
  }

  /**
   * 公开读路径：public verify。
   *
   * 与 {@link read} 的区别 — public 端点不应要求认证：
   *   - 无 token 时匿名请求：ensureToken 抛 `not authorized` 会被吞掉，继续匿名发送。
   *   - 有 token 时附带 `Authorization`，保留后端审计上下文。
   *   - 不做 401 refresh replay：401 直接抛 HTTPError，不触发 `forceRefresh`。
   *
   * URL 仍走 `client.complianceURL(path)`，不复用 `/api/v4`；底层复用
   * `client.doRequest`，不新增 fetch/axios 直连。
   */
  private async publicRead<T>(
    method: 'GET' | 'HEAD' | 'OPTIONS',
    path: string,
    signal: AbortSignal | undefined,
  ): Promise<T> {
    let token = '';
    try {
      token = await this.client.ensureToken(signal);
    } catch {
      // public 端点允许未授权 — 吞掉 `not authorized`，继续匿名请求。
    }

    const url = this.client.complianceURL(path);
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;

    const resp = await this.client.doRequest({ method, url, headers }, signal);

    if (resp.status < 200 || resp.status >= 300) {
      const bodyBytes = resp.body
        ? await readLimited(resp.body, maxErrorBodySize)
        : new Uint8Array();
      throw parseHTTPErrorWithHeader(resp.status, bodyBytes, resp.headers);
    }

    const text = await resp.text();
    if (!text) return undefined as unknown as T;
    const parsed = JSON.parse(text) as APIResponse<T>;
    const bizErr = apiResponseBusinessError(parsed);
    if (bizErr) throw bizErr;
    return parsed.data;
  }

  /**
   * 写路径：POST。
   * - 发送前 ensureToken 一次确保 token fresh。
   * - 不自动 401 重放：401 → 抛 HTTPError；调用方必须自己刷新 token 后用同一
   *   idempotency-key 重新发起，避免 provider 侧重复请求。
   * - 不走 doRequestWithRetry：写操作不允许 5xx/timeout 自动重试。
   */
  private async write<T>(
    method: 'POST' | 'PUT' | 'DELETE',
    path: string,
    body: unknown | null,
    ctx: WriteContext & { extraHeaders?: Record<string, string> },
  ): Promise<T> {
    const headers: Record<string, string> = { ...(ctx.extraHeaders ?? {}) };
    if (ctx.idempotencyKey) headers['Idempotency-Key'] = ctx.idempotencyKey;
    return this.executeJson<T>(method, path, body, ctx.signal, {
      retryOn401: false,
      extraHeaders: headers,
    });
  }

  private async executeJson<T>(
    method: string,
    path: string,
    body: unknown | null,
    signal: AbortSignal | undefined,
    opts: { retryOn401: boolean; extraHeaders: Record<string, string> },
    retried = false,
  ): Promise<T> {
    const token = await this.client.ensureToken(signal);
    const url = this.client.complianceURL(path);
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      ...opts.extraHeaders,
    };
    let bodyStr: string | undefined;
    if (body != null) {
      bodyStr = typeof body === 'string' ? body : JSON.stringify(body);
      headers['Content-Type'] = 'application/json';
    }

    const resp = await this.client.doRequest({ method, url, headers, body: bodyStr }, signal);

    if (resp.status === 401 && opts.retryOn401 && !retried) {
      try {
        await resp.body?.cancel();
      } catch { /* ignore */ }
      await this.client.forceRefresh(signal);
      return this.executeJson<T>(method, path, body, signal, opts, true);
    }

    if (resp.status < 200 || resp.status >= 300) {
      const bodyBytes = resp.body
        ? await readLimited(resp.body, maxErrorBodySize)
        : new Uint8Array();
      throw parseHTTPErrorWithHeader(resp.status, bodyBytes, resp.headers);
    }

    const text = await resp.text();
    if (!text) return undefined as unknown as T;
    const parsed = JSON.parse(text) as APIResponse<T>;
    const bizErr = apiResponseBusinessError(parsed);
    if (bizErr) throw bizErr;
    return parsed.data;
  }

  private async poll<T>(
    fetcher: () => Promise<T>,
    classify: (value: T) => PollDecision,
    opts: CompliancePollOptions,
  ): Promise<T> {
    const cfg = {
      timeoutMs: opts.timeoutMs ?? DEFAULT_POLL.timeoutMs,
      initialIntervalMs: opts.initialIntervalMs ?? DEFAULT_POLL.initialIntervalMs,
      maxIntervalMs: opts.maxIntervalMs ?? DEFAULT_POLL.maxIntervalMs,
      multiplier: opts.multiplier ?? DEFAULT_POLL.multiplier,
    };
    const deadline = Date.now() + cfg.timeoutMs;
    let interval = cfg.initialIntervalMs;
    let lastValue: T | undefined;

    while (Date.now() < deadline) {
      if (opts.signal?.aborted) {
        throw new CompliancePollError('compliance poll aborted', 'unknown');
      }
      lastValue = await fetcher();
      const decision = classify(lastValue);
      if (decision === 'done') return lastValue;
      if (decision === 'failed') {
        throw new CompliancePollError(
          'compliance poll observed terminal failure',
          'terminal_failure',
        );
      }
      // decision === 'continue' → wait then retry
      const sleepMs = Math.min(interval, deadline - Date.now());
      if (sleepMs <= 0) break;
      await sleep(sleepMs, opts.signal);
      interval = Math.min(Math.floor(interval * cfg.multiplier), cfg.maxIntervalMs);
    }
    throw new CompliancePollError('compliance poll timed out', 'timeout');
  }
}

type PollDecision = 'continue' | 'done' | 'failed';

function classifyTimestamp(
  status: ComplianceTimestampVerificationStatus | string,
): PollDecision {
  switch (status) {
    case 'VERIFIED':
      return 'done';
    case 'FAILED':
    case 'LOCAL_VERIFY_FAILED':
      return 'failed';
    case 'PENDING':
    case 'UNKNOWN':
    case 'RETRYING':
    default:
      return 'continue';
  }
}

function classifyProviderStatus(
  status: ComplianceProviderRequestStatus | string,
): PollDecision {
  switch (status) {
    case 'SUCCESS':
      return 'done';
    case 'FAILED':
      return 'failed';
    case 'PENDING':
    case 'UNKNOWN':
    case 'RETRYING':
    default:
      return 'continue';
  }
}

/**
 * 把分页请求 + 命名空间各自的过滤字段拼成 query string（含前导 `?`，空则返回 `''`）。
 *
 * - 分页 / 排序字段（`pageNo` / `pageSize` / `sortBy` / `sortDirection`）来自共享
 *   `PageRequest`，由本函数统一处理。
 * - `filterKeys` 是调用方命名空间各自声明的过滤字段名白名单 —— 仅这些键会被读取，
 *   值经 `String()` 归一后原样透传（`createTimeStart` / `createTimeEnd` 等 datetime
 *   字符串不在 SDK 侧做格式校验或时区转换）。
 * - `null` / `undefined` / 空字符串的字段一律跳过，不发送空参数。
 */
function pageQuery<T extends PageRequest>(req: T, filterKeys: ReadonlyArray<keyof T>): string {
  const q = new URLSearchParams();
  const append = (key: string, value: unknown): void => {
    if (value == null) return;
    const s = typeof value === 'string' ? value : String(value);
    if (s === '') return;
    q.set(key, s);
  };
  append('pageNo', req.pageNo);
  append('pageSize', req.pageSize);
  append('sortBy', req.sortBy);
  append('sortDirection', req.sortDirection);
  for (const key of filterKeys) {
    append(String(key), req[key]);
  }
  const qs = q.toString();
  return qs ? '?' + qs : '';
}

function writeCtx(
  opts: ComplianceWriteOptions,
  extraHeaders: Record<string, string> = {},
): WriteContext & { extraHeaders: Record<string, string> } {
  return {
    idempotencyKey: opts.idempotencyKey,
    signal: opts.signal,
    extraHeaders,
  };
}

function isBusinessErrorLike(err: unknown): err is BusinessError {
  if (err == null || typeof err !== 'object') return false;
  return typeof (err as { code?: unknown }).code === 'number';
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new CompliancePollError('compliance poll aborted', 'unknown'));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      reject(new CompliancePollError('compliance poll aborted', 'unknown'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}
