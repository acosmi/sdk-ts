// client.ts — 端口自 acosmi-sdk-go/client.go (2168 行)
//
// 主 Client class (核心: token 管理 / login / chat / SSE / HTTP)。
// 业务方法 (entitlements / packages / wallet / skills / tools / notifications)
// 通过 declaration merging 拆到 ./client-mixins/*。
//
// 核心红线:
//   - chat 路由用 getAdapterForModel (双格式等地位)
//   - 流式重试 = 双扣 → 流式路径不走 doRequestWithRetry, 仅 doRequest
//   - SafeToRetry POST 默认 false (计费安全)
//   - 401 单次重试, retried 参数防递归

import { type AnthropicResponse } from '../models/wire-anthropic';
import {
  type ChatRequest,
  type ChatResponse,
  type ManagedModel,
  type ModelCapabilities,
  type QuotaSummary,
  type WindowResetSummary,
  type SourcesEvent,
  type StreamEvent,
  type StreamSettlement,
  type ImageGenerationRequest,
  type ImageGenerationResponse,
  type VideoGenerationRequest,
  type VideoTaskResponse,
  type EmbeddingRequest,
  type EmbeddingResponse,
  type RerankRequest,
  type RerankResponse,
  parseSettlement,
  parseSourcesEvent,
} from '../models/types';
import { type ModelCoefficient } from '../billing/types';
import { type ServerMetadata, type TokenSet, tokenSetIsExpired } from '../auth/types';
import { ModelNotFoundError } from '../shared/errors';
import { type APIResponse, apiResponseBusinessError } from '../shared/api-response';
import {
  discover,
  discoverWithProfile,
  exchangeCode,
  exchangeCodeWithExpiry,
  refreshToken,
  register,
  revokeToken,
  authorize,
  newTokenSet,
  isSSLError,
  isInvalidGrantError,
  EventComplete,
  EventError,
  ErrDiscovery,
  ErrRegistration,
  ErrSSLProxy,
  ErrTokenExchange,
  type LoginEvent,
  type LoginErrCode,
  type LoginOptions,
  type OAuthMetadataProfile,
} from '../auth/auth';
import { type TokenStore, FileTokenStore, InMemoryTokenStore, LocalStorageTokenStore } from './store';
import { type RetryPolicy, effectivePolicy, computeBackoff } from './retry';
import {
  getAdapterForModel,
  ProviderFormat,
  type ProviderAdapter,
} from '../models/adapters/index';
import { extractAnthropicBlockMeta, type BlockMeta } from '../models/stream-meta';
import { newOpenAIStreamConverter } from '../models/adapters/openai';
import { isSSECommentLine } from '../models/enduser';
import {
  classifyTransport,
  iterSSELines,
  maxErrorBodySize,
  modelCacheTTLMs,
  parseHTTPErrorWithHeader,
  parseStreamError,
  readLimited,
} from './http';
import type { MinimalSanitizeConfig } from '../sanitize';

// =============================================================================
// FilterStatus — V30 二轮审计 D-P1-2: X-Entitlement-Filter-Status 头取值集
// =============================================================================

export type FilterStatus =
  | 'ok'
  | 'admin-bypass'
  | 'internal-bypass'
  | 'disabled-by-flag'
  | 'fallback-tkdist-error'
  | 'fallback-tkdist-deployment-skew'
  | 'fallback-no-buckets'
  | 'fallback-missing-userid'
  | '';

export const FilterStatusOK: FilterStatus = 'ok';
export const FilterStatusAdminBypass: FilterStatus = 'admin-bypass';
export const FilterStatusInternalBypass: FilterStatus = 'internal-bypass';
export const FilterStatusDisabledByFlag: FilterStatus = 'disabled-by-flag';
export const FilterStatusFallbackTkdistError: FilterStatus = 'fallback-tkdist-error';
export const FilterStatusFallbackTkdistSkew: FilterStatus = 'fallback-tkdist-deployment-skew';
export const FilterStatusFallbackNoBuckets: FilterStatus = 'fallback-no-buckets';
export const FilterStatusFallbackMissingUser: FilterStatus = 'fallback-missing-userid';
export const FilterStatusUnknown: FilterStatus = '';

// =============================================================================
// Gateway URL 契约 (Phase 0 §2)
// =============================================================================

/** Acosmi Gateway URL 默认值 — 与历史行为一致。 */
export const DEFAULT_GATEWAY_BASE_URL = 'https://acosmi.com';

/**
 * normalizeGatewayBaseURL — Acosmi nexus-v4 API Gateway URL 的归一化与校验。
 *
 * 红线 (Phase 0 契约 §1-§2):
 *   1. 仅允许 `http:` / `https:`；`ws:` / `wss:` 是 CrabCode `--sdk-url`
 *      RemoteIO 会话通道，不是 SDK API gateway URL，传入立刻抛错。
 *   2. URL 必须可被 `new URL()` 解析；非法输入立刻抛错。
 *   3. host 必须非空；query/hash 不允许 (gateway URL 不带 query)。
 *   4. pathname 去尾 `/`；末段允许是 `/api/v4` (`apiURL()` 不会重复追加)。
 *   5. 返回值是 `origin + pathname`，不带 query/hash/trailing slash。
 *
 * 该函数是公共 helper：CrabCode AppServer worker、CrabClaw 内部、外部第三方 SDK
 * 都应在写入 Acosmi base 之前调用它一次，避免 ws/wss 误入 SDK API client。
 */
export function normalizeGatewayBaseURL(input: unknown): string {
  if (typeof input !== 'string') {
    throw new TypeError(
      'Acosmi Gateway URL must be a string (see docs/audit/sdk-remote-control-contract-2026-05-27.md §2)',
    );
  }
  const trimmed = input.trim();
  if (trimmed.length === 0) {
    throw new Error('Acosmi Gateway URL is empty');
  }
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error(`Acosmi Gateway URL is not a valid URL: ${trimmed}`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(
      `Acosmi Gateway URL only allows http/https, got ${parsed.protocol} (${trimmed}). ` +
        `CrabCode --sdk-url (ws/wss) is the RemoteIO session channel, not a SDK gateway URL ` +
        `— see docs/audit/sdk-remote-control-contract-2026-05-27.md §1.`,
    );
  }
  if (!parsed.host) {
    throw new Error(`Acosmi Gateway URL has empty host: ${trimmed}`);
  }
  if (parsed.search.length > 0 || parsed.hash.length > 0) {
    throw new Error(`Acosmi Gateway URL must not contain query or hash: ${trimmed}`);
  }
  // 去尾 / (空 path => 仅 origin)
  const path = parsed.pathname.replace(/\/+$/, '');
  return path ? `${parsed.origin}${path}` : parsed.origin;
}

/**
 * normalizeOverrideBaseURL — 校验并归一化 override base URL (complianceBaseURL / apiBaseURL)。
 *
 * 与 `normalizeGatewayBaseURL` 同级的健壮性校验, 但用于 compliance / 开放 API 的同源直连 base:
 *   1. 必须是 string 且非空。
 *   2. 必须可被 `new URL()` 解析, 且协议为 `http:` / `https:` (ws/wss 不允许)。
 *   3. host 必须非空; 不允许 query / hash (override base 不带 query)。
 *   4. 返回值去尾随 `/` (origin + pathname)。
 *
 * 注意: helper 只校验 base URL 合法性, 不强加路径后缀 — compliance 走 `/admin-api`、
 * apiBaseURL 走 `/api/v4` 都由各自 `complianceURL()` / `apiURL()` 在 base 之上追加,
 * base 本身不含这些子路径。
 *
 * @param raw   原始配置值
 * @param label 出错信息里的字段名 (如 'complianceBaseURL')
 */
export function normalizeOverrideBaseURL(raw: string, label: string): string {
  if (typeof raw !== 'string') {
    throw new TypeError(`${label} must be a string`);
  }
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    throw new Error(`${label} is empty`);
  }
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error(`${label} is not a valid URL: ${trimmed}`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`${label} only allows http/https, got ${parsed.protocol} (${trimmed})`);
  }
  if (!parsed.host) {
    throw new Error(`${label} has empty host: ${trimmed}`);
  }
  if (parsed.search.length > 0 || parsed.hash.length > 0) {
    throw new Error(`${label} must not contain query or hash: ${trimmed}`);
  }
  const path = parsed.pathname.replace(/\/+$/, '');
  return path ? `${parsed.origin}${path}` : parsed.origin;
}

/**
 * pickAndNormalizeGatewayURL — Config 中三个 alias (serverURL/baseURL/baseUrl)
 * 取唯一规范值。多字段同时传入且 normalize 后不等时抛错。
 * 未传任一字段返回 `null`，由调用方决定是否填默认值。
 */
function pickAndNormalizeGatewayURL(cfg: Config): string | null {
  const inputs: Array<readonly [name: 'serverURL' | 'baseURL' | 'baseUrl', value: string]> = [];
  if (cfg.serverURL !== undefined) inputs.push(['serverURL', cfg.serverURL] as const);
  if (cfg.baseURL !== undefined) inputs.push(['baseURL', cfg.baseURL] as const);
  if (cfg.baseUrl !== undefined) inputs.push(['baseUrl', cfg.baseUrl] as const);
  if (inputs.length === 0) return null;
  const normalized = inputs.map(([n, v]) => [n, normalizeGatewayBaseURL(v)] as const);
  for (let i = 1; i < normalized.length; i++) {
    if (normalized[i][1] !== normalized[0][1]) {
      throw new Error(
        `Acosmi Gateway URL conflict: Config.${normalized[0][0]}=${normalized[0][1]} ` +
          `vs Config.${normalized[i][0]}=${normalized[i][1]} — pass only one field.`,
      );
    }
  }
  return normalized[0][1];
}

// =============================================================================
// Config
// =============================================================================

