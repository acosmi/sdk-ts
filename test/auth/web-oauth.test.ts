// web-oauth.test.ts — Phase A: SDK Web OAuth 原语回归
//
// 覆盖:
//   - discoverWebOAuthMetadata 打 /web well-known 端点
//   - discover 仍打 /desktop (回归)
//   - registerWebOAuthClient POST 自定义 redirect_uris + token_endpoint_auth_method='none'
//   - createWebAuthorizationRequest 生成 S256 challenge + 非空 state + PKCE verifier
//   - completeWebAuthorizationRequest state mismatch 抛错; 匹配则换 token 返回 TokenSet
//   - Client(oauthMetadataProfile:'web') 全 token-lifecycle discovery (ensureToken
//     refresh / forceRefresh / logout 吊销) 走 /web; 不配则走 /desktop
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  discover,
  discoverWebOAuthMetadata,
  registerWebOAuthClient,
  createWebAuthorizationRequest,
  completeWebAuthorizationRequest,
  Client,
  InMemoryTokenStore,
  type ServerMetadata,
  type TokenSet,
} from '../../src';

let realFetch: typeof globalThis.fetch;

const fakeMeta: ServerMetadata = {
  issuer: 'https://acosmi.com',
  authorization_endpoint: 'https://acosmi.com/oauth/authorize',
  token_endpoint: 'https://acosmi.com/oauth/token',
  revocation_endpoint: 'https://acosmi.com/oauth/revoke',
  registration_endpoint: 'https://acosmi.com/oauth/register',
  scopes_supported: ['ai', 'compliance:reports:read'],
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

beforeEach(() => {
  realFetch = globalThis.fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe('discoverWebOAuthMetadata', () => {
  it('requests the /web well-known path', async () => {
    const seenUrls: string[] = [];
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      seenUrls.push(url);
      return jsonResponse(fakeMeta);
    }) as typeof fetch;

    const meta = await discoverWebOAuthMetadata('https://acosmi.com');
    expect(meta.token_endpoint).toBe('https://acosmi.com/oauth/token');
    expect(seenUrls).toHaveLength(1);
    expect(seenUrls[0]).toBe(
      'https://acosmi.com/.well-known/oauth-authorization-server/web',
    );
    expect(seenUrls[0]!.endsWith('/.well-known/oauth-authorization-server/web')).toBe(true);
  });

  it('strips trailing path/slash and uses origin (RFC 8414)', async () => {
    const seenUrls: string[] = [];
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      seenUrls.push(typeof input === 'string' ? input : input.toString());
      return jsonResponse(fakeMeta);
    }) as typeof fetch;

    await discoverWebOAuthMetadata('https://acosmi.com/api/v4/');
    expect(seenUrls[0]).toBe(
      'https://acosmi.com/.well-known/oauth-authorization-server/web',
    );
  });

  it('throws when metadata missing required endpoints (validation not weakened)', async () => {
    globalThis.fetch = vi.fn(async () =>
      jsonResponse({ issuer: 'https://acosmi.com' }),
    ) as typeof fetch;
    await expect(discoverWebOAuthMetadata('https://acosmi.com')).rejects.toThrow(
      /missing required endpoints/,
    );
  });
});

describe('discover (desktop) regression', () => {
  it('still requests the /desktop well-known path', async () => {
    const seenUrls: string[] = [];
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      seenUrls.push(typeof input === 'string' ? input : input.toString());
      return jsonResponse(fakeMeta);
    }) as typeof fetch;

    await discover('https://acosmi.com');
    expect(seenUrls).toHaveLength(1);
    expect(seenUrls[0]).toBe(
      'https://acosmi.com/.well-known/oauth-authorization-server/desktop',
    );
  });
});

