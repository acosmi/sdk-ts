// compliance-tsa.test.ts — ComplianceClient TSA readonly view tests (fake fetch).
//
// 覆盖（compliance gateway S3 / gap-register U-7）：URL path / CommonResult 解包 /
// Authorization header / TsaProvider[] 与 TsaStats 形态 / GET 401 refresh retry /
// 不打 /api/v4。

import { describe, expect, it } from 'vitest';

import { Client } from '../src/index';
import type { TsaProvider, TsaStats } from '../src/index';

const future = new Date(Date.now() + 60_000).toISOString();

function clientWith(fetchImpl: typeof fetch): Client {
  const client = new Client({ serverURL: 'https://nexus.test', fetchImpl });
  client.tokens = {
    access_token: 'token-1',
    refresh_token: 'refresh-1',
    expires_at: future,
    scope: 'compliance:evidence:read',
    client_id: 'client-1',
    server_url: 'https://nexus.test',
  };
  return client;
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function emptyResponse(status: number): Response {
  return new Response('', { status });
}

interface CapturedCall {
  url: string;
  init: RequestInit;
}

function captureFetch(handler: (call: CapturedCall, callIndex: number) => Response | Promise<Response>): {
  fetch: typeof fetch;
  calls: CapturedCall[];
} {
  const calls: CapturedCall[] = [];
  const fn: typeof fetch = async (url, init) => {
    const call: CapturedCall = { url: String(url), init: init ?? {} };
    calls.push(call);
    return handler(call, calls.length - 1);
  };
  return { fetch: fn, calls };
}

const PROVIDER_A: TsaProvider = {
  name: 'TSA_A',
  environment: 'production',
  available: true,
};

const PROVIDER_B: TsaProvider = {
  name: 'TSA_B',
  environment: 'sandbox',
  available: false,
};

describe('ComplianceClient — listTsaProviders', () => {
  it('GETs /compliance/timestamps/providers with Authorization and unwraps the array', async () => {
    const { fetch, calls } = captureFetch(() =>
      jsonResponse({ code: 0, data: [PROVIDER_A, PROVIDER_B] }),
    );
    const client = clientWith(fetch);
    const providers = await client.compliance.listTsaProviders();
    expect(calls[0].url).toContain('/admin-api/compliance/timestamps/providers');
    expect(calls[0].url).not.toContain('/api/v4');
    expect(calls[0].init.headers).toMatchObject({ Authorization: 'Bearer token-1' });
    expect(providers).toHaveLength(2);
    expect(providers[0].name).toBe('TSA_A');
    expect(providers[0].environment).toBe('production');
    expect(providers[0].available).toBe(true);
    expect(providers[1].available).toBe(false);
  });

  it('GET retries once on 401 (token refresh path)', async () => {
    let firstSeen = false;
    const { fetch, calls } = captureFetch(() => {
      if (!firstSeen) {
        firstSeen = true;
        return emptyResponse(401);
      }
      return jsonResponse({ code: 0, data: [PROVIDER_A] });
    });
    const client = clientWith(fetch);
    client.forceRefresh = async () => {
      client.tokens = { ...client.tokens!, access_token: 'token-2' };
    };
    const providers = await client.compliance.listTsaProviders();
    expect(providers).toHaveLength(1);
    expect(calls).toHaveLength(2);
    expect(calls[1].init.headers).toMatchObject({ Authorization: 'Bearer token-2' });
  });
});

describe('ComplianceClient — getTsaStats', () => {
  it('GETs /compliance/timestamps/stats with Authorization and unwraps TsaStats', async () => {
    const stats: TsaStats = {
      total: 12,
      byVerificationStatus: { VERIFIED: 9, PENDING: 2, FAILED: 1 },
    };
    const { fetch, calls } = captureFetch(() =>
      jsonResponse({ code: 0, data: stats }),
    );
    const client = clientWith(fetch);
    const result = await client.compliance.getTsaStats();
    expect(calls[0].url).toContain('/admin-api/compliance/timestamps/stats');
    expect(calls[0].url).not.toContain('/api/v4');
    expect(calls[0].init.headers).toMatchObject({ Authorization: 'Bearer token-1' });
    expect(result.total).toBe(12);
    expect(result.byVerificationStatus.VERIFIED).toBe(9);
    expect(result.byVerificationStatus.PENDING).toBe(2);
    expect(result.byVerificationStatus.FAILED).toBe(1);
  });

  it('handles an empty byVerificationStatus map', async () => {
    const { fetch } = captureFetch(() =>
      jsonResponse({ code: 0, data: { total: 0, byVerificationStatus: {} } }),
    );
    const client = clientWith(fetch);
    const result = await client.compliance.getTsaStats();
    expect(result.total).toBe(0);
    expect(Object.keys(result.byVerificationStatus)).toHaveLength(0);
  });

  it('GET retries once on 401 (token refresh path)', async () => {
    let firstSeen = false;
    const { fetch, calls } = captureFetch(() => {
      if (!firstSeen) {
        firstSeen = true;
        return emptyResponse(401);
      }
      return jsonResponse({ code: 0, data: { total: 1, byVerificationStatus: { VERIFIED: 1 } } });
    });
    const client = clientWith(fetch);
    client.forceRefresh = async () => {
      client.tokens = { ...client.tokens!, access_token: 'token-2' };
    };
    const result = await client.compliance.getTsaStats();
    expect(result.total).toBe(1);
    expect(calls).toHaveLength(2);
    expect(calls[1].init.headers).toMatchObject({ Authorization: 'Bearer token-2' });
  });
});
