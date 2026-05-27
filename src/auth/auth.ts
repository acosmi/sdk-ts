// auth.ts — 端口自 acosmi-sdk-go/auth.go (474 行)
//
// 跨平台 OAuth 2.1 PKCE helpers + Node-only loopback authorize (HTTP callback server)。
//
// 浏览器侧 (v1.4.0+): authorize() 会抛错 (无 loopback HTTP server), 改用同文件内的
// Web OAuth 原语 — discoverWebOAuthMetadata / registerWebOAuthClient /
// createWebAuthorizationRequest / completeWebAuthorizationRequest。由调用方实现
// popup / 同窗口 redirect handler, SDK 负责 PKCE / state 校验 / token 兑换。

import type { ClientRegistration, ServerMetadata, TokenResponse, TokenSet } from './types';

/** auth 专用超时 (毫秒) — 与 Go authHTTPClient 30s 一致 */
const authTimeoutMs = 30_000;

export class OAuthTokenEndpointError extends Error {
  readonly status: number;
  readonly oauthError: string;
  readonly errorDescription: string;

  constructor(status: number, oauthError: string, errorDescription: string) {
    super(`token: HTTP ${status}: ${errorDescription || oauthError}`);
    this.name = 'OAuthTokenEndpointError';
    this.status = status;
    this.oauthError = oauthError;
    this.errorDescription = errorDescription;
  }
}

export function isInvalidGrantError(err: unknown): boolean {
  return err instanceof OAuthTokenEndpointError && err.oauthError === 'invalid_grant';
}

// =============================================================================
// Discovery
// =============================================================================

/** OAuth metadata profile — 决定 well-known 端点的路径后缀 */
export type OAuthMetadataProfile = 'web' | 'desktop';

/**
 * 从 well-known 端点获取指定 profile 的 OAuth 服务元数据。
 *
 * serverURL 可能含路径 (如 "https://acosmi.ai/api/v4")，
 * well-known 端点按 RFC 8414 必须在 origin 根路径:
 *   https://acosmi.ai/.well-known/oauth-authorization-server/<profile>
 *
 * profile='desktop' 对应桌面 loopback OAuth；profile='web' 对应浏览器 Web OAuth。
 * 内部 helper — `discover` / `discoverWebOAuthMetadata` 是其薄包装。
 */
export async function discoverWithProfile(
  serverURL: string,
  profile: OAuthMetadataProfile,
  signal?: AbortSignal,
): Promise<ServerMetadata> {
  let parsed: URL;
  try {
    parsed = new URL(serverURL.replace(/\/+$/, ''));
  } catch (e) {
    throw new Error(`discover: invalid server URL: ${e instanceof Error ? e.message : String(e)}`);
  }
  const origin = `${parsed.protocol}//${parsed.host}`;
  const endpoint = `${origin}/.well-known/oauth-authorization-server/${profile}`;

  const ctl = withTimeout(authTimeoutMs, signal);
  let resp: Response;
  try {
    resp = await fetch(endpoint, { method: 'GET', signal: ctl.signal });
  } catch (e) {
    throw new Error(`discover: ${e instanceof Error ? e.message : String(e)}`);
  } finally {
    ctl.dispose();
  }

  if (!resp.ok) {
    throw new Error(`discover: HTTP ${resp.status}`);
  }

  let meta: ServerMetadata;
  try {
    meta = (await resp.json()) as ServerMetadata;
  } catch (e) {
    throw new Error(`discover: decode: ${e instanceof Error ? e.message : String(e)}`);
  }

  // 校验关键字段非空
  if (!meta.token_endpoint || !meta.authorization_endpoint) {
    throw new Error(
      `discover: metadata missing required endpoints (token=${meta.token_endpoint ?? ''}, auth=${meta.authorization_endpoint ?? ''})`,
    );
  }

  return meta;
}

