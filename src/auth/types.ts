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
  // 非法 expires_at (空串 / 'not-a-date' / undefined) → NaN, 任何 `Date.now() > NaN`
  // 比较恒为 false, 会把坏 token 当作"未过期"长期复用。视为已过期, 触发 refresh / 重登。
  if (!Number.isFinite(expiresAt)) return true;
  return Date.now() > expiresAt - 30_000;
}

/**
 * 运行时校验任意值是否为合法 TokenSet 形状 (所有字段都是 string)。
 *
 * store 反序列化磁盘 / localStorage 的 JSON 后必须经此校验:
 * 损坏文件、旧版本残留、缺字段都会被判为无效, 由 caller 当作"无 token"重新登录,
 * 而不是把 `{}` / 缺字段对象直接 cast 成 TokenSet 后在 refresh 阶段炸出难懂的错误。
 */
export function isValidTokenSet(x: unknown): x is TokenSet {
  if (typeof x !== 'object' || x === null) return false;
  const t = x as Record<string, unknown>;
  return (
    typeof t.access_token === 'string' &&
    typeof t.refresh_token === 'string' &&
    typeof t.expires_at === 'string' &&
    typeof t.scope === 'string' &&
    typeof t.client_id === 'string' &&
    typeof t.server_url === 'string'
  );
}

/** 动态注册响应 */
export interface ClientRegistration {
  client_id: string;
  client_secret?: string;
}