describe('registerWebOAuthClient', () => {
  it('POSTs custom redirect_uris and token_endpoint_auth_method=none', async () => {
    let seenBody: Record<string, unknown> = {};
    let seenUrl = '';
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      seenUrl = typeof input === 'string' ? input : input.toString();
      seenBody = JSON.parse((init?.body as string) ?? '{}');
      return jsonResponse({ client_id: 'web-client-123' }, 201);
    }) as typeof fetch;

    const reg = await registerWebOAuthClient(fakeMeta, {
      clientName: 'csign Web',
      redirectURIs: ['https://sign.zhonglvbao.com/login/callback'],
      scopes: ['compliance:reports:read', 'compliance:timestamp:create'],
    });

    expect(reg.client_id).toBe('web-client-123');
    expect(seenUrl).toBe('https://acosmi.com/oauth/register');
    expect(seenBody['client_name']).toBe('csign Web');
    expect(seenBody['token_endpoint_auth_method']).toBe('none');
    expect(seenBody['redirect_uris']).toEqual([
      'https://sign.zhonglvbao.com/login/callback',
    ]);
    expect(seenBody['grant_types']).toEqual(['authorization_code', 'refresh_token']);
    expect(seenBody['response_types']).toEqual(['code']);
    expect(seenBody['scope']).toBe(
      'compliance:reports:read compliance:timestamp:create',
    );
  });

  it('omits scope field when scopes not provided', async () => {
    let seenBody: Record<string, unknown> = {};
    globalThis.fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      seenBody = JSON.parse((init?.body as string) ?? '{}');
      return jsonResponse({ client_id: 'web-client-456' }, 200);
    }) as typeof fetch;

    await registerWebOAuthClient(fakeMeta, {
      clientName: 'csign Web',
      redirectURIs: ['https://sign.zhonglvbao.com/login/callback'],
    });
    expect('scope' in seenBody).toBe(false);
  });

  it('accepts HTTP 200 as well as 201', async () => {
    globalThis.fetch = vi.fn(async () =>
      jsonResponse({ client_id: 'web-client-200' }, 200),
    ) as typeof fetch;
    const reg = await registerWebOAuthClient(fakeMeta, {
      clientName: 'csign Web',
      redirectURIs: ['https://sign.zhonglvbao.com/login/callback'],
    });
    expect(reg.client_id).toBe('web-client-200');
  });

  it('throws on non-2xx registration response', async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response('forbidden', { status: 403 }),
    ) as typeof fetch;
    await expect(
      registerWebOAuthClient(fakeMeta, {
        clientName: 'csign Web',
        redirectURIs: ['https://sign.zhonglvbao.com/login/callback'],
      }),
    ).rejects.toThrow(/HTTP 403/);
  });
});

describe('createWebAuthorizationRequest', () => {
  it('produces an authUrl with S256 challenge, non-empty state echoed in result, and PKCE verifier', async () => {
    const req = await createWebAuthorizationRequest(fakeMeta, {
      clientID: 'web-client-123',
      redirectURI: 'https://sign.zhonglvbao.com/login/callback',
      scopes: ['compliance:reports:read', 'compliance:timestamp:create'],
      serverURL: 'https://acosmi.com',
    });

    expect(req.state).toBeTruthy();
    expect(req.state.length).toBeGreaterThan(0);
    expect(req.verifier).toBeTruthy();
    expect(req.verifier.length).toBeGreaterThan(0);
    expect(req.clientID).toBe('web-client-123');
    expect(req.redirectURI).toBe('https://sign.zhonglvbao.com/login/callback');
    expect(req.serverURL).toBe('https://acosmi.com');
    expect(typeof req.createdAt).toBe('number');
    expect(req.createdAt).toBeGreaterThan(0);

    const url = new URL(req.authUrl);
    expect(url.origin + url.pathname).toBe('https://acosmi.com/oauth/authorize');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('client_id')).toBe('web-client-123');
    expect(url.searchParams.get('redirect_uri')).toBe(
      'https://sign.zhonglvbao.com/login/callback',
    );
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('code_challenge')).toBeTruthy();
    // state in URL must echo the returned state object
    expect(url.searchParams.get('state')).toBe(req.state);
    expect(url.searchParams.get('scope')).toBe(
      'compliance:reports:read compliance:timestamp:create',
    );
    // login_hint only present when provided
    expect(url.searchParams.has('login_hint')).toBe(false);
  });

  it('includes login_hint only when provided', async () => {
    const req = await createWebAuthorizationRequest(fakeMeta, {
      clientID: 'web-client-123',
      redirectURI: 'https://sign.zhonglvbao.com/login/callback',
      scopes: ['ai'],
      serverURL: 'https://acosmi.com',
      loginHint: 'user@example.com',
    });
    const url = new URL(req.authUrl);
    expect(url.searchParams.get('login_hint')).toBe('user@example.com');
  });

  it('produces a fresh state/verifier each call', async () => {
    const a = await createWebAuthorizationRequest(fakeMeta, {
      clientID: 'c',
      redirectURI: 'https://sign.zhonglvbao.com/login/callback',
      scopes: ['ai'],
      serverURL: 'https://acosmi.com',
    });
    const b = await createWebAuthorizationRequest(fakeMeta, {
      clientID: 'c',
      redirectURI: 'https://sign.zhonglvbao.com/login/callback',
      scopes: ['ai'],
      serverURL: 'https://acosmi.com',
    });
    expect(a.state).not.toBe(b.state);
    expect(a.verifier).not.toBe(b.verifier);
  });
});

