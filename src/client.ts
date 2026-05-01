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

import {
  type AnthropicResponse,
  type ChatRequest,
  type ChatResponse,
  type ManagedModel,
  type ModelCapabilities,
  type ModelCoefficient,
  type QuotaSummary,
  type ServerMetadata,
  type SourcesEvent,
  type StreamEvent,
  type StreamSettlement,
  type TokenSet,
  ModelNotFoundError,
  apiResponseBusinessError,
  parseSettlement,
  parseSourcesEvent,
  tokenSetIsExpired,
  type APIResponse,
} from './types';
import {
  discover,
  exchangeCode,
  exchangeCodeWithExpiry,
  refreshToken,
  register,
  revokeToken,
  authorize,
  newTokenSet,
  isSSLError,
  EventComplete,
  EventError,
  ErrDiscovery,
  ErrRegistration,
  ErrSSLProxy,
  ErrTokenExchange,
  type LoginEvent,
  type LoginErrCode,
  type LoginOptions,
} from './auth';
import { type TokenStore, FileTokenStore, InMemoryTokenStore, LocalStorageTokenStore } from './store';
import { type RetryPolicy, effectivePolicy, computeBackoff } from './retry';
import {
  getAdapterForModel,
  ProviderFormat,
  type ProviderAdapter,
} from './adapters/index';
import { extractAnthropicBlockMeta, type BlockMeta } from './stream-meta';
import { newOpenAIStreamConverter } from './adapters/openai';
import {
  classifyTransport,
  iterSSELines,
  maxErrorBodySize,
  modelCacheTTLMs,
  parseHTTPErrorWithHeader,
  parseStreamError,
  readLimited,
} from './client-helpers';
import type { MinimalSanitizeConfig } from './sanitize';

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
// Config
// =============================================================================

