// compliance-capabilities.test.ts — ComplianceClient capabilities + operation
// projection read tests (fake fetch).
//
// 覆盖（compliance gateway S2 / gap-register U-5 / U-6）：URL path / CommonResult
// 解包 / Authorization header / PageResult{total,list} 形态 / page+filter query
// params / GET 401 refresh retry / getFeatureGate 取单条 / 过滤项为空不发空参数 /
// createTime* 原样透传 / 不打 /api/v4。

import { describe, expect, it } from 'vitest';

import { Client } from '../src/index';
import type {
  ComplianceCapability,
  OperationDetail,
  OperationPageItem,
} from '../src/index';

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

/** 解析 captured URL 的 query 部分为 URLSearchParams。 */
function queryOf(url: string): URLSearchParams {
  const qIdx = url.indexOf('?');
  return new URLSearchParams(qIdx < 0 ? '' : url.slice(qIdx + 1));
}

const SIGN_CAP: ComplianceCapability = {
  action: 'signEnvelope',
  executable: false,
  state: 'step_up_required',
  requiredScopes: ['compliance:signing:sign'],
  requiredStepUp: true,
  reason: 'step-up required',
};

const PUBLISH_CAP: ComplianceCapability = {
  action: 'publishReport',
  executable: true,
  state: 'executable',
  requiredScopes: ['compliance:reports:publish'],
  requiredStepUp: false,
  reason: '',
};

describe('ComplianceClient — getCapabilities', () => {
  it('GETs /compliance/capabilities with Authorization and unwraps the array', async () => {
    const { fetch, calls } = captureFetch(() =>
      jsonResponse({ code: 0, data: [SIGN_CAP, PUBLISH_CAP] }),
    );
    const client = clientWith(fetch);
    const caps = await client.compliance.getCapabilities();
    expect(calls[0].url).toContain('/admin-api/compliance/capabilities');
    expect(calls[0].url).not.toContain('/api/v4');
    expect(calls[0].init.headers).toMatchObject({ Authorization: 'Bearer token-1' });
    expect(caps).toHaveLength(2);
    expect(caps[0].action).toBe('signEnvelope');
    expect(caps[0].state).toBe('step_up_required');
    expect(caps[0].requiredScopes).toEqual(['compliance:signing:sign']);
    expect(caps[0].requiredStepUp).toBe(true);
  });

  it('GET retries once on 401 (token refresh path)', async () => {
    let firstSeen = false;
    const { fetch, calls } = captureFetch(() => {
      if (!firstSeen) {
        firstSeen = true;
        return emptyResponse(401);
      }
      return jsonResponse({ code: 0, data: [PUBLISH_CAP] });
    });
    const client = clientWith(fetch);
    client.forceRefresh = async () => {
      client.tokens = { ...client.tokens!, access_token: 'token-2' };
    };
    const caps = await client.compliance.getCapabilities();
    expect(caps).toHaveLength(1);
    expect(calls).toHaveLength(2);
    expect(calls[1].init.headers).toMatchObject({ Authorization: 'Bearer token-2' });
  });
});

describe('ComplianceClient — getFeatureGate', () => {
  it('returns the capability entry matching the action', async () => {
    const { fetch, calls } = captureFetch(() =>
      jsonResponse({ code: 0, data: [SIGN_CAP, PUBLISH_CAP] }),
    );
    const client = clientWith(fetch);
    const gate = await client.compliance.getFeatureGate('publishReport');
    expect(calls[0].url).toContain('/compliance/capabilities');
    expect(gate?.action).toBe('publishReport');
    expect(gate?.executable).toBe(true);
  });

  it('returns undefined when no capability matches the action', async () => {
    const { fetch } = captureFetch(() =>
      jsonResponse({ code: 0, data: [SIGN_CAP] }),
    );
    const client = clientWith(fetch);
    const gate = await client.compliance.getFeatureGate('createSeal');
    expect(gate).toBeUndefined();
  });

  it('does exactly one network call', async () => {
    const { fetch, calls } = captureFetch(() =>
      jsonResponse({ code: 0, data: [SIGN_CAP, PUBLISH_CAP] }),
    );
    const client = clientWith(fetch);
    await client.compliance.getFeatureGate('signEnvelope');
    expect(calls).toHaveLength(1);
  });
});

