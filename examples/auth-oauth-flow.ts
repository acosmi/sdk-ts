// examples/auth-oauth-flow.ts — 手动 OAuth 2.1 PKCE 流程示例（CLI / 自定义流程）。
//
// 演示：
//   1. discover  — 拉取 OAuth Authorization Server 元数据 (RFC 8414)
//   2. register  — RFC 7591 动态客户端注册
//   3. authorize — 本地 loopback PKCE 授权 (Node only)，拿 authorization code
//   4. exchangeCode — 用 code + code_verifier 换 token
//   5. newTokenSet + TokenStore — 持久化 token，后续复用
//   6. refreshToken — 用 refresh_token 续期
//
// 说明：
//   - 大多数场景直接用 `client.login(appName, scopes)` 即可（内部封装了下面全部步骤）。
//     本示例演示底层 helper，适用于需要自定义授权流程 / 自管 token 的 CLI。
//   - authorize 仅在 Node 环境可用（需要本地 HTTP 回调 server）；浏览器侧应自行实现
//     popup window + redirect handler。

import {
  discover,
  register,
  authorize,
  exchangeCode,
  refreshToken,
  newTokenSet,
  tokenSetIsExpired,
  FileTokenStore,
  allScopes,
} from '@acosmi/sdk-ts';

async function main() {
  const serverURL = process.env.ACOSMI_SERVER_URL;
  if (!serverURL) {
    throw new Error('ACOSMI_SERVER_URL is required');
  }
  const scopes = allScopes();
  const store = new FileTokenStore(process.env.ACOSMI_TOKEN_FILE ?? './auth-tokens.json');

  // 0) 已有持久化 token 且未过期 → 直接复用，跳过整个授权流程。
  const existing = await store.load();
  if (existing && !tokenSetIsExpired(existing)) {
    console.log('[token] reusing valid token from store, scope=', existing.scope);
    return;
  }

  // 1) discover — OAuth Authorization Server 元数据
  const meta = await discover(serverURL);
  console.log('[discover] issuer=', meta.issuer);
  console.log('[discover] token_endpoint=', meta.token_endpoint);

  // 2) register — 动态注册一个 client，拿到 client_id
  const reg = await register(meta, 'Auth Flow Example');
  console.log('[register] client_id=', reg.client_id);

  let tokenSet;

  // 3) refresh-first：store 里有过期 token 但带 refresh_token → 先尝试静默刷新。
  if (existing && existing.refresh_token) {
    try {
      const refreshed = await refreshToken(meta, existing.client_id, existing.refresh_token);
      tokenSet = newTokenSet(refreshed, existing.client_id, serverURL);
      console.log('[refresh] token refreshed without re-authorizing');
    } catch (e) {
      console.warn('[refresh] failed, falling back to full authorize:',
        e instanceof Error ? e.message : e);
    }
  }

  // 4) 没有可刷新的 token → 走完整 PKCE 授权。
  if (!tokenSet) {
    const { result, verifier } = await authorize(meta, reg.client_id, scopes, {
      handler: (ev) => {
        if (ev.type === 'auth_url') console.log('[authorize] open in browser:', ev.url);
        if (ev.type === 'error') console.error('[authorize] error:', ev.err_code, ev.error);
      },
    });
    console.log('[authorize] received authorization code');

    // 5) exchangeCode — code + code_verifier 换 token
    const tokenResp = await exchangeCode(
      meta,
      reg.client_id,
      result.code,
      result.redirectURI,
      verifier,
    );
    tokenSet = newTokenSet(tokenResp, reg.client_id, serverURL);
    console.log('[exchange] access token acquired, scope=', tokenSet.scope);
  }

  // 6) 持久化 token，供下次启动复用 / Client 直接读取。
  await store.save(tokenSet);
  console.log('[store] token persisted; expires_at=', tokenSet.expires_at);
}

main().catch((err) => {
  console.error('auth oauth flow example failed:', err);
  process.exit(1);
});