/**
 * 从 well-known 端点获取 Desktop OAuth 服务元数据。
 *
 * serverURL 可能含路径 (如 "https://acosmi.ai/api/v4")，
 * well-known 端点按 RFC 8414 必须在 origin 根路径:
 *   https://acosmi.ai/.well-known/oauth-authorization-server/desktop
 */
export async function discover(serverURL: string, signal?: AbortSignal): Promise<ServerMetadata> {
  return discoverWithProfile(serverURL, 'desktop', signal);
}

/**
 * 从 well-known 端点获取 Web OAuth 服务元数据。
 *
 * 与 `discover` 行为一致, 但请求路径为
 *   https://acosmi.com/.well-known/oauth-authorization-server/web
 *
 * 浏览器侧 Web OAuth (csign 等第一方 Web 应用) 必须用此 profile，
 * 它返回 Web authorize/token 端点; `discover` 的 desktop profile 返回的是
 * 桌面 loopback 端点, 不可混用。
 */
export async function discoverWebOAuthMetadata(
  serverURL: string,
  signal?: AbortSignal,
): Promise<ServerMetadata> {
  return discoverWithProfile(serverURL, 'web', signal);
}

// =============================================================================
// Dynamic Client Registration (RFC 7591)
// =============================================================================

/** 动态注册桌面客户端，获取 client_id */
export async function register(
  meta: ServerMetadata,
  appName: string,
  signal?: AbortSignal,
): Promise<ClientRegistration> {
  const regReq = {
    client_name: appName,
    token_endpoint_auth_method: 'none',
    grant_types: ['authorization_code', 'refresh_token'],
    redirect_uris: ['http://127.0.0.1/callback'],
    response_types: ['code'],
  };

  const ctl = withTimeout(authTimeoutMs, signal);
  let resp: Response;
  try {
    resp = await fetch(meta.registration_endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(regReq),
      signal: ctl.signal,
    });
  } catch (e) {
    throw new Error(`register: ${e instanceof Error ? e.message : String(e)}`);
  } finally {
    ctl.dispose();
  }

  if (resp.status !== 200 && resp.status !== 201) {
    throw new Error(`register: HTTP ${resp.status}`);
  }

  try {
    return (await resp.json()) as ClientRegistration;
  } catch (e) {
    throw new Error(`register: decode: ${e instanceof Error ? e.message : String(e)}`);
  }
}

/** Web OAuth 动态注册参数 */
export interface RegisterWebOAuthClientOptions {
  /** 客户端展示名 (RFC 7591 client_name) */
  clientName: string;
  /** 浏览器 Web OAuth 的 redirect_uri 列表 (如 ["https://sign.zhonglvbao.com/login/callback"]) */
  redirectURIs: string[];
  /** 可选 scope 列表 — 提供时以空格连接写入 RFC 7591 scope 字段 */
  scopes?: string[];
}

/**
 * 动态注册 Web OAuth (浏览器) 客户端，获取 client_id。
 *
 * 与 `register` (桌面 loopback, 硬编码 redirect_uri=127.0.0.1) 的区别:
 * 本函数允许传入任意 Web redirect_uri，供 csign 等第一方 Web 应用使用。
 * `token_endpoint_auth_method` 仍为 `none` (PKCE public client)。
 */
export async function registerWebOAuthClient(
  meta: ServerMetadata,
  opts: RegisterWebOAuthClientOptions,
  signal?: AbortSignal,
): Promise<ClientRegistration> {
  const regReq = {
    client_name: opts.clientName,
    token_endpoint_auth_method: 'none',
    grant_types: ['authorization_code', 'refresh_token'],
    redirect_uris: opts.redirectURIs,
    response_types: ['code'],
    ...(opts.scopes ? { scope: opts.scopes.join(' ') } : {}),
  };

  const ctl = withTimeout(authTimeoutMs, signal);
  let resp: Response;
  try {
    resp = await fetch(meta.registration_endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(regReq),
      signal: ctl.signal,
    });
  } catch (e) {
    throw new Error(`register: ${e instanceof Error ? e.message : String(e)}`);
  } finally {
    ctl.dispose();
  }

  if (resp.status !== 200 && resp.status !== 201) {
    throw new Error(`register: HTTP ${resp.status}`);
  }

  try {
    return (await resp.json()) as ClientRegistration;
  } catch (e) {
    throw new Error(`register: decode: ${e instanceof Error ? e.message : String(e)}`);
  }
}