describe('completeWebAuthorizationRequest', () => {
  it('throws on state mismatch (CSRF protection)', async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error('fetch should not be called on state mismatch');
    }) as typeof fetch;

    await expect(
      completeWebAuthorizationRequest(
        {
          state: 'expected-state',
          verifier: 'verifier-x',
          clientID: 'web-client-123',
          redirectURI: 'https://sign.zhonglvbao.com/login/callback',
          serverURL: 'https://acosmi.com',
        },
        { code: 'auth-code-xyz', state: 'attacker-state' },
      ),
    ).rejects.toThrow(/state_mismatch/);
  });

  it('throws on empty authorization code', async () => {
    await expect(
      completeWebAuthorizationRequest(
        {
          state: 's',
          verifier: 'v',
          clientID: 'c',
          redirectURI: 'https://sign.zhonglvbao.com/login/callback',
          serverURL: 'https://acosmi.com',
        },
        { code: '', state: 's' },
      ),
    ).rejects.toThrow(/missing authorization code/);
  });

  it('on matching state calls exchangeCode and returns a TokenSet', async () => {
    const seenUrls: string[] = [];
    let tokenBody: URLSearchParams | null = null;

    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      seenUrls.push(url);
      if (url.endsWith('/.well-known/oauth-authorization-server/web')) {
        return jsonResponse(fakeMeta);
      }
      if (url === 'https://acosmi.com/oauth/token') {
        tokenBody = new URLSearchParams((init?.body as string) ?? '');
        return jsonResponse({
          access_token: 'AT-web',
          refresh_token: 'RT-web',
          token_type: 'Bearer',
          expires_in: 3600,
          scope: 'compliance:reports:read',
        });
      }
      return new Response('not-found', { status: 404 });
    }) as typeof fetch;

    const tokenSet: TokenSet = await completeWebAuthorizationRequest(
      {
        state: 'matching-state',
        verifier: 'verifier-abc',
        clientID: 'web-client-123',
        redirectURI: 'https://sign.zhonglvbao.com/login/callback',
        serverURL: 'https://acosmi.com',
      },
      { code: 'auth-code-xyz', state: 'matching-state' },
    );

    expect(tokenSet.access_token).toBe('AT-web');
    expect(tokenSet.refresh_token).toBe('RT-web');
    expect(tokenSet.client_id).toBe('web-client-123');
    expect(tokenSet.server_url).toBe('https://acosmi.com');
    expect(tokenSet.scope).toBe('compliance:reports:read');

    // discovered via /web profile
    expect(
      seenUrls.some((u) => u.endsWith('/.well-known/oauth-authorization-server/web')),
    ).toBe(true);
    // exchangeCode posted authorization_code grant with verifier + code
    expect(tokenBody).not.toBeNull();
    expect(tokenBody!.get('grant_type')).toBe('authorization_code');
    expect(tokenBody!.get('code')).toBe('auth-code-xyz');
    expect(tokenBody!.get('code_verifier')).toBe('verifier-abc');
    expect(tokenBody!.get('client_id')).toBe('web-client-123');
    expect(tokenBody!.get('redirect_uri')).toBe(
      'https://sign.zhonglvbao.com/login/callback',
    );
  });
});

