// auth.ts — 端口自 acosmi-sdk-go/auth.go (474 行)
//
// 跨平台 OAuth 2.1 PKCE helpers + Node-only authorize (HTTP callback server)。
// 浏览器调用 authorize 会抛错 — 浏览器侧应自行实现 popup window + redirect handler。

import type { ClientRegistration, ServerMetadata, TokenResponse, TokenSet } from './types';

/** auth 专用超时 (毫秒) — 与 Go authHTTPClient 30s 一致 */
const authTimeoutMs = 30_000;

// =============================================================================
// Discovery
// =============================================================================

/**
 * 从 well-known 端点获取 Desktop OAuth 服务元数据。
 *
 * serverURL 可能含路径 (如 "https://acosmi.ai/api/v4")，
 * well-known 端点按 RFC 8414 必须在 origin 根路径:
 *   https://acosmi.ai/.well-known/oauth-authorization-server/desktop
 */
export async function discover(serverURL: string, signal?: AbortSignal): Promise<ServerMetadata> {
  let parsed: URL;
  try {
    parsed = new URL(serverURL.replace(/\/+$/, ''));
  } catch (e) {
    throw new Error(`discover: invalid server URL: ${e instanceof Error ? e.message : String(e)}`);
  }
  const origin = `${parsed.protocol}//${parsed.host}`;
  const endpoint = `${origin}/.well-known/oauth-authorization-server/desktop`;

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

// =============================================================================
// PKCE
// =============================================================================

async function generateCodeVerifier(): Promise<string> {
  const c = await getCrypto();
  const b = new Uint8Array(32);
  c.getRandomValues(b);
  return base64urlNoPad(b);
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
  | 'ssl_proxy_detected';

export const ErrDiscovery = 'discovery_failed' as const;
export const ErrRegistration = 'registration_failed' as const;
export const ErrBrowserOpen = 'browser_open_failed' as const;
export const ErrAuthDenied = 'auth_denied' as const;
export const ErrTimeout = 'auth_timeout' as const;
export const ErrTokenExchange = 'token_exchange_failed' as const;
export const ErrSSLProxy = 'ssl_proxy_detected' as const;

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
 * 浏览器环境会抛错 — 浏览器侧应自行实现 popup window + redirect handler。
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
    let errBody: { error_description?: string } = {};
    try {
      errBody = (await resp.json()) as { error_description?: string };
    } catch {
      // ignore
    }
    throw new Error(`token: HTTP ${resp.status}: ${errBody.error_description ?? ''}`);
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