/** 客户端配置 */
export interface Config {
  /**
   * Acosmi nexus-v4 API Gateway 根地址 (默认 https://acosmi.com)。
   *
   * 该 URL 是 `@acosmi/sdk-ts` 调 Acosmi 云端 API 的根 — agent-runs /
   * managed-models / notifications WS / compliance 都从它派生。SDK 内部
   * `apiURL()` 会自动追加 `/api/v4`，调用方无需手动拼。
   *
   * 见 Phase 0 契约 `docs/audit/sdk-remote-control-contract-2026-05-27.md` §1-§2:
   *   - 协议: 仅允许 `http:` / `https:`；`ws:` / `wss:` 是 CrabCode `--sdk-url`
   *     RemoteIO 会话通道，不是 SDK gateway URL，传入将抛 `Error`。
   *   - `serverURL` / `baseURL` / `baseUrl` 三字段同语义，多写时 normalize 后必须相等。
   */
  serverURL?: string;

  /**
   * `serverURL` 的标准 alias (推荐拼写)。语义、normalize、校验完全等同 serverURL。
   * 见 Phase 0 契约 §2。同时传入 serverURL/baseURL/baseUrl 时三者 normalize 后必须相等。
   */
  baseURL?: string;

  /**
   * `serverURL` 的 camelCase-小写 alias。语义、normalize、校验完全等同 serverURL。
   * 见 Phase 0 契约 §2。
   */
  baseUrl?: string;

  /** token 持久化实现, 缺省时按平台选 (Node File / Browser LocalStorage / Memory) */
  store?: TokenStore;

  /** 自定义 fetch 实现 (默认 globalThis.fetch) */
  fetchImpl?: typeof fetch;

  /**
   * 重试策略 (L6, v0.15)
   *
   * undefined = 禁用重试 (v0.14.1 行为, 老调用方 0 影响)
   * 非 undefined = 启用 — 默认 SafeToRetry POST=false 兜底, chat/messages POST 仍 0 retry
   * GET 类查询 (skill-store/models/balance) 自动得 2x 稳定性
   *
   * 计费安全: 自定义 SafeToRetry 时, 严禁让 POST chat/messages 通过, 否则双扣
   */
  retryPolicy?: RetryPolicy;

  /**
   * Compliance (时间章 / 电子证据 / 合同签署) API 根地址。
   *
   * Java compliance 模块的 controller 注册在 `/compliance/...` 下，部署到
   * `/admin-api/*` 前缀。未配置时默认 `${serverURL}/admin-api`，也可显式覆盖到
   * 独立 ingress（如 `https://compliance.example.com`）。
   *
   * 该地址不被 `/api/v4` 拼接路径复用，compliance 调用走自己的子 client
   * `client.compliance.*`，不与既有模型网关 API 冲突。
   */
  complianceBaseURL?: string;

  /**
   * `/api/v4` 网关调用 (managed-model / agent-run / casehall 等) 的 base 覆盖。
   *
   * 未配置时默认 = `serverURL`（既有行为，所有既有消费方不受影响）。
   *
   * 用途：浏览器部署在**非网关同源**域名（如 sign.zhonglvbao.com）时，网关
   * acosmi.com 对带 `Origin` 头的跨域浏览器请求返 403（CORS 收紧）。把本字段设为
   * 同源代理 base（如 `window.location.origin`）、并在该域名 nginx 加
   * `location /api/v4/ { proxy_pass https://acosmi.com/api/v4/; proxy_set_header Origin ""; }`
   * 服务端转发，即可让浏览器侧 casehall / 网关调用走同源 → nginx 服务端转发 →
   * 规避跨域 403。仅设在**浏览器端** client；服务端 (Route Handler) client 不设本字段，
   * 直连 `serverURL` 即可（服务端到 acosmi.com 无跨域）。
   *
   * 与 `complianceBaseURL` 同构（compliance 走 `/admin-api`，本字段走 `/api/v4`）。
   * apiURL() 仍按需追加 `/api/v4`，调用方无需手动拼。
   */
  apiBaseURL?: string;

  /**
   * OAuth metadata profile — 决定 `ensureToken` 刷新 token 时
   * 发现 metadata 走哪个 well-known 端点。
   *
   * - `'desktop'` (默认): `/.well-known/oauth-authorization-server/desktop`
   *   — 桌面 loopback OAuth (`login()`) 流程。
   * - `'web'`: `/.well-known/oauth-authorization-server/web`
   *   — 浏览器 Web OAuth (csign 等第一方 Web 应用) 签发的 token，
   *   其 refresh 必须走 Web token 端点。
   *
   * 未设置时默认 `'desktop'`，对既有调用方行为完全无影响。
   * `login()` 桌面 loopback 路径不受此配置影响。
   */
  oauthMetadataProfile?: OAuthMetadataProfile;

  /**
   * Browser refresh strategy for Web OAuth tokens.
   *
   * - `'direct'` (default): refresh directly against the OAuth token endpoint.
   * - `'server-proxy'`: POST the current TokenSet to a same-origin refresh proxy,
   *   useful when the OAuth issuer intentionally blocks browser CORS.
   * - `'none'`: do not refresh automatically; expired tokens throw `token_expired`.
   */
  browserRefreshMode?: BrowserRefreshMode;

  /** Same-origin refresh proxy URL used when `browserRefreshMode='server-proxy'`. */
  refreshProxyURL?: string;
}

export type BrowserRefreshMode = 'direct' | 'server-proxy' | 'none';

export const ErrOAuthCORSBlocked = 'oauth_cors_blocked' as const;
export const ErrRefreshProxyFailed = 'refresh_proxy_failed' as const;
export const ErrTokenExpired = 'token_expired' as const;

/**
 * v1.6.0: chat / chatMessages / chatStream / chatMessagesStream 的 per-request 超时上限。
 *
 * 上游 (如 DeepSeek) 在开始推理前可能持续保活长达 10 分钟; SDK 必须容纳
 * "首字节前等待 + 推理 + 流式传输" 全程, 否则会在等待阶段误超时切断。
 * 单值覆盖, 不区分首字节 vs 总耗时 (AbortController 是总耗时上限)。
 */
const CHAT_REQUEST_TIMEOUT_MS = 11 * 60 * 1000;

/**
 * 非流式 JSON API 请求的默认超时 (毫秒)。
 *
 * 子 client (agent-runs / compliance) 的同步 JSON 调用未传 signal 时套用此上限,
 * 避免上游 hang 导致 Promise 永不 settle。流式 (SSE) / 下载等长连接路径**不**套此超时,
 * 以保留长连接语义。与 core doJSONFullInternal 的 30s 量级一致。
 */
export const DEFAULT_API_TIMEOUT_MS = 60_000;

// =============================================================================
// 内部 Deferred / WS state
// =============================================================================

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (v: T) => void;
  reject: (e: unknown) => void;
}

function newDeferred<T>(): Deferred<T> {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((r, j) => {
    resolve = r;
    reject = j;
  });
  return { promise, resolve, reject };
}

/**
 * WebSocket 状态 — 内部使用, 实际方法由 ws.ts mixin 提供
 * 留作 forward declaration, 避免循环依赖
 */
export interface WSState {
  connected: boolean;
  // 实现细节由 ws.ts 内部维护 — Client 主体只持有引用以便 logout/disconnect 联动
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any;
}

// =============================================================================
// Client class
// =============================================================================

/**
 * Acosmi nexus-v4 统一 API 客户端
 *
 * 覆盖全域 API: 模型/权益/商城/钱包/技能/工具/WebSocket
 * 自动处理 token 刷新, 所有 API 调用线程安全 (基于 Promise chain)
 */
export class Client {
  /** SDK 内部使用 — 业务方法 (mixin) 通过 this.* 访问以下字段 */

  /** 服务器根地址 (已 trim 尾随 /) */
  serverURL: string;
  /** Compliance API 根地址 (已 trim 尾随 /); null = 走默认 ${serverURL}/admin-api */
  complianceBaseURL: string | null;
  /** `/api/v4` 网关调用 base 覆盖 (已 trim 尾随 /); null = 走默认 serverURL */
  apiBaseURL: string | null;
  /** OAuth metadata profile — 刷新 token 时发现 metadata 用 (默认 'desktop') */
  oauthMetadataProfile: OAuthMetadataProfile;
  /** Browser Web OAuth refresh strategy (default 'direct') */
  browserRefreshMode: BrowserRefreshMode;
  /** Same-origin refresh proxy URL for browserRefreshMode='server-proxy' */
  refreshProxyURL: string | null;
  /** OAuth metadata (lazy loaded) */
  meta: ServerMetadata | null = null;
  /** 当前 token (内存) */
  tokens: TokenSet | null = null;
  /** token 持久化 */
  store: TokenStore;
  /** fetch 实现 (默认 globalThis.fetch) */
  fetchImpl: typeof fetch;

  /** 互斥锁 (TS 用 Promise chain 替代 sync.Mutex) */
  private mu: Promise<void> = Promise.resolve();

  /**
   * WebSocket 状态 (实际方法由 ws.ts mixin 维护)。
   * @internal — 实现细节: 跨模块 (ws.ts mixin) 需可见故为 public, 但非消费者 API,
   * 消费者用 connect/subscribe 等高层方法; 引用的 WSState 不进公开文档。
   */
  ws: WSState | null = null;

  /**
   * v0.15.1: token 就绪等待机制 — login 成功后 resolve, 等待方解除阻塞。
   * @internal — 内部同步原语 (Deferred), 非消费者 API。
   */
  tokenReady: Deferred<void> = newDeferred<void>();
  /** Login 进行中 — 等待方需等而非 fail-fast */
  loginInFlight = false;
  /** 防止 tokenReady 被多次 resolve (替代 Go sync.Once) */
  private tokenReadyResolved = false;

  /** 模型能力缓存 (CrabCode 扩展) */
  modelCache: ManagedModel[] = [];
  modelCacheTimeMs = 0;

  /** sanitize-bridge 配置 (默认禁用) */
  defensiveCfg: MinimalSanitizeConfig | null = null;
  autoStripEphemeral = false;

  /** L6 (v0.15): 重试策略. null = 禁用 (v0.14.1 行为) */
  retryPolicy: Required<RetryPolicy> | null;

  /** V29 系数缓存 (TTL 8s, listCoefficients 内部用) */
  coefCacheData: ModelCoefficient[] | null = null;
  coefCacheTimeMs = 0;
  /** 串行化锁 (替代 Go sync.Mutex) */
  private coefMu: Promise<void> = Promise.resolve();

