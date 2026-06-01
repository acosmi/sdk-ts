// C2 (P2-2): OAuth 链路使用注入的 fetchImpl, 不落全局 fetch。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  Client,
  discover,
  exchangeCode,
  refreshToken,
  register,
  type ServerMetadata,
  type TokenResponse,
} from '../src';

const meta: ServerMetadata = {
  issuer: 'https://nexus.test',
  authorization_endpoint: 'https://nexus.test/authorize',
  token_endpoint: 'https://nexus.test/token',
  revocation_endpoint: 'https://nexus.test/revoke',
  registration_endpoint: 'https://nexus.test/register',
  scopes_supported: ['ai'],
};

function jsonResp(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const originalFetch = globalThis.fetch;

beforeEach(() => {
  // 全局 fetch 一旦被走到就立刻失败 — 证明 OAuth 链路只走注入 fetchImpl。
  globalThis.fetch = vi.fn(async () => {
    throw new Error('global fetch must not be called in OAuth flow');
  }) as unknown as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe('auth helpers 使用注入 fetchImpl', () => {
  it('discover 走注入 fetchImpl, 不走全局 fetch', async () => {
    const mock = vi.fn(async () =>
      jsonResp({
        ...meta,
        token_endpoint: meta.token_endpoint,
        authorization_endpoint: meta.authorization_endpoint,
      }),
    ) as unknown as typeof fetch;

    const got = await discover('https://nexus.test', undefined, mock);
    expect(got.token_endpoint).toBe(meta.token_endpoint);
    expect(mock).toHaveBeenCalledTimes(1);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('register 走注入 fetchImpl', async () => {
    const mock = vi.fn(async () => jsonResp({ client_id: 'cid-1' })) as unknown as typeof fetch;
    const reg = await register(meta, 'App', undefined, mock);
    expect(reg.client_id).toBe('cid-1');
    expect(mock).toHaveBeenCalledTimes(1);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('exchangeCode 走注入 fetchImpl', async () => {
    const resp: TokenResponse = {
      access_token: 'AT',
      token_type: 'bearer',
      expires_in: 3600,
      refresh_token: 'RT',
      scope: 'ai',
    };
    const mock = vi.fn(async () => jsonResp(resp)) as unknown as typeof fetch;
    const got = await exchangeCode(meta, 'cid', 'code', 'http://127.0.0.1/cb', 'verifier', undefined, mock);
    expect(got.access_token).toBe('AT');
    expect(mock).toHaveBeenCalledTimes(1);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('refreshToken 走注入 fetchImpl', async () => {
    const resp: TokenResponse = {
      access_token: 'AT2',
      token_type: 'bearer',
      expires_in: 3600,
      refresh_token: 'RT2',
      scope: 'ai',
    };
    const mock = vi.fn(async () => jsonResp(resp)) as unknown as typeof fetch;
    const got = await refreshToken(meta, 'cid', 'old-rt', undefined, mock);
    expect(got.access_token).toBe('AT2');
    expect(mock).toHaveBeenCalledTimes(1);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});

describe('Client.forceRefresh 全链路走注入 fetchImpl', () => {
  it('refresh: discover + token endpoint 都走注入 fetchImpl, 全局 fetch 零调用', async () => {
    const calls: string[] = [];
    const mock = vi.fn(async (url: string | URL | Request) => {
      const u = String(url);
      calls.push(u);
      if (u.includes('/.well-known/oauth-authorization-server/')) {
        return jsonResp(meta);
      }
      if (u.includes('/token')) {
        return jsonResp({
          access_token: 'fresh-AT',
          token_type: 'bearer',
          expires_in: 3600,
          refresh_token: 'fresh-RT',
          scope: 'ai',
        } satisfies TokenResponse);
      }
      throw new Error(`unexpected url ${u}`);
    }) as unknown as typeof fetch;

    const client = new Client({ serverURL: 'https://nexus.test', fetchImpl: mock });
    client.tokens = {
      access_token: 'old-AT',
      refresh_token: 'old-RT',
      expires_at: new Date(Date.now() - 1000).toISOString(),
      scope: 'ai',
      client_id: 'cid',
      server_url: 'https://nexus.test',
    };

    await client.forceRefresh();

    expect(client.getTokenSet()?.access_token).toBe('fresh-AT');
    // discover + token, 各一次, 全部经注入 fetchImpl。
    expect(calls.some((u) => u.includes('/.well-known/'))).toBe(true);
    expect(calls.some((u) => u.includes('/token'))).toBe(true);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});