/** 客户端配置 */
export interface Config {
  /**
   * nexus-v4 API 根地址 (默认 https://acosmi.com)。
   * SDK 自动追加 /api/v4, 无需手动拼接。
   */
  serverURL?: string;

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
}

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

  /** WebSocket 状态 (实际方法由 ws.ts mixin 维护) */
  ws: WSState | null = null;

  /** v0.15.1: token 就绪等待机制 — login 成功后 resolve, 等待方解除阻塞 */
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
    this.serverURL = (cfg.serverURL ?? 'https://acosmi.com').replace(/\/+$/, '');
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
        meta = await discover(this.serverURL, signal);
      } catch (err) {
        emitError(ErrDiscovery, err);
        throw new Error(`discovery failed: ${err instanceof Error ? err.message : String(err)}`);
      }
      this.meta = meta;

      // 2. 检查是否已有 client_id; 无则注册
      let clientID = this.getCachedClientID();
      if (clientID === '') {
        try {
          const reg = await register(meta, appName, signal);
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
          const reg = await register(meta, appName, signal);
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
          );
        } else {
          tokenResp = await exchangeCode(
            meta,
            clientID,
            result.code,
            result.redirectURI,
            verifier,
            signal,
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
          meta = await discover(this.serverURL, signal);
        } catch (e) {
          console.warn(`[acosmi-sdk] warning: discover for revocation failed: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
      if (meta) {
        try {
          await revokeToken(meta, tokens.access_token, signal);
        } catch {
          // ignore
        }
        try {
          await revokeToken(meta, tokens.refresh_token, signal);
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

    // 需要刷新 — 用 mu 串行化以防并发刷新
    return this.withMu(async () => {
      // 双检
      if (this.tokens == null) {
        throw new Error('not authorized, call login() first');
      }
      if (!tokenSetIsExpired(this.tokens)) {
        return this.tokens.access_token;
      }

      if (this.meta == null) {
        try {
          this.meta = await discover(this.serverURL, signal);
        } catch (e) {
          throw new Error(
            `discover for refresh: ${e instanceof Error ? e.message : String(e)}`,
          );
        }
      }

      let tokenResp;
      try {
        tokenResp = await refreshToken(this.meta, this.tokens.client_id, this.tokens.refresh_token, signal);
      } catch (e) {
        throw new Error(`refresh token: ${e instanceof Error ? e.message : String(e)}`);
      }

      this.tokens = newTokenSet(tokenResp, this.tokens.client_id, this.serverURL);
      try {
        await this.store.save(this.tokens);
      } catch (e) {
        console.warn(`[acosmi-sdk] warning: save refreshed token failed: ${e instanceof Error ? e.message : String(e)}`);
      }

      return this.tokens.access_token;
    });
  }

  /** 强制刷新 token (用于 401 重试) */
  async forceRefresh(signal?: AbortSignal): Promise<void> {
    return this.withMu(async () => {
      if (this.tokens == null) {
        throw new Error('no tokens to refresh');
      }
      if (this.meta == null) {
        this.meta = await discover(this.serverURL, signal);
      }
      const tokenResp = await refreshToken(
        this.meta,
        this.tokens.client_id,
        this.tokens.refresh_token,
        signal,
      );
      this.tokens = newTokenSet(tokenResp, this.tokens.client_id, this.serverURL);
      try {
        await this.store.save(this.tokens);
      } catch (e) {
        console.warn(
          `[acosmi-sdk] warning: save refreshed token failed: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    });
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

  // ===========================================================================
  // Managed Models
  // ===========================================================================

  /**
   * 获取可用的托管模型列表.
   *
   * V30 二轮审计 D-P1-2: 此方法不返回 entitlement-filter-status header.
   * UI 想根据 fallback 状态显示降级提示, 请改调 listModelsWithStatus.
   */
  async listModels(signal?: AbortSignal): Promise<ManagedModel[]> {
    const r = await this.listModelsWithStatus(signal);
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
  ): Promise<{ models: ManagedModel[]; status: FilterStatus }> {
    const { result, headers } = await this.doJSONFull<APIResponse<ManagedModel[]>>(
      'GET',
      '/managed-models',
      null,
      signal,
    );
    // 写入模型缓存
    this.modelCache = result.data;
    this.modelCacheTimeMs = Date.now();

    let status: FilterStatus = '';
    if (headers) {
      const h = headers.get('X-Entitlement-Filter-Status');
      if (h) status = h as FilterStatus;
    }
    return { models: result.data, status };
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
    req.stream = false;
    // chat 请求可能 30-120s+, 使用 5 分钟超时而非默认 30s
    const ctl = withRequestTimeout(5 * 60 * 1000, signal);
    try {
      const { body, adapter } = await this.buildChatRequest(modelID, req, ctl.signal);
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
    req.stream = false;
    const ctl = withRequestTimeout(5 * 60 * 1000, signal);
    try {
      const caps = this.getCachedCapabilities(modelID) ?? zeroModelCapabilities();
      const body = adapter.buildRequestBody(caps, req);
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
    req.stream = false;
    const ctl = withRequestTimeout(5 * 60 * 1000, signal);
    try {
      const caps = this.getCachedCapabilities(modelID) ?? zeroModelCapabilities();
      const body = adapter.buildRequestBody(caps, req);
      const data = JSON.stringify(body);

      const endpoint = `/managed-models/${encodeURIComponent(modelID)}${adapter.endpointSuffix()}`;
      const { result } = await this.doJSONFullRaw('POST', endpoint, data, ctl.signal);

      // 解析 OpenAI 格式响应并转换为 AnthropicResponse
      const { parseOpenAIResponseToAnthropic } = await import('./adapters/openai');
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
    req.stream = true;
    const { body, adapter } = await this.buildChatRequest(modelID, req, signal);
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
    req.stream = true;
    const { body, adapter } = await this.buildChatRequest(modelID, req, signal);
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
    let base = this.serverURL;
    if (!base.endsWith('/api/v4')) {
      base += '/api/v4';
    }
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
  ): Promise<{ result: Uint8Array; headers: Headers }> {
    return this.doJSONFullRawInternal(method, path, body, signal, false);
  }

  private async doJSONFullRawInternal(
    method: string,
    path: string,
    body: unknown | null,
    signal: AbortSignal | undefined,
    retried: boolean,
  ): Promise<{ result: Uint8Array; headers: Headers }> {
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
        return this.doJSONFullRawInternal(method, path, body, signal, true);
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
  };
}

interface ReqTimeoutCtl {
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