  constructor(cfg: Config = {}) {
    // Phase 0 §2: serverURL/baseURL/baseUrl 三字段同语义, 多写时 normalize 后必须相等;
    // 任一字段都会经 normalizeGatewayBaseURL 校验 (拒 ws/wss/拒空/拒 query/hash).
    const picked = pickAndNormalizeGatewayURL(cfg);
    this.serverURL = picked ?? DEFAULT_GATEWAY_BASE_URL;
    this.complianceBaseURL = cfg.complianceBaseURL
      ? normalizeOverrideBaseURL(cfg.complianceBaseURL, 'complianceBaseURL')
      : null;
    this.apiBaseURL = cfg.apiBaseURL
      ? normalizeOverrideBaseURL(cfg.apiBaseURL, 'apiBaseURL')
      : null;
    this.oauthMetadataProfile = cfg.oauthMetadataProfile ?? 'desktop';
    this.browserRefreshMode = cfg.browserRefreshMode ?? 'direct';
    this.refreshProxyURL = cfg.refreshProxyURL ?? null;
    this.store = cfg.store ?? defaultTokenStore();
    this.fetchImpl = cfg.fetchImpl ?? globalThis.fetch.bind(globalThis);
    this.retryPolicy = effectivePolicy(cfg.retryPolicy ?? null);
  }

  /**
   * 异步初始化 (从 store 加载已有 token)
   * 替代 Go NewClient (Go 同步 IO, TS 必须 async)
   */
  static async create(cfg: Config = {}): Promise<Client> {
    const c = new Client(cfg);
    try {
      const tokens = await c.store.load();
      if (tokens) {
        c.tokens = tokens;
        if (!c.tokenReadyResolved) {
          c.tokenReadyResolved = true;
          c.tokenReady.resolve();
        }
      }
    } catch {
      // store 损坏 — 静默忽略, 让 caller Login 重建
    }
    return c;
  }

  // ===========================================================================
  // 授权生命周期
  // ===========================================================================

  /** 是否已授权 (有可用 token) */
  isAuthorized(): boolean {
    return this.tokens != null;
  }

  /**
   * 返回归一化后的 Acosmi Gateway URL (= `serverURL` 字段). readonly helper.
   *
   * Phase 0 §2 红线:
   *   - 不要 mutate `client.serverURL` 字段实现 base 切换; 用 per-base Client 实例.
   *   - 该值仅供日志/排查/上层缓存键使用, 不重新 normalize 它 (构造期已 normalize).
   */
  getServerURL(): string {
    return this.serverURL;
  }

  /** `getServerURL()` 的 alias — Phase 0 §2 baseURL 与 serverURL 同义. */
  getBaseURL(): string {
    return this.serverURL;
  }

  /** 当前 token 信息 (用于 CLI whoami 显示) */
  getTokenSet(): TokenSet | null {
    return this.tokens;
  }

  private getCachedClientID(): string {
    return this.tokens?.client_id ?? '';
  }

  /**
   * 完整授权流程: 发现 → 注册 → 授权 → 换 token → 持久化
   * @param appName 桌面智能体名称 (如 "CrabClaw Desktop")
   * @param scopes 请求的权限范围 (参考 allScopes / modelScopes / commerceScopes 等预设)
   */
  async login(appName: string, scopes: string[], signal?: AbortSignal): Promise<void> {
    return this.loginInternal(appName, scopes, undefined, signal);
  }

  /**
   * 带事件回调的登录流程 — CrabCode 使用
   *
   * handler 在以下时刻被调用:
   *   - EventAuthURL:  授权 URL 已就绪, 调用方可展示/打开浏览器
   *   - EventComplete: 登录成功, tokens 已持久化
   *   - EventError:    某步骤失败, 附 ErrCode 分类码
   *
   * 当 handler 为 null 时, 行为与 login() 完全一致。
   */
  async loginWithHandler(
    appName: string,
    scopes: string[],
    handler: ((e: LoginEvent) => void) | null,
    opts: LoginOptions = {},
    signal?: AbortSignal,
  ): Promise<void> {
    return this.loginInternal(appName, scopes, { handler, ...opts }, signal);
  }