// =============================================================================
// PKCE
// =============================================================================

/** 生成 32 字节加密随机数，base64url 无填充编码 — PKCE verifier / state 共用随机源 */
async function randomBase64Url32(): Promise<string> {
  const c = await getCrypto();
  const b = new Uint8Array(32);
  c.getRandomValues(b);
  return base64urlNoPad(b);
}

async function generateCodeVerifier(): Promise<string> {
  return randomBase64Url32();
}

/**
 * 生成 OAuth `state` 参数 — 32 字节加密随机数, base64url 无填充。
 *
 * 与 `generateCodeVerifier` 共用随机源 (`randomBase64Url32`)。Web OAuth 流程
 * 用它做 CSRF 防护: 授权请求带上 state, callback 回来必须逐字符比对。
 */
export async function generateState(): Promise<string> {
  return randomBase64Url32();
}

async function codeChallenge(verifier: string): Promise<string> {
  const c = await getCrypto();
  const buf = await c.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return base64urlNoPad(new Uint8Array(buf));
}

async function getCrypto(): Promise<Crypto> {
  if (typeof globalThis.crypto !== 'undefined' && globalThis.crypto.subtle) {
    return globalThis.crypto;
  }
  // Node ≤18 fallback (Node 19+ 自带 globalThis.crypto)
  const nodeCrypto = await import('node:crypto');
  return nodeCrypto.webcrypto as unknown as Crypto;
}

function base64urlNoPad(b: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < b.length; i++) bin += String.fromCharCode(b[i]!);
  let s: string;
  if (typeof btoa === 'function') {
    s = btoa(bin);
  } else {
    // Node fallback
    s = Buffer.from(b).toString('base64');
  }
  return s.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// =============================================================================
// LoginWithHandler 事件模型
// =============================================================================

export type LoginEventType = 'auth_url' | 'complete' | 'error';

export const EventAuthURL = 'auth_url' as const;
export const EventComplete = 'complete' as const;
export const EventError = 'error' as const;

export type LoginErrCode =
  | 'discovery_failed'
  | 'registration_failed'
  | 'browser_open_failed'
  | 'auth_denied'
  | 'auth_timeout'
  | 'token_exchange_failed'
  | 'ssl_proxy_detected'
  | 'state_mismatch';

export const ErrDiscovery = 'discovery_failed' as const;
export const ErrRegistration = 'registration_failed' as const;
export const ErrBrowserOpen = 'browser_open_failed' as const;
export const ErrAuthDenied = 'auth_denied' as const;
export const ErrTimeout = 'auth_timeout' as const;
export const ErrTokenExchange = 'token_exchange_failed' as const;
export const ErrSSLProxy = 'ssl_proxy_detected' as const;
/** Web OAuth callback 的 state 与发起时不一致 (CSRF 防护) */
export const ErrStateMismatch = 'state_mismatch' as const;

/** 登录流程事件 */
export interface LoginEvent {
  type: LoginEventType;
  url?: string;
  error?: string;
  err_code?: LoginErrCode;
}

/** 登录选项 (函数选项模式 → TS options object) */
export interface LoginOptions {
  /** 跳过自动打开浏览器 (由调用方控制浏览器) */
  skipBrowser?: boolean;
  /** SSO 场景下的 email 预填 */
  loginHint?: string;
  /** 如 "sso" */
  loginMethod?: string;
  /** 强制组织登录 */
  orgUUID?: string;
  /** 自定义 token 有效期 (秒) */
  expiresIn?: number;
}

