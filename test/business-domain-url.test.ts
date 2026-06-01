// business-domain-url.test.ts — 业务域客户端 (casehall / finance / enterprise) 的
// 最终请求 URL 路径契约钉死测试。
//
// ⚠️ 关键契约 (主控 live 生产实证):
//   casehall / finance / enterprise 客户端里带 `/api/...` 前缀的路径是**正确的**，
//   它们经「同源代理直连 tk-dist」链路工作 (nginx `location /api/v4/api/casehall/`
//   → tk-dist)，与后端控制器 `@RequestMapping("/api/...")` 精确匹配。
//   `apiURL()` 会在前面拼 `/api/v4`，于是最终路径出现「双 /api」(/api/v4/api/...)，
//   这是**有意契约，不是 bug，禁止"修正"去掉 /api，否则生产 404**。
//
// 本测试通过注入捕获用的 fetchImpl 捕获 request.url，断言每个方法的最终 URL path，
// 任何人将来把这些路径"去掉 /api"都会让此测试**失败**。

import { describe, expect, it } from 'vitest';

import { Client } from '../src/index';

const future = new Date(Date.now() + 60_000).toISOString();

interface CapturedCall {
  url: string;
  init: RequestInit;
}

/** 构造一个捕获请求 URL 的 fetch；按 handler 返回响应 (默认 {code:0,data:...} 200)。 */
function captureFetch(
  handler?: (call: CapturedCall) => Response | Promise<Response>,
): { fetch: typeof fetch; calls: CapturedCall[] } {
  const calls: CapturedCall[] = [];
  const fn: typeof fetch = async (url, init) => {
    const call: CapturedCall = { url: String(url), init: init ?? {} };
    calls.push(call);
    if (handler) return handler(call);
    return new Response(JSON.stringify({ code: 0, data: null }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };
  return { fetch: fn, calls };
}

/** 已登录客户端 — tokens 直接注入 (future 过期) 绕过 OAuth。 */
function clientWith(fetchImpl: typeof fetch): Client {
  const client = new Client({
    serverURL: 'https://gw.example',
    fetchImpl,
  });
  client.tokens = {
    access_token: 'token-1',
    refresh_token: 'refresh-1',
    expires_at: future,
    scope: '',
    client_id: 'client-1',
    server_url: 'https://gw.example',
  };
  return client;
}

/** 取最近一次请求 URL 的 pathname (去掉 host / query)。 */
function lastPath(calls: CapturedCall[]): string {
  const u = new URL(calls[calls.length - 1].url);
  return u.pathname;
}

/** 取最近一次请求 URL 的 pathname + search。 */
function lastPathAndQuery(calls: CapturedCall[]): string {
  const u = new URL(calls[calls.length - 1].url);
  return u.pathname + u.search;
}

// =============================================================================
// casehall — 同源代理直连 tk-dist 的双 /api 契约 (仅 getMyLawyerCredentialStatus 在产)
// =============================================================================

describe('casehall URL 契约 (同源代理直连 tk-dist, 双 /api 正确)', () => {
  it('getMyLawyerCredentialStatus → /api/v4/api/casehall/lawyer-credentials/my', async () => {
    // 这是同源代理直连 tk-dist 的有意契约，双 /api 正确，禁止"修正"，否则生产 404。
    const { fetch, calls } = captureFetch();
    const c = clientWith(fetch);
    await c.getMyLawyerCredentialStatus();
    expect(lastPath(calls)).toBe('/api/v4/api/casehall/lawyer-credentials/my');
  });
});

// =============================================================================
// finance — /api/v4/api/distribution/finance/... 全路径
// =============================================================================

describe('finance URL 契约 (/api/v4/api/distribution/finance/...)', () => {
  it('requestRefund → refund/request', async () => {
    const { fetch, calls } = captureFetch(() =>
      new Response(JSON.stringify({ code: 0, data: { id: 1 } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const c = clientWith(fetch);
    await c.requestRefund({} as never);
    expect(lastPath(calls)).toBe('/api/v4/api/distribution/finance/refund/request');
  });

  it('listMyRefunds → refund/my', async () => {
    const { fetch, calls } = captureFetch();
    const c = clientWith(fetch);
    await c.listMyRefunds();
    expect(lastPath(calls)).toBe('/api/v4/api/distribution/finance/refund/my');
  });

  it('requestInvoice → invoice/request', async () => {
    const { fetch, calls } = captureFetch(() =>
      new Response(JSON.stringify({ code: 0, data: { id: 1 } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const c = clientWith(fetch);
    await c.requestInvoice({} as never);
    expect(lastPath(calls)).toBe('/api/v4/api/distribution/finance/invoice/request');
  });

  it('listMyInvoices → invoice/my', async () => {
    const { fetch, calls } = captureFetch();
    const c = clientWith(fetch);
    await c.listMyInvoices();
    expect(lastPath(calls)).toBe('/api/v4/api/distribution/finance/invoice/my');
  });

  it('initiateCorporateTransfer → corporate-transfer/initiate', async () => {
    const { fetch, calls } = captureFetch(() =>
      new Response(JSON.stringify({ code: 0, data: { id: 1 } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const c = clientWith(fetch);
    await c.initiateCorporateTransfer({} as never);
    expect(lastPath(calls)).toBe(
      '/api/v4/api/distribution/finance/corporate-transfer/initiate',
    );
  });

  it('uploadCorporateTransferProof → corporate-transfer/{id}/upload-proof?proofUrl=... (路径参数+query 编码)', async () => {
    const { fetch, calls } = captureFetch();
    const c = clientWith(fetch);
    await c.uploadCorporateTransferProof(42, 'https://cdn.example/p?a=b&c=d');
    expect(lastPath(calls)).toBe(
      '/api/v4/api/distribution/finance/corporate-transfer/42/upload-proof',
    );
    // proofUrl 必须 URI-encode (含 ?/&/=) — URL 解析回来应等于原值。
    const u = new URL(calls[calls.length - 1].url);
    expect(u.searchParams.get('proofUrl')).toBe('https://cdn.example/p?a=b&c=d');
  });

  it('listMyCorporateTransfers → corporate-transfer/my', async () => {
    const { fetch, calls } = captureFetch();
    const c = clientWith(fetch);
    await c.listMyCorporateTransfers();
    expect(lastPath(calls)).toBe(
      '/api/v4/api/distribution/finance/corporate-transfer/my',
    );
  });
});

// =============================================================================
// enterprise — /api/v4/api/... 全路径 (含 /api/v4/me/... 登录态)
// =============================================================================

describe('enterprise URL 契约 (/api/v4/api/... 与 /api/v4/me/...)', () => {
  it('listMyEnterprises → /api/v4/me/enterprises', async () => {
    const { fetch, calls } = captureFetch();
    const c = clientWith(fetch);
    await c.listMyEnterprises();
    expect(lastPath(calls)).toBe('/api/v4/me/enterprises');
  });

  it('getEnterprise → /api/v4/api/admin/enterprises/{id}', async () => {
    const { fetch, calls } = captureFetch(() =>
      new Response(JSON.stringify({ code: 0, data: { id: 7 } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const c = clientWith(fetch);
    await c.getEnterprise(7);
    expect(lastPath(calls)).toBe('/api/v4/api/admin/enterprises/7');
  });

  it('inviteMember → /api/v4/api/admin/enterprise-members', async () => {
    const { fetch, calls } = captureFetch(() =>
      new Response(JSON.stringify({ code: 0, data: { id: 1 } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const c = clientWith(fetch);
    await c.inviteMember({} as never);
    expect(lastPath(calls)).toBe('/api/v4/api/admin/enterprise-members');
  });

  it('listEnterpriseMembers → /api/v4/api/admin/enterprise-members/by-enterprise/{id}', async () => {
    const { fetch, calls } = captureFetch();
    const c = clientWith(fetch);
    await c.listEnterpriseMembers(9);
    expect(lastPath(calls)).toBe(
      '/api/v4/api/admin/enterprise-members/by-enterprise/9',
    );
  });

  it('listOrgSubscriptions → /api/v4/api/admin/org-subscriptions/by-enterprise/{id}', async () => {
    const { fetch, calls } = captureFetch();
    const c = clientWith(fetch);
    await c.listOrgSubscriptions(9);
    expect(lastPath(calls)).toBe(
      '/api/v4/api/admin/org-subscriptions/by-enterprise/9',
    );
  });

  it('listSeats → /api/v4/api/admin/org-seats/by-subscription/{id}', async () => {
    const { fetch, calls } = captureFetch();
    const c = clientWith(fetch);
    await c.listSeats(5);
    expect(lastPath(calls)).toBe('/api/v4/api/admin/org-seats/by-subscription/5');
  });

  it('assignSeat → /api/v4/api/admin/org-seats/assign', async () => {
    const { fetch, calls } = captureFetch(() =>
      new Response(JSON.stringify({ code: 0, data: { id: 1 } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const c = clientWith(fetch);
    await c.assignSeat({} as never);
    expect(lastPath(calls)).toBe('/api/v4/api/admin/org-seats/assign');
  });

  it('revokeSeat → /api/v4/api/admin/org-seats/{id}/revoke?note=... (query 编码)', async () => {
    const { fetch, calls } = captureFetch();
    const c = clientWith(fetch);
    await c.revokeSeat(11, '违规 a&b');
    expect(lastPath(calls)).toBe('/api/v4/api/admin/org-seats/11/revoke');
    const u = new URL(calls[calls.length - 1].url);
    expect(u.searchParams.get('note')).toBe('违规 a&b');
  });

  it('getOrgConsumeReport → /api/v4/api/admin/enterprise-settlements/overview/{id}', async () => {
    const { fetch, calls } = captureFetch();
    const c = clientWith(fetch);
    await c.getOrgConsumeReport(9);
    expect(lastPath(calls)).toBe(
      '/api/v4/api/admin/enterprise-settlements/overview/9',
    );
  });

  it('getMyEnterpriseKycStatus → /api/v4/api/distribution/enterprise/kyc/my', async () => {
    const { fetch, calls } = captureFetch();
    const c = clientWith(fetch);
    await c.getMyEnterpriseKycStatus();
    expect(lastPathAndQuery(calls)).toBe(
      '/api/v4/api/distribution/enterprise/kyc/my',
    );
  });
});