  private async loginInternal(
    appName: string,
    scopes: string[],
    opts: (LoginOptions & { handler?: ((e: LoginEvent) => void) | null }) | undefined,
    signal?: AbortSignal,
  ): Promise<void> {
    const handler = opts?.handler ?? undefined;
    const emit = (e: LoginEvent) => {
      if (handler) handler(e);
    };
    const emitError = (code: LoginErrCode, err: unknown) => {
      emit({
        type: EventError,
        err_code: code,
        error: err instanceof Error ? err.message : String(err),
      });
    };

    this.loginInFlight = true;
    try {
      // 1. 发现
      let meta: ServerMetadata;
      try {
        meta = await discover(this.serverURL, signal, this.fetchImpl);
      } catch (err) {
        emitError(ErrDiscovery, err);
        throw new Error(`discovery failed: ${err instanceof Error ? err.message : String(err)}`);
      }
      this.meta = meta;

      // 2. 检查是否已有 client_id; 无则注册
      let clientID = this.getCachedClientID();
      if (clientID === '') {
        try {
          const reg = await register(meta, appName, signal, this.fetchImpl);
          clientID = reg.client_id;
        } catch (err) {
          emitError(ErrRegistration, err);
          throw new Error(
            `registration failed: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }

      // 3. 授权 (PKCE + browser + callback)
      let result: { code: string; redirectURI: string };
      let verifier: string;
      try {
        const r = await authorize(meta, clientID, scopes, { ...opts, handler, signal });
        result = r.result;
        verifier = r.verifier;
      } catch (err) {
        // 授权失败 (可能是服务器重启后 client_id 失效):
        // 清除缓存的 client_id, 重新注册, 再试一次
        try {
          const reg = await register(meta, appName, signal, this.fetchImpl);
          clientID = reg.client_id;
        } catch (regErr) {
          emitError(ErrRegistration, regErr);
          throw new Error(
            `authorization failed (retry registration also failed): ${err instanceof Error ? err.message : String(err)}`,
          );
        }
        try {
          const r = await authorize(meta, clientID, scopes, { ...opts, handler, signal });
          result = r.result;
          verifier = r.verifier;
        } catch (err2) {
          throw new Error(
            `authorization failed: ${err2 instanceof Error ? err2.message : String(err2)}`,
          );
        }
      }

      // 4. 换 token (审计 A-2: 支持自定义 expiresIn)
      let tokenResp;
      try {
        if (opts?.expiresIn && opts.expiresIn > 0) {
          tokenResp = await exchangeCodeWithExpiry(
            meta,
            clientID,
            result.code,
            result.redirectURI,
            verifier,
            opts.expiresIn,
            signal,
            this.fetchImpl,
          );
        } else {
          tokenResp = await exchangeCode(
            meta,
            clientID,
            result.code,
            result.redirectURI,
            verifier,
            signal,
            this.fetchImpl,
          );
        }
      } catch (err) {
        const code = isSSLError(err) ? ErrSSLProxy : ErrTokenExchange;
        emitError(code, err);
        throw new Error(
          `token exchange failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }

      // 5. 持久化 + 通知等待方
      const tokens = newTokenSet(tokenResp, clientID, this.serverURL);
      this.tokens = tokens;
      if (!this.tokenReadyResolved) {
        this.tokenReadyResolved = true;
        this.tokenReady.resolve();
      }
      try {
        await this.store.save(tokens);
      } catch (err) {
        throw new Error(`save tokens: ${err instanceof Error ? err.message : String(err)}`);
      }

      // 6. 完成
      emit({ type: EventComplete });
    } finally {
      this.loginInFlight = false;
    }
  }

  /** 吊销 token 并清除本地存储 */
  async logout(signal?: AbortSignal): Promise<void> {
    const tokens = this.tokens;
    let meta = this.meta;
    this.tokens = null;
    this.meta = null;
    // v0.15.1: 重置等待信号 — 下次 login 重新触发等待→唤醒流程
    this.tokenReady = newDeferred<void>();
    this.tokenReadyResolved = false;

    if (tokens) {
      if (!meta) {
        try {
          // token-lifecycle discovery: revoke 必须打与签发 token 同 profile 的端点
          meta = await discoverWithProfile(this.serverURL, this.oauthMetadataProfile, signal, this.fetchImpl);
        } catch (e) {
          console.warn(`[acosmi-sdk] warning: discover for revocation failed: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
      if (meta) {
        try {
          await revokeToken(meta, tokens.access_token, signal, this.fetchImpl);
        } catch {
          // ignore
        }
        try {
          await revokeToken(meta, tokens.refresh_token, signal, this.fetchImpl);
        } catch {
          // ignore
        }
      }
    }

    await this.store.clear();
  }

  // ===========================================================================
  // Token 管理
  // ===========================================================================

  /**
   * 确保有有效的 access_token, 过期则自动刷新
   *
   * v0.15.1: 当 tokens==null 且 login 正在并发进行中时, 阻塞等待 token 就绪,
   * 避免应用启动期 "login + 多个 API 调用" 并发场景下 4+ 条 "not authorized" 误报.
   */
  async ensureToken(signal?: AbortSignal): Promise<string> {
    let tokens = this.tokens;
    const ready = this.tokenReady.promise;
    const inFlight = this.loginInFlight;

    if (tokens == null) {
      if (!inFlight) {
        throw new Error('not authorized, call login() first');
      }
      // login 进行中, 等待就绪或 abort
      let abortHandler: (() => void) | undefined;
      try {
        await Promise.race([
          ready,
          new Promise<never>((_, reject) => {
            if (signal) {
              if (signal.aborted) reject(new Error(`waiting for token: aborted`));
              else {
                abortHandler = () => reject(new Error(`waiting for token: aborted`));
                signal.addEventListener('abort', abortHandler);
              }
            }
          }),
        ]);
      } finally {
        if (abortHandler && signal) signal.removeEventListener('abort', abortHandler);
      }
      tokens = this.tokens;
      if (tokens == null) {
        // 边界: 等待期间被 logout 重置, 当作未授权
        throw new Error('not authorized, call login() first');
      }
    }

    if (!tokenSetIsExpired(tokens)) {
      return tokens.access_token;
    }

    // 需要刷新 — 双层串行: withMu 进程内 + storeWithLock 跨进程 (FileTokenStore 实现 sidecar
    // .lock 文件; LocalStorage / InMemory 单进程语义无需此层, 自动 no-op).
    //
    // v1.0.2 修复多进程共享 ~/.acosmi/tokens.json 时撞 "HTTP 400: refresh token not found":
    //   1) 进入跨进程临界区后, store.load() 重读磁盘 — 别的进程可能已完成 rotation
    //   2) 若磁盘 refresh_token ≠ 内存 → 采纳磁盘新版 → 重判过期 → 未过期则直接返回
    //      (跳过本进程的多余 refresh, 同时避免拿已 invalidated 的 R0 撞网关)
    return this.withMu(() =>
      this.storeWithLock(async () => {
        await this.syncFromDisk();
        // 双检 — 同 v1.0.1 逻辑
        if (this.tokens == null) {
          throw new Error('not authorized, call login() first');
        }
        if (!tokenSetIsExpired(this.tokens)) {
          return this.tokens.access_token;
        }

        await this.refreshCurrentToken(signal);

        return this.tokens.access_token;
      }),
    );
  }

  /** 强制刷新 token (用于 401 重试) */
  async forceRefresh(signal?: AbortSignal): Promise<void> {
    return this.withMu(() =>
      this.storeWithLock(async () => {
        // v1.0.2: 同 ensureToken — 进入跨进程临界区后先同步磁盘. 别的进程刚 rotation
        // 过的话, 磁盘上是新 RT, 网关返回 401 触发本进程 forceRefresh 用磁盘新 RT 即可成功;
        // 否则用旧 RT 必撞 "refresh token not found" 400.
        await this.syncFromDisk();
        if (this.tokens == null) {
          throw new Error('no tokens to refresh');
        }
        await this.refreshCurrentToken(signal);
      }),
    );
  }

  private async refreshCurrentToken(signal?: AbortSignal): Promise<void> {
    if (this.tokens == null) {
      throw new Error('no tokens to refresh');
    }
    if (this.browserRefreshMode === 'none') {
      throw new Error(`${ErrTokenExpired}: token refresh disabled`);
    }
    if (this.browserRefreshMode === 'server-proxy') {
      await this.refreshCurrentTokenViaProxy(signal);
      return;
    }
    await this.refreshCurrentTokenDirect(signal);
  }

  private async refreshCurrentTokenDirect(signal?: AbortSignal): Promise<void> {
    if (this.tokens == null) {
      throw new Error('no tokens to refresh');
    }
    if (this.meta == null) {
      try {
        // token-lifecycle discovery: refresh 必须打与签发 token 同 profile 的端点
        this.meta = await discoverWithProfile(this.serverURL, this.oauthMetadataProfile, signal, this.fetchImpl);
      } catch (e) {
        throw new Error(
          `discover for refresh: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    }

    let tokenResp;
    try {
      tokenResp = await refreshToken(
        this.meta,
        this.tokens.client_id,
        this.tokens.refresh_token,
        signal,
        this.fetchImpl,
      );
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      if (isInvalidGrantError(e)) {
        await this.clearInvalidRefreshToken();
        throw new Error(`refresh token invalid; local tokens cleared: ${message}`);
      }
      if (isLikelyBrowserOAuthCORSError(message)) {
        throw new Error(`${ErrOAuthCORSBlocked}: refresh token: ${message}`);
      }
      throw new Error(`refresh token: ${message}`);
    }

    this.tokens = newTokenSet(tokenResp, this.tokens.client_id, this.serverURL);
    await this.saveRefreshedToken();
  }

  private async refreshCurrentTokenViaProxy(signal?: AbortSignal): Promise<void> {
    if (this.tokens == null) {
      throw new Error('no tokens to refresh');
    }
    if (!this.refreshProxyURL) {
      throw new Error(`${ErrRefreshProxyFailed}: refreshProxyURL is required`);
    }

    let resp: Response;
    try {
      resp = await this.fetchImpl(this.refreshProxyURL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_id: this.tokens.client_id,
          refresh_token: this.tokens.refresh_token,
          server_url: this.tokens.server_url || this.serverURL,
        }),
        signal,
      });
    } catch (e) {
      throw new Error(
        `${ErrRefreshProxyFailed}: ${e instanceof Error ? e.message : String(e)}`,
      );
    }

    if (!resp.ok) {
      let message = '';
      let oauthError = '';
      try {
        const body = (await resp.json()) as { error?: unknown; error_description?: unknown };
        if (typeof body.error === 'string') message = body.error;
        if (typeof body.error === 'string') oauthError = body.error;
        if (typeof body.error_description === 'string') message = body.error_description;
      } catch {
        // ignore non-JSON proxy errors
      }
      if (oauthError === 'invalid_grant') {
        await this.clearInvalidRefreshToken();
        throw new Error(`${ErrRefreshProxyFailed}: refresh token invalid; local tokens cleared`);
      }
      throw new Error(`${ErrRefreshProxyFailed}: HTTP ${resp.status}: ${message}`);
    }

    let body: { tokenSet?: TokenSet };
    try {
      body = (await resp.json()) as { tokenSet?: TokenSet };
    } catch (e) {
      throw new Error(
        `${ErrRefreshProxyFailed}: decode: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
    if (!isTokenSetLike(body.tokenSet)) {
      throw new Error(`${ErrRefreshProxyFailed}: response missing tokenSet`);
    }

    this.tokens = body.tokenSet;
    await this.saveRefreshedToken();
  }

  private async saveRefreshedToken(): Promise<void> {
    if (this.tokens == null) return;
    try {
      await this.store.save(this.tokens);
    } catch (e) {
      console.warn(
        `[acosmi-sdk] warning: save refreshed token failed: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  private async clearInvalidRefreshToken(): Promise<void> {
    this.tokens = null;
    this.meta = null;
    this.loginInFlight = false;
    this.tokenReady = newDeferred<void>();
    this.tokenReadyResolved = false;
    try {
      await this.store.clear();
    } catch (e) {
      console.warn(
        `[acosmi-sdk] warning: clear invalid token failed: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  /** 互斥锁 helper (替代 Go sync.Mutex) */
  private withMu<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.mu.then(fn, fn);
    this.mu = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }

  /** v1.0.2: 跨进程临界区 helper. store.withLock 可选, 缺省则直接调用 fn (LocalStorage /
   *  InMemory 单进程无需). */
  private async storeWithLock<T>(fn: () => Promise<T>): Promise<T> {
    const lock = this.store.withLock;
    if (typeof lock === 'function') {
      return lock.call(this.store, fn) as Promise<T>;
    }
    return fn();
  }

  /** v1.0.2: 从磁盘同步 token (refresh 前). 别的进程 rotation 后磁盘 refresh_token 已变,
   *  本进程内存仍是旧 R0; 不同步直接 refresh 必撞网关 400. load 失败保留内存继续 (容错). */
  private async syncFromDisk(): Promise<void> {
    let onDisk: TokenSet | null = null;
    try {
      onDisk = await this.store.load();
    } catch {
      // 磁盘读失败 (文件损坏 / 权限) — 不阻塞 refresh, 让后续 refreshToken 暴露真实错误
      return;
    }
    if (!onDisk) return;
    // 磁盘有 token 且 RT 与内存不一致 — 采纳磁盘新版 (典型: 别的进程已 rotation)
    if (this.tokens == null || onDisk.refresh_token !== this.tokens.refresh_token) {
      this.tokens = onDisk;
    }
  }

  // ===========================================================================
  // Managed Models
  // ===========================================================================

  /**
   * 获取可用的托管模型列表.
   *
   * V30 二轮审计 D-P1-2: 此方法不返回 entitlement-filter-status header.
   * UI 想根据 fallback 状态显示降级提示, 请改调 listModelsWithStatus.
   */
  async listModels(
    signal?: AbortSignal,
    opts?: { includeLocked?: boolean },
  ): Promise<ManagedModel[]> {
    const r = await this.listModelsWithStatus(signal, opts);
    return r.models;
  }

  /**
   * 获取可用模型列表, 同时返回 X-Entitlement-Filter-Status header.
   *
   * V30 二轮审计 D-P1-2: 老 listModels 丢弃 header 让 SDK 用户无法识别 fail-OPEN 降级状态,
   * 此方法暴露 status 让 UI 可:
   *   - status === 'ok' → 正常显示 BucketInfo 余量
   *   - status === 'fallback-tkdist-error' → 灰显余量 + toast "tk-dist 离线, 模型列表降级"
   *   - status === 'disabled-by-flag' → 不显示余量 (运维灰度中)
   *   - status === '' (Unknown) → 老 nexus, 按老 v0.17 行为 (不显示 BucketInfo)
   */
  async listModelsWithStatus(
    signal?: AbortSignal,
    opts?: { includeLocked?: boolean },
  ): Promise<{ models: ManagedModel[]; status: FilterStatus }> {
    // includeLocked=true：请求「全集模式」。网关已实现 ?picker=1
    // （managed_model.go appendLockedUpsellModels）：filterModelsByEntitlement 删行后把
    // 越档模型作为 Locked=true 补回，返回全集供 C 端选择器展示「付费订阅区」+ 置灰升级
    // 引导。opts.includeLocked 是面向调用方的语义名，拼成网关认的 picker=1。缺省=现状
    // （只返有桶模型），向后兼容旧客户端 / 内部消费者。
    const includeLocked = opts?.includeLocked === true;
    const path = includeLocked
      ? '/managed-models?picker=1'
      : '/managed-models';
    const { result, headers } = await this.doJSONFull<APIResponse<ManagedModel[]>>(
      'GET',
      path,
      null,
      signal,
    );
    // v1.2: 写缓存前归一化 input_modalities → inputModalities (snake/camel 双名兼容)
    const normalized = normalizeInputModalities(result.data);
    // 全集模式（含 locked 行）只供 picker 展示，**不写** this.modelCache —— 后者是
    // 「可用模型」缓存（getModelCapabilities / quota 消费），写全集会让 locked 模型混入
    // 可用集（全集/子集互污）。缺省模式照旧缓存，行为完全不变。
    if (!includeLocked) {
      this.modelCache = normalized;
      this.modelCacheTimeMs = Date.now();
    }

    let status: FilterStatus = '';
    if (headers) {
      const h = headers.get('X-Entitlement-Filter-Status');
      if (h) status = h as FilterStatus;
    }
    return { models: normalized, status };
  }

  /** 查询当前用户账户级权益总览 (v0.19+) */
  async getQuotaSummary(signal?: AbortSignal): Promise<QuotaSummary> {
    const resp = await this.doJSON<APIResponse<QuotaSummary>>(
      'GET',
      '/entitlements/quota-summary',
      null,
      signal,
    );
    return resp.data;
  }

  /**
   * [W1 2026-07-11 软限额] 设置当前用户 5 小时窗口软限额「继续」开关 (v2.12+)。
   *
   * enabled=true = 软限额 (到达 5h 后继续消耗周配额, 默认); false = 严格模式 (到达即等待逐步恢复)。
   * userId 由网关从鉴权态解析 (客户端永不传), 故只需 enabled + 可选 source (审计: web /
   * crabcode-gui / crabcode-tui / dialog)。用于个人中心开关、429 严格模式「重新开启继续」续跑。
   *
   * @returns 网关回显的新状态 { enabled }。
   */
  async setWindowContinuePreference(
    enabled: boolean,
    opts?: { source?: string; signal?: AbortSignal },
  ): Promise<{ enabled: boolean }> {
    const resp = await this.doJSON<APIResponse<{ enabled: boolean }>>(
      'POST',
      '/entitlements/window-continue-pref',
      { enabled, source: opts?.source },
      opts?.signal,
    );
    return { enabled: resp.data.enabled };
  }

  /**
   * [W-MEMBERSHIP 2026-08-01 邀请奖励] 查询当前用户窗口重置券总览 (v2.13+)。
   *
   * 重置券由邀请奖励发放 (被邀请人激活并达到用量门槛后计一次), 每张可清空一次滚动窗口已用量
   * (见 redeemWindowReset)。userId 由网关从鉴权态解析, 客户端永不传。
   * 用于个人中心邀请栏与 429 窗口限额弹窗展示"还剩几张券 + 最近到期时间 + 邀请进度"。
   *
   * @returns 券余量 / 最近到期 / 累计发放与使用 / 邀请已达标与待达标数。
   */
  async getWindowResetSummary(signal?: AbortSignal): Promise<WindowResetSummary> {
    const resp = await this.doJSON<APIResponse<WindowResetSummary>>(
      'GET',
      '/entitlements/window-reset/summary',
      null,
      signal,
    );
    return resp.data;
  }

  /**
   * [W-MEMBERSHIP 2026-08-01 邀请奖励] 消费一张窗口重置券, 清空当前滚动窗口已用量 (v2.13+)。
   *
   * **幂等键语义**: 传 `clientRequestId` 时同一 ID 重放**不会二次扣券** — 网关按该键返回首次
   * 结果 (`remaining` 与首次一致)。网络重试 / 用户连点必须**复用同一 ID**; 换 ID = 换一次真实
   * 扣券。不传则不幂等, 每次调用都是一次真实扣券。
   *
   * 业务错 (信封 `code != 0`) 按 SDK 惯例抛 `BusinessError` (message 含机器码), 常见两种:
   *   - `NO_AVAILABLE_CREDIT` — 无可用券 (未发放 / 已用尽 / 已过期)
   *   - `NO_WINDOW_USAGE` — 当前窗口无已用量, 无可重置 (不扣券)
   *
   * @returns 扣减后剩余可用券张数 { remaining }。
   */
  async redeemWindowReset(opts?: {
    clientRequestId?: string;
    signal?: AbortSignal;
  }): Promise<{ remaining: number }> {
    const resp = await this.doJSON<APIResponse<{ remaining: number }>>(
      'POST',
      '/entitlements/window-reset/redeem',
      { clientRequestId: opts?.clientRequestId },
      opts?.signal,
    );
    return { remaining: resp.data.remaining };
  }

  /**
   * 查询单个模型的能力矩阵
   * 优先从 listModels 缓存读取, miss 时调用 listModels 刷新
   */
  async getModelCapabilities(modelID: string, signal?: AbortSignal): Promise<ModelCapabilities> {
    let caps = this.getCachedCapabilities(modelID);
    if (caps) return caps;
    await this.listModels(signal);
    caps = this.getCachedCapabilities(modelID);
    if (caps) return caps;
    // 模型不在列表中, 返回零值 (与 Go 行为一致)
    return zeroModelCapabilities();
  }

  private getCachedCapabilities(modelID: string): ModelCapabilities | null {
    if (this.modelCache.length === 0 || Date.now() - this.modelCacheTimeMs > modelCacheTTLMs) {
      return null;
    }
    for (const m of this.modelCache) {
      if (m.id === modelID || m.modelId === modelID) {
        return m.capabilities;
      }
    }
    return null;
  }

  /** 从缓存中查找完整 ManagedModel (未命中返 null) */
  private getCachedModel(modelID: string): ManagedModel | null {
    for (const m of this.modelCache) {
      if (m.id === modelID || m.modelId === modelID) return m;
    }
    return null;
  }

  /** 测试辅助: 把占位 ManagedModel 塞入缓存. 仅测试用. */
  primeModelCacheForTest(...ids: string[]): void {
    for (const id of ids) {
      this.modelCache.push({
        id,
        name: '',
        provider: 'anthropic',
        modelId: id,
        maxTokens: 0,
        isEnabled: true,
        capabilities: zeroModelCapabilities(),
      });
    }
    this.modelCacheTimeMs = Date.now();
  }

  /**
   * 确保指定 modelID 的 ManagedModel 已在缓存中。
   *
   * 语义:
   *   1. 若缓存命中 → 直接返回
   *   2. 若未命中 → 调 listModels 刷新一次
   *   3. 刷新后仍未命中 → 抛 ModelNotFoundError
   *
   * 根因修复: 消除未预热场景下 provider="anthropic" 硬编码回退,
   * 该回退会让 DashScope/Zhipu/DeepSeek 等 non-anthropic 模型被按 Anthropic
   * 格式编码并打到错误的 /anthropic 端点。
   */
  async ensureModelCached(modelID: string, signal?: AbortSignal): Promise<ManagedModel> {
    let m = this.getCachedModel(modelID);
    if (m) return m;
    await this.listModels(signal);
    m = this.getCachedModel(modelID);
    if (m) return m;
    throw new ModelNotFoundError(modelID);
  }

  // ===========================================================================
  // Chat
  // ===========================================================================

  /**
   * 构建完整的聊天请求体 (v0.5.0 adapter 模式)
   *
   * 根据 provider 选择 adapter, 委托 buildRequestBody 构建格式化的请求体。
   *
   * v0.13.x: 前置 ensureModelCached, 消除冷缓存硬编码回退。未知 modelID 抛 ModelNotFoundError.
   */
  async buildChatRequest(
    modelID: string,
    req: ChatRequest,
    signal?: AbortSignal,
  ): Promise<{ body: string; adapter: ProviderAdapter }> {
    // v0.11.0: 请求前防御 (体积 / deny-list / 深度 / ephemeral 剥离). 未配置时零开销.
    // applyRequestSanitizers 由 sanitize-bridge.ts mixin 提供
    if (typeof (this as Client & { applyRequestSanitizers?: (r: ChatRequest) => void }).applyRequestSanitizers === 'function') {
      (this as Client & { applyRequestSanitizers: (r: ChatRequest) => void }).applyRequestSanitizers(req);
    }

    const m = await this.ensureModelCached(modelID, signal);
    const adapter = getAdapterForModel(m);
    const caps = this.getCachedCapabilities(modelID) ?? zeroModelCapabilities();

    const body = adapter.buildRequestBody(caps, req);
    return { body: JSON.stringify(body), adapter };
  }

  /**
   * 同步聊天 (适合短回复)
   * 响应的 tokenRemaining / callRemaining 字段来自服务端 Header, 反映结算后余额
   * v0.5.0: 根据 provider 自动路由到 /anthropic 或 /chat 端点
   */
  async chat(modelID: string, req: ChatRequest, signal?: AbortSignal): Promise<ChatResponse> {
    // 浅拷贝避免原地 mutate 调用方传入的 req (buildChatRequest 内部 sanitizer 也会改 rawMessages)。
    const r: ChatRequest = { ...req, stream: false };
    // v1.6.0: 调整为 CHAT_REQUEST_TIMEOUT_MS (11min), 容纳 DeepSeek 等上游"首字节前 10min 保活"窗口。
    const ctl = withRequestTimeout(CHAT_REQUEST_TIMEOUT_MS, signal);
    try {
      const { body, adapter } = await this.buildChatRequest(modelID, r, ctl.signal);
      const endpoint = `/managed-models/${encodeURIComponent(modelID)}${adapter.endpointSuffix()}`;
      const { result, headers } = await this.doJSONFullRaw('POST', endpoint, body, ctl.signal);

      const resp = adapter.parseResponse(result);

      // 从 Header 提取 token 余额
      const v1 = headers.get('X-Token-Remaining');
      if (v1) {
        const n = parseInt(v1, 10);
        if (!isNaN(n)) resp.tokenRemaining = n;
      }
      const v2 = headers.get('X-Call-Remaining');
      if (v2) {
        const n = parseInt(v2, 10);
        if (!isNaN(n)) resp.callRemaining = n;
      }
      const v3 = headers.get('X-Token-Remaining-Model');
      if (v3) {
        const n = parseInt(v3, 10);
        if (!isNaN(n)) resp.modelTokenRemaining = n;
      }
      const v4 = headers.get('X-Token-Remaining-Model-ETU');
      if (v4) {
        const n = parseInt(v4, 10);
        if (!isNaN(n)) resp.modelTokenRemainingETU = n;
      }
      return resp;
    } finally {
      ctl.dispose();
    }
  }

  // ===========================================================================
  // 媒体生成 (v1.3+) — 图片 / 视频生成托管模型 (与 chat 同网关)
  //
  // 仅对 capabilities.supports_image_generation / supports_video_generation 的模型有效。
  // 网关不算钱; 用量由网关上报营销系统结算。
  // ===========================================================================

  /** 解析 nexus-v4 {code,message,data} 信封, code!=0 抛 BusinessError, 返回 data。 */
  private unwrapAPIResponse<T>(result: Uint8Array): T {
    const env = JSON.parse(new TextDecoder().decode(result)) as APIResponse<T>;
    const bizErr = apiResponseBusinessError(env as unknown as APIResponse<unknown>);
    if (bizErr) throw bizErr;
    return env.data;
  }

  /**
   * 图片生成 (同步)。POST /managed-models/:id/images/generations
   *
   * @param modelID 图片生成托管模型 ID (capabilities.supports_image_generation=true)
   */
  async generateImage(
    modelID: string,
    req: ImageGenerationRequest,
    signal?: AbortSignal,
  ): Promise<ImageGenerationResponse> {
    const endpoint = `/managed-models/${encodeURIComponent(modelID)}/images/generations`;
    // 图片生成耗时常超 30s, 用 chat 同级超时 (11min) 容纳上游。
    const { result } = await this.doJSONFullRaw(
      'POST',
      endpoint,
      req,
      signal,
      CHAT_REQUEST_TIMEOUT_MS,
    );
    return this.unwrapAPIResponse<ImageGenerationResponse>(result);
  }

  /**
   * 创建视频生成任务 (异步)。POST /managed-models/:id/videos/generations
   * 返回 taskId; 用 pollVideoTask() 轮询直到 status=completed。
   * 上报真物理量 (视频秒数) 需在 pollVideoTask 时回传 req.duration。
   *
   * @param modelID 视频生成托管模型 ID (capabilities.supports_video_generation=true)
   */
  async generateVideo(
    modelID: string,
    req: VideoGenerationRequest,
    signal?: AbortSignal,
  ): Promise<VideoTaskResponse> {
    const endpoint = `/managed-models/${encodeURIComponent(modelID)}/videos/generations`;
    const { result } = await this.doJSONFullRaw('POST', endpoint, req, signal);
    return this.unwrapAPIResponse<VideoTaskResponse>(result);
  }

  /**
   * 轮询视频任务状态。GET /managed-models/:id/videos/tasks/:taskId
   *
   * @param durationSeconds 创建时的时长 (秒), 透传给网关在 completed 时上报用量。
   */
  async pollVideoTask(
    modelID: string,
    taskID: string,
    durationSeconds?: number,
    signal?: AbortSignal,
  ): Promise<VideoTaskResponse> {
    let endpoint = `/managed-models/${encodeURIComponent(modelID)}/videos/tasks/${encodeURIComponent(taskID)}`;
    if (durationSeconds != null && durationSeconds > 0) {
      endpoint += `?duration=${encodeURIComponent(String(durationSeconds))}`;
    }
    const { result } = await this.doJSONFullRaw('GET', endpoint, null, signal);
    return this.unwrapAPIResponse<VideoTaskResponse>(result);
  }

  /**
   * 向量 (同步)。POST /managed-models/:id/embeddings
   *
   * 仅 capabilities.supports_embedding=true 的托管模型可用 (上游接 DashScope)。
   * 响应为 OpenAI /v1/embeddings 标准格式 (网关直通, 无 response.Success 包装)。
   *
   * @param modelID 向量托管模型 ID
   */
  async embeddings(
    modelID: string,
    req: EmbeddingRequest,
    signal?: AbortSignal,
  ): Promise<EmbeddingResponse> {
    const endpoint = `/managed-models/${encodeURIComponent(modelID)}/embeddings`;
    const { result } = await this.doJSONFullRaw('POST', endpoint, req, signal, CHAT_REQUEST_TIMEOUT_MS);
    return JSON.parse(new TextDecoder().decode(result)) as EmbeddingResponse;
  }

  /**
   * 重排序 (同步)。POST /managed-models/:id/rerank
   *
   * 仅 capabilities.supports_rerank=true 的托管模型可用 (上游接 DashScope)。
   * 统一扁平契约: { query, documents[], top_n?, return_documents?, instruct? };
   * 响应 { results: [{ index, relevance_score, document? }], usage, model }
   * (网关已把上游原生/OpenAI 兼容两线路归一化, 无 response.Success 包装)。
   *
   * @param modelID 重排序托管模型 ID
   */
  async rerank(
    modelID: string,
    req: RerankRequest,
    signal?: AbortSignal,
  ): Promise<RerankResponse> {
    const endpoint = `/managed-models/${encodeURIComponent(modelID)}/rerank`;
    const { result } = await this.doJSONFullRaw('POST', endpoint, req, signal, CHAT_REQUEST_TIMEOUT_MS);
    return JSON.parse(new TextDecoder().decode(result)) as RerankResponse;
  }

  /**
   * Anthropic 原生格式同步聊天
   * v0.5.0: 根据 provider 自动路由
   *   Anthropic → chatMessagesAnthropic (现有路径, POST /anthropic)
   *   其他厂商 → chatMessagesOpenAI (POST /chat, 响应转换为 AnthropicResponse)
   */
  async chatMessages(
    modelID: string,
    req: ChatRequest,
    signal?: AbortSignal,
  ): Promise<AnthropicResponse> {
    const m = await this.ensureModelCached(modelID, signal);
    const adapter = getAdapterForModel(m);

    if (adapter.format() === ProviderFormat.Anthropic) {
      return this.chatMessagesAnthropic(modelID, req, adapter, signal);
    }
    return this.chatMessagesOpenAI(modelID, req, adapter, signal);
  }

  private async chatMessagesAnthropic(
    modelID: string,
    req: ChatRequest,
    adapter: ProviderAdapter,
    signal?: AbortSignal,
  ): Promise<AnthropicResponse> {
    // 浅拷贝避免原地 mutate 调用方传入的 req。
    const r: ChatRequest = { ...req, stream: false };
    const ctl = withRequestTimeout(CHAT_REQUEST_TIMEOUT_MS, signal);
    try {
      const caps = this.getCachedCapabilities(modelID) ?? zeroModelCapabilities();
      const body = adapter.buildRequestBody(caps, r);
      const data = JSON.stringify(body);

      const { result } = await this.doJSONFullRaw(
        'POST',
        `/managed-models/${encodeURIComponent(modelID)}/anthropic`,
        data,
        ctl.signal,
      );

      // 尝试 APIResponse 包装: {"code":0,"message":"...","data":{...}}
      const rawStr = new TextDecoder().decode(result);
      try {
        const wrapper = JSON.parse(rawStr) as { code?: number; message?: string; data?: unknown };
        if (wrapper.data != null && wrapper.data !== null) {
          const bizErr = apiResponseBusinessError({
            code: wrapper.code ?? 0,
            message: wrapper.message,
            data: wrapper.data,
          } as APIResponse<unknown>);
          if (bizErr) throw bizErr;
          return wrapper.data as AnthropicResponse;
        }
      } catch (e) {
        // 不是 wrapper 格式, fall through
        if (e && typeof e === 'object' && 'name' in e && (e as Error).name === 'BusinessError') throw e;
      }

      try {
        return JSON.parse(rawStr) as AnthropicResponse;
      } catch (e) {
        throw new Error(`decode anthropic response: ${e instanceof Error ? e.message : String(e)}`);
      }
    } finally {
      ctl.dispose();
    }
  }

  private async chatMessagesOpenAI(
    modelID: string,
    req: ChatRequest,
    adapter: ProviderAdapter,
    signal?: AbortSignal,
  ): Promise<AnthropicResponse> {
    // 浅拷贝避免原地 mutate 调用方传入的 req。
    const r: ChatRequest = { ...req, stream: false };
    const ctl = withRequestTimeout(CHAT_REQUEST_TIMEOUT_MS, signal);
    try {
      const caps = this.getCachedCapabilities(modelID) ?? zeroModelCapabilities();
      const body = adapter.buildRequestBody(caps, r);
      const data = JSON.stringify(body);

      const endpoint = `/managed-models/${encodeURIComponent(modelID)}${adapter.endpointSuffix()}`;
      const { result } = await this.doJSONFullRaw('POST', endpoint, data, ctl.signal);

      // 解析 OpenAI 格式响应并转换为 AnthropicResponse
      const { parseOpenAIResponseToAnthropic } = await import('../models/adapters/openai');
      return parseOpenAIResponseToAnthropic(result);
    } finally {
      ctl.dispose();
    }
  }

  /**
   * 流式聊天 (SSE), 通过 async generator 返回事件
   * v0.5.0: 根据 adapter 路由端点
   */
  chatStream(
    modelID: string,
    req: ChatRequest,
    signal?: AbortSignal,
  ): AsyncIterable<StreamEvent> {
    return {
      [Symbol.asyncIterator]: () => this.chatStreamGen(modelID, req, signal, false),
    };
  }

  /**
   * Anthropic 原生格式流式聊天 (SSE)
   * 调用 POST /managed-models/:id/anthropic, SSE 事件为 Anthropic 协议格式
   * 无 started/settled/failed 自定义事件, 无 data: [DONE], message_stop 为自然结束
   */
  chatMessagesStream(
    modelID: string,
    req: ChatRequest,
    signal?: AbortSignal,
  ): AsyncIterable<StreamEvent> {
    return {
      [Symbol.asyncIterator]: () => this.chatMessagesStreamGen(modelID, req, signal, false),
    };
  }

  private async *chatStreamGen(
    modelID: string,
    req: ChatRequest,
    signal: AbortSignal | undefined,
    retried: boolean,
  ): AsyncGenerator<StreamEvent, void, void> {
    // 浅拷贝避免原地 mutate 调用方传入的 req。
    const r: ChatRequest = { ...req, stream: true };
    const { body, adapter } = await this.buildChatRequest(modelID, r, signal);
    const token = await this.ensureToken(signal);

    const endpoint = `/managed-models/${encodeURIComponent(modelID)}${adapter.endpointSuffix()}`;
    const url = this.apiURL(endpoint);

    let resp: Response;
    try {
      resp = await this.fetchImpl(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
        },
        body,
        signal,
      });
    } catch (e) {
      throw classifyTransport('POST ' + endpoint, url, e);
    }

    // 401 单次重试
    if (resp.status === 401 && !retried) {
      try {
        await resp.body?.cancel();
      } catch {
        /* ignore */
      }
      try {
        await this.forceRefresh(signal);
      } catch (refreshErr) {
        throw new Error(
          `stream: unauthorized and refresh failed: ${refreshErr instanceof Error ? refreshErr.message : String(refreshErr)}`,
        );
      }
      yield* this.chatStreamGen(modelID, req, signal, true);
      return;
    }

    if (!resp.ok) {
      const bodyBytes = await readLimited(resp.body!, maxErrorBodySize);
      throw parseHTTPErrorWithHeader(resp.status, bodyBytes, resp.headers);
    }

    if (!resp.body) {
      throw new Error('stream: empty response body');
    }

    let blockTypeMap: Map<number, BlockMeta> | null = null;
    if (adapter.format() === ProviderFormat.Anthropic) {
      blockTypeMap = new Map();
    }

    let currentEvent = '';
    for await (const line of iterSSELines(resp.body)) {
      // v1.6.0: 显式跳过 SSE 注释行 (": comment", 如 ": keep-alive")
      if (isSSECommentLine(line)) continue;
      if (line.startsWith('event:')) {
        currentEvent = line.slice('event:'.length).trim();
      } else if (line.startsWith('data:')) {
        const data = line.slice('data:'.length).trim();
        const parsed = adapter.parseStreamLine(currentEvent, data);
        if (parsed.done) return;
        const ev = parsed.event;
        if (blockTypeMap) {
          const [idx, bt, eph] = extractAnthropicBlockMeta(currentEvent, data, blockTypeMap);
          if (bt !== '') {
            ev.blockIndex = idx;
            ev.blockType = bt;
            ev.ephemeral = eph;
          }
        }
        yield ev;
      }
    }
  }

  private async *chatMessagesStreamGen(
    modelID: string,
    req: ChatRequest,
    signal: AbortSignal | undefined,
    retried: boolean,
  ): AsyncGenerator<StreamEvent, void, void> {
    // 浅拷贝避免原地 mutate 调用方传入的 req。
    const r: ChatRequest = { ...req, stream: true };
    const { body, adapter } = await this.buildChatRequest(modelID, r, signal);
    const token = await this.ensureToken(signal);

    const endpoint = `/managed-models/${encodeURIComponent(modelID)}${adapter.endpointSuffix()}`;
    const url = this.apiURL(endpoint);

    let resp: Response;
    try {
      resp = await this.fetchImpl(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
        },
        body,
        signal,
      });
    } catch (e) {
      throw classifyTransport('POST ' + endpoint, url, e);
    }

    if (resp.status === 401 && !retried) {
      try {
        await resp.body?.cancel();
      } catch {
        /* ignore */
      }
      try {
        await this.forceRefresh(signal);
      } catch (refreshErr) {
        throw new Error(
          `messages stream: unauthorized and refresh failed: ${refreshErr instanceof Error ? refreshErr.message : String(refreshErr)}`,
        );
      }
      yield* this.chatMessagesStreamGen(modelID, req, signal, true);
      return;
    }

    if (!resp.ok) {
      const bodyBytes = await readLimited(resp.body!, maxErrorBodySize);
      throw parseHTTPErrorWithHeader(resp.status, bodyBytes, resp.headers);
    }

    if (!resp.body) {
      throw new Error('messages stream: empty response body');
    }

    if (adapter.format() === ProviderFormat.OpenAI) {
      // OpenAI SSE: 转换为 Anthropic 兼容事件
      const converter = newOpenAIStreamConverter();
      let _currentEvent = '';
      for await (const line of iterSSELines(resp.body)) {
        // v1.6.0: 显式跳过 SSE 注释行
        if (isSSECommentLine(line)) continue;
        if (line.startsWith('event:')) {
          _currentEvent = line.slice('event:'.length).trim();
        } else if (line.startsWith('data:')) {
          const data = line.slice('data:'.length).trim();
          const { events, done } = converter.convert(data);
          for (const ev of events) yield ev;
          if (done) return;
        }
      }
    } else {
      // Anthropic SSE: 原生事件直透 + v0.11.0 content block 元数据回填
      const blockTypeMap = new Map<number, BlockMeta>();
      let currentEvent = '';
      for await (const line of iterSSELines(resp.body)) {
        // v1.6.0: 显式跳过 SSE 注释行
        if (isSSECommentLine(line)) continue;
        if (line.startsWith('event:')) {
          currentEvent = line.slice('event:'.length).trim();
        } else if (line.startsWith('data:')) {
          const data = line.slice('data:'.length).trim();
          const ev: StreamEvent = { event: currentEvent, data };
          const [idx, bt, eph] = extractAnthropicBlockMeta(currentEvent, data, blockTypeMap);
          if (bt !== '') {
            ev.blockIndex = idx;
            ev.blockType = bt;
            ev.ephemeral = eph;
          }
          yield ev;
        }
      }
    }
  }

  /**
   * 流式聊天, 自动解析结算事件和搜索来源
   *
   * 返回单一 tagged AsyncIterable, kind 区分 4 种事件:
   *   - kind='content': 内容增量事件
   *   - kind='sources': 搜索来源
   *   - kind='settle':  结算 (token 消耗 + 剩余余额)
   *
   * Go 版本 4 channels (eventCh/sourcesCh/settleCh/errCh), 错误抛出取代 errCh。
   */
  async *chatStreamWithUsage(
    modelID: string,
    req: ChatRequest,
    signal?: AbortSignal,
  ): AsyncGenerator<
    | { kind: 'content'; event: StreamEvent }
    | { kind: 'sources'; event: SourcesEvent }
    | { kind: 'settle'; event: StreamSettlement },
    void,
    void
  > {
    for await (const ev of this.chatStream(modelID, req, signal)) {
      // 结算事件 (settled / pending_settle)
      const s = parseSettlement(ev);
      if (s) {
        yield { kind: 'settle', event: s };
        continue;
      }
      // 搜索来源事件
      const src = parseSourcesEvent(ev);
      if (src) {
        yield { kind: 'sources', event: src };
        continue;
      }
      // 控制事件: 过滤
      if (ev.event === 'started') continue;
      // 失败/错误事件: 解析错误信息抛出
      if (ev.event === 'failed' || ev.event === 'error') {
        throw parseStreamError(ev.data);
      }
      // 内容事件
      yield { kind: 'content', event: ev };
    }
  }

  // ===========================================================================
  // Internal HTTP
  // ===========================================================================

  apiURL(path: string): string {
    // apiBaseURL 覆盖 (未配置时 === serverURL, 既有行为零变化)。
    let base = this.apiBaseURL ?? this.serverURL;
    if (!base.endsWith('/api/v4')) {
      base += '/api/v4';
    }
    return base + path;
  }

  /**
   * Compliance API URL 拼接。
   *
   * `complianceBaseURL` 已配置时直接拼接；未配置时默认
   * `${serverURL}/admin-api` + path，匹配 Java compliance controller 的
   * `/compliance/...` 路径。
   *
   * 不复用 `apiURL`：apiURL 强制追加 `/api/v4`，与 compliance 路径不同。
   */
  complianceURL(path: string): string {
    const base = this.complianceBaseURL ?? this.serverURL + '/admin-api';
    return base + path;
  }

  /** GET/POST/... 通用 JSON 调用 (返回 result 已 typed) */
  async doJSON<T>(
    method: string,
    path: string,
    body: unknown | null,
    signal?: AbortSignal,
  ): Promise<T> {
    const r = await this.doJSONFull<T>(method, path, body, signal);
    return r.result;
  }

  /** 与 doJSON 相同, 但返回响应 Headers (用于提取 X-Token-Remaining 等) */
  async doJSONFull<T>(
    method: string,
    path: string,
    body: unknown | null,
    signal?: AbortSignal,
  ): Promise<{ result: T; headers: Headers }> {
    return this.doJSONFullInternal<T>(method, path, body, signal, false);
  }

  private async doJSONFullInternal<T>(
    method: string,
    path: string,
    body: unknown | null,
    signal: AbortSignal | undefined,
    retried: boolean,
  ): Promise<{ result: T; headers: Headers }> {
    const ctl = withRequestTimeout(30_000, signal);
    try {
      const token = await this.ensureToken(ctl.signal);

      let bodyStr: string | null = null;
      if (body != null) {
        bodyStr = typeof body === 'string' ? body : JSON.stringify(body);
      }

      const url = this.apiURL(path);
      const headers: Record<string, string> = {
        Authorization: `Bearer ${token}`,
      };
      if (bodyStr != null) headers['Content-Type'] = 'application/json';

      const resp = await this.doRequestWithRetry(
        { method, url, headers, body: bodyStr ?? undefined },
        ctl.signal,
      );

      if (resp.status === 401 && !retried) {
        try {
          await resp.body?.cancel();
        } catch {
          /* ignore */
        }
        try {
          await this.forceRefresh(ctl.signal);
        } catch (refreshErr) {
          throw new Error(
            `unauthorized and refresh failed: ${refreshErr instanceof Error ? refreshErr.message : String(refreshErr)}`,
          );
        }
        return this.doJSONFullInternal<T>(method, path, body, signal, true);
      }

      if (resp.status < 200 || resp.status >= 300) {
        const bodyBytes = await readLimited(resp.body!, maxErrorBodySize);
        throw parseHTTPErrorWithHeader(resp.status, bodyBytes, resp.headers);
      }

      const text = await resp.text();
      // 空 body 的成功响应 (HTTP 204 / 200 空体) — 不要 JSON.parse('') (抛 SyntaxError)。
      // 按方法返回契约返回 undefined (与 compliance executeJson 一致), 同时跳过业务码检查。
      if (!text) {
        return { result: undefined as unknown as T, headers: resp.headers };
      }
      const result = JSON.parse(text) as T;
      // 业务码检查 (APIResponse.code != 0)
      if (result && typeof result === 'object' && 'code' in result) {
        const bizErr = apiResponseBusinessError(result as unknown as APIResponse<unknown>);
        if (bizErr) throw bizErr;
      }
      return { result, headers: resp.headers };
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') {
        throw classifyTransport(`${method} ${path}`, this.apiURL(path), e);
      }
      throw e;
    } finally {
      ctl.dispose();
    }
  }

  /** doJSONFull 的 raw bytes 变体 (chat 用, 不立即 JSON.parse) */
  async doJSONFullRaw(
    method: string,
    path: string,
    body: unknown | null,
    signal?: AbortSignal,
    timeoutMs = 30_000,
  ): Promise<{ result: Uint8Array; headers: Headers }> {
    return this.doJSONFullRawInternal(method, path, body, signal, false, timeoutMs);
  }

  private async doJSONFullRawInternal(
    method: string,
    path: string,
    body: unknown | null,
    signal: AbortSignal | undefined,
    retried: boolean,
    timeoutMs = 30_000,
  ): Promise<{ result: Uint8Array; headers: Headers }> {
    const ctl = withRequestTimeout(timeoutMs, signal);
    try {
      const token = await this.ensureToken(ctl.signal);

      let bodyStr: string | null = null;
      if (body != null) {
        bodyStr = typeof body === 'string' ? body : JSON.stringify(body);
      }

      const url = this.apiURL(path);
      const headers: Record<string, string> = {
        Authorization: `Bearer ${token}`,
      };
      if (bodyStr != null) headers['Content-Type'] = 'application/json';

      const resp = await this.doRequestWithRetry(
        { method, url, headers, body: bodyStr ?? undefined },
        ctl.signal,
      );

      if (resp.status === 401 && !retried) {
        try {
          await resp.body?.cancel();
        } catch {
          /* ignore */
        }
        try {
          await this.forceRefresh(ctl.signal);
        } catch (refreshErr) {
          throw new Error(
            `unauthorized and refresh failed: ${refreshErr instanceof Error ? refreshErr.message : String(refreshErr)}`,
          );
        }
        return this.doJSONFullRawInternal(method, path, body, signal, true, timeoutMs);
      }

      if (resp.status < 200 || resp.status >= 300) {
        const bodyBytes = await readLimited(resp.body!, maxErrorBodySize);
        throw parseHTTPErrorWithHeader(resp.status, bodyBytes, resp.headers);
      }

      const buf = new Uint8Array(await resp.arrayBuffer());
      return { result: buf, headers: resp.headers };
    } finally {
      ctl.dispose();
    }
  }

  /**
   * 公共端点请求
   * 有 token 时自动附带 (享受认证用户待遇), 无 token 时匿名请求
   * 不做 401 重试 (公共端点不应要求认证)
   */
  async doPublicJSON<T>(
    method: string,
    path: string,
    body: unknown | null,
    signal?: AbortSignal,
  ): Promise<T> {
    const ctl = withRequestTimeout(30_000, signal);
    try {
      let token = '';
      try {
        token = await this.ensureToken(ctl.signal);
      } catch {
        // 公共端点允许未授权
      }

      let bodyStr: string | null = null;
      if (body != null) {
        bodyStr = typeof body === 'string' ? body : JSON.stringify(body);
      }

      const url = this.apiURL(path);
      const headers: Record<string, string> = {};
      if (token) headers['Authorization'] = `Bearer ${token}`;
      if (bodyStr != null) headers['Content-Type'] = 'application/json';

      const resp = await this.doRequestWithRetry(
        { method, url, headers, body: bodyStr ?? undefined },
        ctl.signal,
      );

      if (resp.status < 200 || resp.status >= 300) {
        const bodyBytes = await readLimited(resp.body!, maxErrorBodySize);
        throw parseHTTPErrorWithHeader(resp.status, bodyBytes, resp.headers);
      }

      const text = await resp.text();
      const result = JSON.parse(text) as T;
      if (result && typeof result === 'object' && 'code' in result) {
        const bizErr = apiResponseBusinessError(result as unknown as APIResponse<unknown>);
        if (bizErr) throw bizErr;
      }
      return result;
    } finally {
      ctl.dispose();
    }
  }

  /**
   * 给子 client (agent-runs / compliance) 用的请求超时组合器。
   *
   * 返回一个 controller, 其 `signal` 同时受默认/指定超时与外部 `parent` signal 约束 —
   * 二者任一触发都会 abort (用户传入的 signal 仍然生效)。调用方**必须**在 finally 里
   * `dispose()` 清掉定时器与监听, 否则 timer 泄漏。
   *
   * 仅用于非流式 JSON 请求; 流式 (SSE) / 下载路径不应套短超时 (会切断长连接)。
   */
  withRequestTimeout(ms: number, parent?: AbortSignal): ReqTimeoutCtl {
    return withRequestTimeout(ms, parent);
  }

  /**
   * fetch 包装 — 错误经 classifyTransport 转 NetworkError
   * 6 处原始 fetch() 全部走此 helper
   */
  async doRequest(req: { method: string; url: string; headers: Record<string, string>; body?: string }, signal?: AbortSignal): Promise<Response> {
    try {
      return await this.fetchImpl(req.url, {
        method: req.method,
        headers: req.headers,
        body: req.body,
        signal,
      });
    } catch (e) {
      throw classifyTransport(req.method + ' ' + new URL(req.url).pathname, req.url, e);
    }
  }

  /**
   * 带 RetryPolicy 的 doRequest 包装 — 仅用于同步 (非流式) 路径.
   *
   * 重试触发:
   *   - transport 层 err (NetworkError isTimeout/isEOF) → 重试
   *   - HTTP 5xx / 429 → 主动构造 HTTPError 喂给 onRetryable, 默认重试
   *   - 其他 (HTTP 2xx/3xx/4xx 非 429 / DNS / StreamError) → 不重试
   *
   * 流式路径 (chatMessagesStreamGen / chatStreamGen) **不得**调用此函数, 必须直接用 doRequest.
   */
  async doRequestWithRetry(
    req: { method: string; url: string; headers: Record<string, string>; body?: string },
    signal?: AbortSignal,
  ): Promise<Response> {
    const policy = this.retryPolicy;
    if (!policy || !policy.safeToRetry({ method: req.method, url: req.url })) {
      return this.doRequest(req, signal);
    }

    let lastErr: unknown = null;
    for (let attempt = 0; attempt < policy.maxAttempts; attempt++) {
      try {
        const resp = await this.doRequest(req, signal);
        // 仅 5xx/429 进入 retry 评估
        if (resp.status < 500 && resp.status !== 429) {
          return resp;
        }
        // 5xx 或 429 → 构造 HTTPError 喂给 onRetryable
        const bodyPeek = await readLimited(resp.body!, maxErrorBodySize);
        lastErr = parseHTTPErrorWithHeader(resp.status, bodyPeek, resp.headers);
      } catch (e) {
        lastErr = e;
      }

      if (attempt + 1 === policy.maxAttempts) break;
      if (!policy.onRetryable(lastErr)) break;

      const backoff = computeBackoff(policy, attempt, lastErr);
      await sleep(backoff, signal);
    }
    throw lastErr;
  }
}

// =============================================================================
// 内部 helpers
// =============================================================================

function defaultTokenStore(): TokenStore {
  if (typeof process !== 'undefined' && process.versions && process.versions.node) {
    try {
      return new FileTokenStore();
    } catch {
      return new InMemoryTokenStore();
    }
  }
  if (typeof globalThis.localStorage !== 'undefined') {
    try {
      return new LocalStorageTokenStore();
    } catch {
      return new InMemoryTokenStore();
    }
  }
  return new InMemoryTokenStore();
}

function isLikelyBrowserOAuthCORSError(message: string): boolean {
  const lower = message.toLowerCase();
  return (
    lower.includes('failed to fetch') ||
    lower.includes('networkerror') ||
    lower.includes('cors') ||
    lower.includes('http 403')
  );
}

function isTokenSetLike(value: unknown): value is TokenSet {
  if (value == null || typeof value !== 'object') return false;
  const candidate = value as Partial<TokenSet>;
  return (
    typeof candidate.access_token === 'string' &&
    typeof candidate.refresh_token === 'string' &&
    typeof candidate.expires_at === 'string' &&
    typeof candidate.scope === 'string' &&
    typeof candidate.client_id === 'string' &&
    typeof candidate.server_url === 'string'
  );
}

function zeroModelCapabilities(): ModelCapabilities {
  return {
    supports_thinking: false,
    supports_adaptive_thinking: false,
    supports_isp: false,
    supports_web_search: false,
    supports_tool_search: false,
    supports_structured_output: false,
    supports_effort: false,
    supports_max_effort: false,
    supports_fast_mode: false,
    supports_auto_mode: false,
    supports_1m_context: false,
    supports_prompt_cache: false,
    supports_cache_editing: false,
    supports_token_efficient: false,
    supports_redact_thinking: false,
    max_input_tokens: 0,
    max_output_tokens: 0,
    supports_desktop_visual_understanding: false,
  };
}

/**
 * 归一化上游 ManagedModel 列表中的 input_modalities (snake_case) → inputModalities (camelCase).
 *
 * 设计:
 *   - 同时存在 camelCase 与 snake_case 时, camelCase 胜 (官方契约).
 *   - 仅 snake_case 时, 拷一份到 camelCase 让 SDK 用户只读一个字段.
 *   - 都没有时不补 default ['text'], 留 undefined — 让调用方知道这是 "未声明" 而非 "明确 text-only".
 *
 * 该函数 in-place 修改并返回输入数组 (与现网调用方共享同一引用, 避免额外拷贝).
 */
function normalizeInputModalities(models: ManagedModel[]): ManagedModel[] {
  if (!Array.isArray(models)) return models;
  for (const m of models) {
    if (!m || typeof m !== 'object') continue;
    if (Array.isArray(m.inputModalities)) continue;
    const snake = (m as ManagedModel & { input_modalities?: unknown }).input_modalities;
    if (Array.isArray(snake)) {
      m.inputModalities = snake.filter(
        (v): v is 'text' | 'image' => v === 'text' || v === 'image',
      );
    }
  }
  return models;
}

export interface ReqTimeoutCtl {
  signal: AbortSignal;
  dispose(): void;
}

/** 创建组合 abort signal: 超时 + 外部 signal 任一触发都 abort. 若 parent 已有 deadline 则不覆盖. */
function withRequestTimeout(ms: number, parent?: AbortSignal): ReqTimeoutCtl {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), ms);
  let parentHandler: (() => void) | undefined;
  if (parent) {
    if (parent.aborted) {
      ctl.abort();
    } else {
      parentHandler = () => ctl.abort();
      parent.addEventListener('abort', parentHandler);
    }
  }
  return {
    signal: ctl.signal,
    dispose() {
      clearTimeout(timer);
      if (parentHandler && parent) parent.removeEventListener('abort', parentHandler);
    },
  };
}

async function sleep(ms: number, signal?: AbortSignal): Promise<void> {
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