/** 检测 SSL/TLS 相关错误 (企业代理 Zscaler 等) */
export function isSSLError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.includes('tls:') || msg.includes('x509:') || msg.includes('certificate');
}

// =============================================================================
// authorize (Node-only)
// =============================================================================

export interface AuthorizeResult {
  code: string;
  redirectURI: string;
}

/**
 * 执行 OAuth 2.1 PKCE 授权流程 (Node only):
 *   1. 启动本地 HTTP server
 *   2. 打开浏览器让用户登录并授权
 *   3. 接收回调拿到 authorization code
 *   4. 返回 code 供后续 token 交换
 *
 * 浏览器环境会抛错 (无 loopback HTTP server)。
 * 浏览器侧 (v1.4.0+) 请改用本文件下方的 Web OAuth 原语：
 *   createWebAuthorizationRequest + completeWebAuthorizationRequest
 *   (SDK 负责 PKCE / state 校验; popup / redirect handler 由调用方实现)
 */
export async function authorize(
  meta: ServerMetadata,
  clientID: string,
  scopes: string[],
  opts: LoginOptions & { handler?: (e: LoginEvent) => void; signal?: AbortSignal } = {},
): Promise<{ result: AuthorizeResult; verifier: string }> {
  if (typeof process === 'undefined' || !process.versions || !process.versions.node) {
    throw new Error('authorize requires Node.js environment (HTTP callback server)');
  }
  const handler = opts.handler;
  const signal = opts.signal;
  const emit = (e: LoginEvent) => {
    if (handler) handler(e);
  };

  const verifier = await generateCodeVerifier();
  const challenge = await codeChallenge(verifier);

  const http = await import('node:http');

  // 启动本地 callback server
  const server = http.createServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const addr = server.address() as { port: number };
  const port = addr.port;
  const redirectURI = `http://127.0.0.1:${port}/callback`;

  let codeResolver!: (code: string) => void;
  let codeRejecter!: (err: Error) => void;
  const codePromise = new Promise<string>((resolve, reject) => {
    codeResolver = resolve;
    codeRejecter = reject;
  });

  server.on('request', (req, res) => {
    const url = new URL(req.url ?? '/', `http://127.0.0.1:${port}`);
    if (url.pathname !== '/callback') {
      res.statusCode = 404;
      res.end();
      return;
    }
    const code = url.searchParams.get('code');
    if (!code) {
      const errMsg =
        url.searchParams.get('error_description') || url.searchParams.get('error') || '';
      const escaped = htmlEscape(errMsg);
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.end(
        `<!DOCTYPE html><html><head><meta charset="utf-8"><title>授权失败</title></head>` +
          `<body style="font-family:system-ui,sans-serif;text-align:center;padding:60px 20px">` +
          `<h2>授权失败</h2><p>${escaped}</p>` +
          `<p style="color:#888;font-size:14px">可以关闭此窗口。</p>` +
          `</body></html>`,
      );
      codeRejecter(new Error(`authorization denied: ${errMsg}`));
      return;
    }
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(
      `<!DOCTYPE html><html><head><meta charset="utf-8"><title>授权成功</title></head>` +
        `<body style="font-family:system-ui,sans-serif;text-align:center;padding:60px 20px">` +
        `<h2>授权成功</h2>` +
        `<p>已完成身份认证, 请返回应用继续使用。</p>` +
        `<p style="color:#888;font-size:14px">此窗口将在 3 秒后自动关闭…</p>` +
        `<script>setTimeout(function(){window.close()},3000)</script>` +
        `</body></html>`,
    );
    codeResolver(code);
  });

  // 构造授权 URL
  const authURL = new URL(meta.authorization_endpoint);
  authURL.searchParams.set('client_id', clientID);
  authURL.searchParams.set('redirect_uri', redirectURI);
  authURL.searchParams.set('response_type', 'code');
  authURL.searchParams.set('code_challenge', challenge);
  authURL.searchParams.set('code_challenge_method', 'S256');
  if (scopes.length > 0) {
    authURL.searchParams.set('scope', scopes.join(' '));
  }
  if (opts.loginHint) authURL.searchParams.set('login_hint', opts.loginHint);
  if (opts.loginMethod) authURL.searchParams.set('login_method', opts.loginMethod);
  if (opts.orgUUID) authURL.searchParams.set('orgUUID', opts.orgUUID);

  emit({ type: EventAuthURL, url: authURL.toString() });

  if (!opts.skipBrowser) {
    try {
      await openBrowser(authURL.toString());
    } catch (e) {
      // 浏览器打不开不阻塞 — 用户可通过 URL 手动打开
      emit({
        type: EventError,
        err_code: ErrBrowserOpen,
        url: authURL.toString(),
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  let abortHandler: (() => void) | undefined;
  try {
    const code = await Promise.race<string>([
      codePromise,
      new Promise<string>((_, reject) => {
        if (signal) {
          if (signal.aborted) {
            reject(new Error('authorization timed out'));
            return;
          }
          abortHandler = () => reject(new Error('authorization timed out'));
          signal.addEventListener('abort', abortHandler);
        }
      }),
    ]);
    return { result: { code, redirectURI }, verifier };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes('denied')) {
      emit({ type: EventError, err_code: ErrAuthDenied, error: msg });
    } else if (msg.includes('timed out')) {
      emit({ type: EventError, err_code: ErrTimeout, error: msg });
    } else {
      emit({ type: EventError, err_code: ErrTokenExchange, error: msg });
    }
    throw e;
  } finally {
    if (abortHandler && signal) signal.removeEventListener('abort', abortHandler);
    server.close();
  }
}

function htmlEscape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// =============================================================================
// Web OAuth (浏览器整页重定向流程)
// =============================================================================

/**
 * Web OAuth 授权请求 — `createWebAuthorizationRequest` 的返回结构。
 *
 * 发起方 (csign Next Route Handler 等) 应把整个对象作为 pending 状态持久化
 * (HttpOnly cookie 等)，callback 回来时取出供 `completeWebAuthorizationRequest` 校验。
 */
export interface WebAuthorizationRequest {
  /** 完整授权 URL — 浏览器整页跳转到此地址 */
  authUrl: string;
  /** CSRF state — callback 必须回传同值 */
  state: string;
  /** PKCE code_verifier — 换 token 时使用, 切勿泄露给浏览器 URL */
  verifier: string;
  /** 动态注册得到的 client_id */
  clientID: string;
  /** 本次授权使用的 redirect_uri */
  redirectURI: string;
  /** OAuth issuer / SDK 业务域名 (用于 callback 阶段重新发现 metadata) */
  serverURL: string;
  /** 创建时间戳 (Date.now())，发起方可据此实现 TTL 过期判定 */
  createdAt: number;
}

/** `createWebAuthorizationRequest` 参数 */
export interface CreateWebAuthorizationRequestOptions {
  /** 动态注册得到的 client_id */
  clientID: string;
  /** redirect_uri (须与动态注册登记的一致) */
  redirectURI: string;
  /** 请求的 scope 列表 — 以空格连接写入 authUrl */
  scopes: string[];
  /** OAuth issuer / SDK 业务域名 */
  serverURL: string;
  /** 可选 — SSO 场景下预填邮箱 */
  loginHint?: string;
}

/**
 * 构造 Web OAuth 授权请求。
 *
 * 生成 PKCE verifier + S256 challenge + CSRF state，按 OAuth 2.1 拼装授权 URL
 * (含 `state` 参数 — SDK 桌面 `authorize` 不带 state, Web 流程必须带)。
 *
 * 返回的 `WebAuthorizationRequest` 应整体持久化为 pending 状态，
 * callback 阶段交给 `completeWebAuthorizationRequest`。
 */
export async function createWebAuthorizationRequest(
  meta: ServerMetadata,
  opts: CreateWebAuthorizationRequestOptions,
): Promise<WebAuthorizationRequest> {
  const verifier = await generateCodeVerifier();
  const challenge = await codeChallenge(verifier);
  const state = await generateState();

  const authURL = new URL(meta.authorization_endpoint);
  authURL.searchParams.set('response_type', 'code');
  authURL.searchParams.set('client_id', opts.clientID);
  authURL.searchParams.set('redirect_uri', opts.redirectURI);
  authURL.searchParams.set('code_challenge', challenge);
  authURL.searchParams.set('code_challenge_method', 'S256');
  authURL.searchParams.set('state', state);
  authURL.searchParams.set('scope', opts.scopes.join(' '));
  if (opts.loginHint) {
    authURL.searchParams.set('login_hint', opts.loginHint);
  }

  return {
    authUrl: authURL.toString(),
    state,
    verifier,
    clientID: opts.clientID,
    redirectURI: opts.redirectURI,
    serverURL: opts.serverURL,
    createdAt: Date.now(),
  };
}

/** `completeWebAuthorizationRequest` 的 pending 状态 (即 WebAuthorizationRequest 的子集) */
export interface WebAuthorizationPending {
  state: string;
  verifier: string;
  clientID: string;
  redirectURI: string;
  serverURL: string;
}

/** `completeWebAuthorizationRequest` 的 callback 参数 */
export interface WebAuthorizationCallbackParams {
  /** 授权服务器回传的 authorization code */
  code: string;
  /** 授权服务器回传的 state — 必须与 pending.state 一致 */
  state: string;
}

/**
 * 完成 Web OAuth 授权 — 校验 state → 换 token → 返回可持久化的 TokenSet。
 *
 * `pending` 为 `createWebAuthorizationRequest` 返回对象 (或其等价持久化结构);
 * `params` 为 callback URL 解析出的 `code` / `state`。
 *
 * state 不匹配时抛错 (CSRF 防护)。内部依次:
 *   discoverWebOAuthMetadata(pending.serverURL) → exchangeCode(...) → newTokenSet(...)。
 */
export async function completeWebAuthorizationRequest(
  pending: WebAuthorizationPending,
  params: WebAuthorizationCallbackParams,
  signal?: AbortSignal,
): Promise<TokenSet> {
  if (!params.code) {
    throw new Error('completeWebAuthorizationRequest: missing authorization code');
  }
  if (params.state !== pending.state) {
    throw new Error(
      `completeWebAuthorizationRequest: ${ErrStateMismatch}: callback state does not match pending state (possible CSRF)`,
    );
  }

  const meta = await discoverWebOAuthMetadata(pending.serverURL, signal);
  const resp = await exchangeCode(
    meta,
    pending.clientID,
    params.code,
    pending.redirectURI,
    pending.verifier,
    signal,
  );
  return newTokenSet(resp, pending.clientID, pending.serverURL);
}

// =============================================================================
// Token Exchange
// =============================================================================

export async function exchangeCode(
  meta: ServerMetadata,
  clientID: string,
  code: string,
  redirectURI: string,
  codeVerifier: string,
  signal?: AbortSignal,
): Promise<TokenResponse> {
  const data = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: clientID,
    code,
    redirect_uri: redirectURI,
    code_verifier: codeVerifier,
  });
  return postToken(meta.token_endpoint, data, signal);
}

/** 与 exchangeCode 相同, 但附带 expires_in 参数 (setup-token 模式) */
export async function exchangeCodeWithExpiry(
  meta: ServerMetadata,
  clientID: string,
  code: string,
  redirectURI: string,
  codeVerifier: string,
  expiresIn: number,
  signal?: AbortSignal,
): Promise<TokenResponse> {
  const data = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: clientID,
    code,
    redirect_uri: redirectURI,
    code_verifier: codeVerifier,
    expires_in: String(expiresIn),
  });
  return postToken(meta.token_endpoint, data, signal);
}

