// auth/types.ts — 鉴权 / 身份域类型。
//
// 端口自 acosmi-sdk-go/types.go (v0.19.0) 的 OAuth 段。

// =============================================================================
// OAuth
// =============================================================================

/** OAuth Authorization Server 元数据 (RFC 8414) */
export interface ServerMetadata {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  revocation_endpoint: string;
  registration_endpoint: string;
  scopes_supported: string[];
}

/** OAuth token 响应 */
export interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token?: string;
  scope?: string;
}

/** 持久化 token 对 */
export interface TokenSet {
  access_token: string;
  refresh_token: string;
  /** ISO 8601 格式 */
  expires_at: string;
  scope: string;
  client_id: string;
  server_url: string;
}

/** token 是否已过期 (提前 30 秒视为过期) */
export function tokenSetIsExpired(t: TokenSet): boolean {
  const expiresAt = new Date(t.expires_at).getTime();
  return Date.now() > expiresAt - 30_000;
}

/** 动态注册响应 */
export interface ClientRegistration {
  client_id: string;
  client_secret?: string;
}