describe('Client oauthMetadataProfile — refresh metadata discovery', () => {
  function makeExpiredTokenSet(): TokenSet {
    return {
      access_token: 'AT-stale',
      refresh_token: 'RT-stale',
      expires_at: new Date(Date.now() - 10_000).toISOString(),
      scope: 'ai',
      client_id: 'web-client-123',
      server_url: 'https://acosmi.com',
    };
  }

  it("Client with oauthMetadataProfile:'web' refreshes via /web metadata endpoint", async () => {
    const wellKnownUrls: string[] = [];
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/.well-known/oauth-authorization-server/')) {
        wellKnownUrls.push(url);
        return jsonResponse(fakeMeta);
      }
      if (url === 'https://acosmi.com/oauth/token') {
        return jsonResponse({
          access_token: 'AT-refreshed',
          refresh_token: 'RT-refreshed',
          token_type: 'Bearer',
          expires_in: 3600,
          scope: 'ai',
        });
      }
      return new Response('not-found', { status: 404 });
    }) as typeof fetch;

    const c = new Client({
      serverURL: 'https://acosmi.com',
      store: new InMemoryTokenStore(),
      oauthMetadataProfile: 'web',
    });
    c.tokens = makeExpiredTokenSet();

    const at = await c.ensureToken();
    expect(at).toBe('AT-refreshed');
    expect(wellKnownUrls).toHaveLength(1);
    expect(wellKnownUrls[0]).toBe(
      'https://acosmi.com/.well-known/oauth-authorization-server/web',
    );
  });

  it('Client without oauthMetadataProfile still refreshes via /desktop metadata endpoint', async () => {
    const wellKnownUrls: string[] = [];
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/.well-known/oauth-authorization-server/')) {
        wellKnownUrls.push(url);
        return jsonResponse(fakeMeta);
      }
      if (url === 'https://acosmi.com/oauth/token') {
        return jsonResponse({
          access_token: 'AT-refreshed',
          refresh_token: 'RT-refreshed',
          token_type: 'Bearer',
          expires_in: 3600,
          scope: 'ai',
        });
      }
      return new Response('not-found', { status: 404 });
    }) as typeof fetch;

    const c = new Client({
      serverURL: 'https://acosmi.com',
      store: new InMemoryTokenStore(),
    });
    c.tokens = makeExpiredTokenSet();

    const at = await c.ensureToken();
    expect(at).toBe('AT-refreshed');
    expect(wellKnownUrls).toHaveLength(1);
    expect(wellKnownUrls[0]).toBe(
      'https://acosmi.com/.well-known/oauth-authorization-server/desktop',
    );
  });
});