/** 刷新 access_token */
export async function refreshToken(
  meta: ServerMetadata,
  clientID: string,
  refreshTokenValue: string,
  signal?: AbortSignal,
): Promise<TokenResponse> {
  const data = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: clientID,
    refresh_token: refreshTokenValue,
  });
  return postToken(meta.token_endpoint, data, signal);
}

/** 吊销 token. 服务端不支持吊销时静默跳过. */
export async function revokeToken(
  meta: ServerMetadata,
  token: string,
  signal?: AbortSignal,
): Promise<void> {
  if (!meta.revocation_endpoint || meta.revocation_endpoint === '') {
    return;
  }
  const data = new URLSearchParams({ token });

  const ctl = withTimeout(authTimeoutMs, signal);
  try {
    await fetch(meta.revocation_endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: data,
      signal: ctl.signal,
    });
  } catch (e) {
    throw new Error(`revoke: ${e instanceof Error ? e.message : String(e)}`);
  } finally {
    ctl.dispose();
  }
}

async function postToken(
  endpoint: string,
  data: URLSearchParams,
  signal?: AbortSignal,
): Promise<TokenResponse> {
  const ctl = withTimeout(authTimeoutMs, signal);
  let resp: Response;
  try {
    resp = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: data,
      signal: ctl.signal,
    });
  } catch (e) {
    throw new Error(`token request: ${e instanceof Error ? e.message : String(e)}`);
  } finally {
    ctl.dispose();
  }

  if (!resp.ok) {
    let errBody: { error?: unknown; error_description?: unknown } = {};
    try {
      errBody = (await resp.json()) as { error?: unknown; error_description?: unknown };
    } catch {
      // ignore
    }
    const oauthError = typeof errBody.error === 'string' ? errBody.error : '';
    const errorDescription =
      typeof errBody.error_description === 'string' ? errBody.error_description : '';
    throw new OAuthTokenEndpointError(resp.status, oauthError, errorDescription);
  }

  try {
    return (await resp.json()) as TokenResponse;
  } catch (e) {
    throw new Error(`token: decode: ${e instanceof Error ? e.message : String(e)}`);
  }
}