describe('ComplianceClient — listOperations', () => {
  it('GETs /compliance/operations/page and unwraps PageResult', async () => {
    const item: OperationPageItem = {
      id: 42,
      operationId: 'op-key-1',
      status: 'succeeded',
      terminal: true,
      retryable: false,
      attemptCount: 1,
      businessNo: 'BIZ-1',
      contractNo: 'CT-1',
      sealId: 7,
      reconciliationStatus: 'MATCHED',
      nextRetryAt: null,
      requestedAt: '2026-05-07T00:00:00',
      respondedAt: '2026-05-07T00:00:05',
      createTime: '2026-05-07T00:00:00',
    };
    const { fetch, calls } = captureFetch(() =>
      jsonResponse({ code: 0, data: { total: 1, list: [item] } }),
    );
    const client = clientWith(fetch);
    const page = await client.compliance.listOperations();
    expect(calls[0].url).toContain('/admin-api/compliance/operations/page');
    expect(calls[0].url).not.toContain('/api/v4');
    expect(calls[0].init.headers).toMatchObject({ Authorization: 'Bearer token-1' });
    expect(page.total).toBe(1);
    expect(page.list).toHaveLength(1);
    expect(page.list[0].operationId).toBe('op-key-1');
    expect(page.list[0].sealId).toBe(7);
  });

  it('serializes pageNo/pageSize + status/createTime* filters into query', async () => {
    const { fetch, calls } = captureFetch(() =>
      jsonResponse({ code: 0, data: { total: 0, list: [] } }),
    );
    const client = clientWith(fetch);
    await client.compliance.listOperations({
      pageNo: 3,
      pageSize: 25,
      status: 'failed',
      createTimeStart: '2026-05-01 00:00:00',
      createTimeEnd: '2026-05-22 23:59:59',
    });
    const q = queryOf(calls[0].url);
    expect(q.get('pageNo')).toBe('3');
    expect(q.get('pageSize')).toBe('25');
    expect(q.get('status')).toBe('failed');
    // createTime* 原样透传（caller-supplied yyyy-MM-dd HH:mm:ss 字符串）
    expect(q.get('createTimeStart')).toBe('2026-05-01 00:00:00');
    expect(q.get('createTimeEnd')).toBe('2026-05-22 23:59:59');
  });

  it('omits empty filters — no query string when called with no args', async () => {
    const { fetch, calls } = captureFetch(() =>
      jsonResponse({ code: 0, data: { total: 0, list: [] } }),
    );
    const client = clientWith(fetch);
    await client.compliance.listOperations();
    expect(calls[0].url.endsWith('/compliance/operations/page')).toBe(true);
    expect(calls[0].url).not.toContain('?');
  });

  it('GET retries once on 401 (token refresh path)', async () => {
    let firstSeen = false;
    const { fetch, calls } = captureFetch(() => {
      if (!firstSeen) {
        firstSeen = true;
        return emptyResponse(401);
      }
      return jsonResponse({ code: 0, data: { total: 0, list: [] } });
    });
    const client = clientWith(fetch);
    client.forceRefresh = async () => {
      client.tokens = { ...client.tokens!, access_token: 'token-2' };
    };
    const page = await client.compliance.listOperations();
    expect(page.total).toBe(0);
    expect(calls).toHaveLength(2);
    expect(calls[1].init.headers).toMatchObject({ Authorization: 'Bearer token-2' });
  });
});

describe('ComplianceClient — getOperation', () => {
  it('GETs /compliance/operations/{id} and unwraps OperationDetail', async () => {
    const detail: OperationDetail = {
      id: 99,
      operationId: 'op-key-99',
      status: 'retrying',
      terminal: false,
      retryable: true,
      attemptCount: 2,
      nextRetryAt: '2026-05-08T00:01:00',
      createTime: '2026-05-08T00:00:00',
    };
    const { fetch, calls } = captureFetch(() =>
      jsonResponse({ code: 0, data: detail }),
    );
    const client = clientWith(fetch);
    const op = await client.compliance.getOperation(99);
    expect(calls[0].url).toContain('/compliance/operations/99');
    expect(calls[0].url).not.toContain('/api/v4');
    expect(calls[0].init.headers).toMatchObject({ Authorization: 'Bearer token-1' });
    expect(op.id).toBe(99);
    expect(op.operationId).toBe('op-key-99');
    expect(op.terminal).toBe(false);
    expect(op.retryable).toBe(true);
    expect(op.attemptCount).toBe(2);
  });

  it('GET retries once on 401 (token refresh path)', async () => {
    let firstSeen = false;
    const { fetch, calls } = captureFetch(() => {
      if (!firstSeen) {
        firstSeen = true;
        return emptyResponse(401);
      }
      return jsonResponse({
        code: 0,
        data: {
          id: 1,
          operationId: 'op-1',
          status: 'pending',
          terminal: false,
          retryable: false,
          attemptCount: 0,
          createTime: '2026-05-08T00:00:00',
        },
      });
    });
    const client = clientWith(fetch);
    client.forceRefresh = async () => {
      client.tokens = { ...client.tokens!, access_token: 'token-2' };
    };
    const op = await client.compliance.getOperation(1);
    expect(op.id).toBe(1);
    expect(calls).toHaveLength(2);
    expect(calls[1].init.headers).toMatchObject({ Authorization: 'Bearer token-2' });
  });
});