describe('Client oauthMetadataProfile — forceRefresh metadata discovery', () => {
  function makeTokenSet(): TokenSet {
    return {
      access_token: 'AT-stale',
      refresh_token: 'RT-stale',
      expires_at: new Date(Date.now() + 3600_000).toISOString(),
      scope: 'ai',
      client_id: 'web-client-123',
      server_url: 'https://acosmi.com',
    };
  }

  it("Client with oauthMetadataProfile:'web' performs forceRefresh discovery against /web", async () => {
    const wellKnownUrls: string[] = [];
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/.well-known/oauth-authorization-server/')) {
        wellKnownUrls.push(url);
        return jsonResponse(fakeMeta);
      }
      if (url === 'https://acosmi.com/oauth/token') {
        return jsonResponse({
          access_token: 'AT-refreshed',
          refresh_token: 'RT-refreshed',
          token_type: 'Bearer',
          expires_in: 3600,
          scope: 'ai',
        });
      }
      return new Response('not-found', { status: 404 });
    }) as typeof fetch;

    const c = new Client({
      serverURL: 'https://acosmi.com',
      store: new InMemoryTokenStore(),
      oauthMetadataProfile: 'web',
    });
    c.tokens = makeTokenSet();

    await c.forceRefresh();
    expect(c.getTokenSet()?.access_token).toBe('AT-refreshed');
    expect(wellKnownUrls).toHaveLength(1);
    expect(wellKnownUrls[0]).toBe(
      'https://acosmi.com/.well-known/oauth-authorization-server/web',
    );
  });

  it('Client without oauthMetadataProfile performs forceRefresh discovery against /desktop', async () => {
    const wellKnownUrls: string[] = [];
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/.well-known/oauth-authorization-server/')) {
        wellKnownUrls.push(url);
        return jsonResponse(fakeMeta);
      }
      if (url === 'https://acosmi.com/oauth/token') {
        return jsonResponse({
          access_token: 'AT-refreshed',
          refresh_token: 'RT-refreshed',
          token_type: 'Bearer',
          expires_in: 3600,
          scope: 'ai',
        });
      }
      return new Response('not-found', { status: 404 });
    }) as typeof fetch;

    const c = new Client({
      serverURL: 'https://acosmi.com',
      store: new InMemoryTokenStore(),
    });
    c.tokens = makeTokenSet();

    await c.forceRefresh();
    expect(c.getTokenSet()?.access_token).toBe('AT-refreshed');
    expect(wellKnownUrls).toHaveLength(1);
    expect(wellKnownUrls[0]).toBe(
      'https://acosmi.com/.well-known/oauth-authorization-server/desktop',
    );
  });
});

describe('Client oauthMetadataProfile — logout revocation metadata discovery', () => {
  function makeTokenSet(): TokenSet {
    return {
      access_token: 'AT-live',
      refresh_token: 'RT-live',
      expires_at: new Date(Date.now() + 3600_000).toISOString(),
      scope: 'ai',
      client_id: 'web-client-123',
      server_url: 'https://acosmi.com',
    };
  }

  it("Client with oauthMetadataProfile:'web' discovers /web metadata for logout revocation", async () => {
    const wellKnownUrls: string[] = [];
    const revokedTokens: string[] = [];
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/.well-known/oauth-authorization-server/')) {
        wellKnownUrls.push(url);
        return jsonResponse(fakeMeta);
      }
      if (url === 'https://acosmi.com/oauth/revoke') {
        const body = new URLSearchParams((init?.body as string) ?? '');
        const t = body.get('token');
        if (t) revokedTokens.push(t);
        return new Response('', { status: 200 });
      }
      return new Response('not-found', { status: 404 });
    }) as typeof fetch;

    const c = new Client({
      serverURL: 'https://acosmi.com',
      store: new InMemoryTokenStore(),
      oauthMetadataProfile: 'web',
    });
    // meta unset so logout must discover; ensures the profile path is exercised
    c.tokens = makeTokenSet();

    await c.logout();

    expect(wellKnownUrls).toHaveLength(1);
    expect(wellKnownUrls[0]).toBe(
      'https://acosmi.com/.well-known/oauth-authorization-server/web',
    );
    // both access + refresh tokens revoked at the discovered (web) revocation endpoint
    expect(revokedTokens).toEqual(['AT-live', 'RT-live']);
    expect(c.isAuthorized()).toBe(false);
  });

  it('Client without oauthMetadataProfile discovers /desktop metadata for logout revocation', async () => {
    const wellKnownUrls: string[] = [];
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/.well-known/oauth-authorization-server/')) {
        wellKnownUrls.push(url);
        return jsonResponse(fakeMeta);
      }
      if (url === 'https://acosmi.com/oauth/revoke') {
        return new Response('', { status: 200 });
      }
      return new Response('not-found', { status: 404 });
    }) as typeof fetch;

    const c = new Client({
      serverURL: 'https://acosmi.com',
      store: new InMemoryTokenStore(),
    });
    c.tokens = makeTokenSet();

    await c.logout();

    expect(wellKnownUrls).toHaveLength(1);
    expect(wellKnownUrls[0]).toBe(
      'https://acosmi.com/.well-known/oauth-authorization-server/desktop',
    );
    expect(c.isAuthorized()).toBe(false);
  });
});