/**
 * 从 TokenResponse 构造可持久化的 TokenSet
 *
 * 根因修复 #14: expires_in=0 会导致 token 立即过期 → 无限刷新循环
 * 最少保证 60 秒有效期
 */
export function newTokenSet(resp: TokenResponse, clientID: string, serverURL: string): TokenSet {
  let expiresIn = resp.expires_in;
  if (expiresIn < 60) expiresIn = 60;
  return {
    access_token: resp.access_token,
    refresh_token: resp.refresh_token ?? '',
    expires_at: new Date(Date.now() + expiresIn * 1000).toISOString(),
    scope: resp.scope ?? '',
    client_id: clientID,
    server_url: serverURL,
  };
}

// =============================================================================
// Browser launch (Node-only)
// =============================================================================

async function openBrowser(url: string): Promise<void> {
  const { spawn } = await import('node:child_process');
  let cmd: string;
  let args: string[];
  switch (process.platform) {
    case 'darwin':
      cmd = 'open';
      args = [url];
      break;
    case 'linux':
      cmd = 'xdg-open';
      args = [url];
      break;
    case 'win32':
      cmd = 'rundll32';
      args = ['url.dll,FileProtocolHandler', url];
      break;
    default:
      throw new Error(`unsupported platform: ${process.platform}`);
  }
  return new Promise<void>((resolve, reject) => {
    try {
      const child = spawn(cmd, args, { detached: true, stdio: 'ignore' });
      child.on('error', reject);
      child.unref();
      resolve();
    } catch (e) {
      reject(e);
    }
  });
}

// =============================================================================
// Helpers
// =============================================================================

interface TimeoutController {
  signal: AbortSignal;
  dispose: () => void;
}

/** 创建一个组合 abort signal: 超时 + 外部 signal 任一触发都 abort */
function withTimeout(ms: number, parent?: AbortSignal): TimeoutController {
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
