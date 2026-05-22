// compliance-list.test.ts — ComplianceClient.list* paginated read tests (fake fetch)。
//
// 覆盖（compliance gateway S1 / gap-register U-1）：URL path / page+filter query
// params / Authorization header / CommonResult 解包 / PageResult{total,list} 形态 /
// GET 401 refresh retry / 过滤项为空时不发空参数 / createTime* 原样透传。

import { describe, expect, it } from 'vitest';

import { Client } from '../src/index';
import type {
  EnvelopeContractItem,
  EvidenceAssetPageItem,
  EvidencePackagePageItem,
  OperationPageItem,
  ReportPageItem,
  SealApprovalPageItem,
  SealUsePageItem,
  SigningEnvelopePageItem,
  TimestampPageItem,
} from '../src/index';

const future = new Date(Date.now() + 60_000).toISOString();

function clientWith(fetchImpl: typeof fetch): Client {
  const client = new Client({ serverURL: 'https://nexus.test', fetchImpl });
  client.tokens = {
    access_token: 'token-1',
    refresh_token: 'refresh-1',
    expires_at: future,
    scope: 'compliance:evidence:read compliance:reports:read',
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

describe('ComplianceClient — listEvidenceAssets', () => {
  it('GETs /compliance/evidence/assets/page with Authorization and unwraps PageResult', async () => {
    const item: EvidenceAssetPageItem = {
      id: 1,
      evidenceNo: 'EV-1',
      assetType: 'HASH_ONLY',
      name: 'doc',
      hashAlgorithm: 'sha256',
      contentHash: 'h',
      digestSource: 'CLIENT',
      privacyLevel: 'private',
      status: 'READY',
      createTime: '2026-05-01T00:00:00',
    };
    const { fetch, calls } = captureFetch(() =>
      jsonResponse({ code: 0, data: { total: 1, list: [item] } }),
    );
    const client = clientWith(fetch);
    const page = await client.compliance.listEvidenceAssets();
    expect(calls[0].url).toContain('/admin-api/compliance/evidence/assets/page');
    expect(calls[0].url).not.toContain('/api/v4');
    expect(calls[0].init.headers).toMatchObject({ Authorization: 'Bearer token-1' });
    expect(page.total).toBe(1);
    expect(page.list).toHaveLength(1);
    expect(page.list[0].evidenceNo).toBe('EV-1');
    expect(page.list[0].createTime).toBe('2026-05-01T00:00:00');
  });

  it('serializes pageNo/pageSize + assetType/status/createTime* filters into query', async () => {
    const { fetch, calls } = captureFetch(() =>
      jsonResponse({ code: 0, data: { total: 0, list: [] } }),
    );
    const client = clientWith(fetch);
    await client.compliance.listEvidenceAssets({
      pageNo: 2,
      pageSize: 50,
      assetType: 'CONTRACT',
      status: 'READY',
      createTimeStart: '2026-05-01 00:00:00',
      createTimeEnd: '2026-05-22 23:59:59',
    });
    const q = queryOf(calls[0].url);
    expect(q.get('pageNo')).toBe('2');
    expect(q.get('pageSize')).toBe('50');
    expect(q.get('assetType')).toBe('CONTRACT');
    expect(q.get('status')).toBe('READY');
    // createTime* 原样透传（caller-supplied yyyy-MM-dd HH:mm:ss 字符串）
    expect(q.get('createTimeStart')).toBe('2026-05-01 00:00:00');
    expect(q.get('createTimeEnd')).toBe('2026-05-22 23:59:59');
  });

  it('omits empty filters — no query string when called with no args', async () => {
    const { fetch, calls } = captureFetch(() =>
      jsonResponse({ code: 0, data: { total: 0, list: [] } }),
    );
    const client = clientWith(fetch);
    await client.compliance.listEvidenceAssets();
    expect(calls[0].url.endsWith('/compliance/evidence/assets/page')).toBe(true);
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
    const page = await client.compliance.listEvidenceAssets();
    expect(page.total).toBe(0);
    expect(calls).toHaveLength(2);
    expect(calls[1].init.headers).toMatchObject({ Authorization: 'Bearer token-2' });
  });
});

describe('ComplianceClient — listTimestamps', () => {
  it('GETs /compliance/timestamps/page and unwraps PageResult', async () => {
    const item: TimestampPageItem = {
      id: 7,
      assetId: 1,
      verificationStatus: 'VERIFIED',
      createTime: '2026-05-02T10:00:00',
    };
    const { fetch, calls } = captureFetch(() =>
      jsonResponse({ code: 0, data: { total: 1, list: [item] } }),
    );
    const client = clientWith(fetch);
    const page = await client.compliance.listTimestamps();
    expect(calls[0].url).toContain('/compliance/timestamps/page');
    expect(page.list[0].verificationStatus).toBe('VERIFIED');
  });

  it('serializes provider/verificationStatus filters into query', async () => {
    const { fetch, calls } = captureFetch(() =>
      jsonResponse({ code: 0, data: { total: 0, list: [] } }),
    );
    const client = clientWith(fetch);
    await client.compliance.listTimestamps({
      pageNo: 1,
      provider: 'TSA_X',
      verificationStatus: 'PENDING',
    });
    const q = queryOf(calls[0].url);
    expect(q.get('pageNo')).toBe('1');
    expect(q.get('provider')).toBe('TSA_X');
    expect(q.get('verificationStatus')).toBe('PENDING');
  });
});

describe('ComplianceClient — listEvidencePackages', () => {
  it('GETs /compliance/evidence/packages/page and unwraps PageResult', async () => {
    const item: EvidencePackagePageItem = {
      id: 3,
      assetId: 1,
      chainId: 'chain-1',
      packageVersion: 'v1',
      hashAlgorithm: 'sha256',
      manifestHash: 'm',
      packageHash: 'p',
      status: 'SEALED',
      createTime: '2026-05-03T00:00:00',
    };
    const { fetch, calls } = captureFetch(() =>
      jsonResponse({ code: 0, data: { total: 1, list: [item] } }),
    );
    const client = clientWith(fetch);
    const page = await client.compliance.listEvidencePackages({ status: 'SEALED' });
    expect(calls[0].url).toContain('/compliance/evidence/packages/page');
    expect(queryOf(calls[0].url).get('status')).toBe('SEALED');
    expect(page.list[0].packageHash).toBe('p');
  });
});

describe('ComplianceClient — listReports', () => {
  it('GETs /compliance/reports/page and unwraps PageResult', async () => {
    const item: ReportPageItem = {
      id: 9,
      reportNo: 'RP-9',
      reportType: 'EVIDENCE',
      status: 'PUBLISHED',
      createTime: '2026-05-04T00:00:00',
    };
    const { fetch, calls } = captureFetch(() =>
      jsonResponse({ code: 0, data: { total: 1, list: [item] } }),
    );
    const client = clientWith(fetch);
    const page = await client.compliance.listReports({
      status: 'PUBLISHED',
      createTimeStart: '2026-05-01 00:00:00',
    });
    expect(calls[0].url).toContain('/compliance/reports/page');
    const q = queryOf(calls[0].url);
    expect(q.get('status')).toBe('PUBLISHED');
    expect(q.get('createTimeStart')).toBe('2026-05-01 00:00:00');
    expect(page.list[0].reportNo).toBe('RP-9');
  });
});

describe('ComplianceClient — listSigningEnvelopes', () => {
  it('GETs /compliance/signing-envelopes/page and unwraps PageResult', async () => {
    const item: SigningEnvelopePageItem = {
      id: 11,
      envelopeNo: 'ENV-11',
      status: 'PENDING',
      createTime: '2026-05-05T00:00:00',
    };
    const { fetch, calls } = captureFetch(() =>
      jsonResponse({ code: 0, data: { total: 1, list: [item] } }),
    );
    const client = clientWith(fetch);
    const page = await client.compliance.listSigningEnvelopes({ pageSize: 20 });
    expect(calls[0].url).toContain('/compliance/signing-envelopes/page');
    expect(queryOf(calls[0].url).get('pageSize')).toBe('20');
    expect(page.list[0].envelopeNo).toBe('ENV-11');
  });
});

describe('ComplianceClient — listEnvelopeContracts (S4)', () => {
  it('GETs /compliance/signing-envelopes/{id}/contracts and unwraps a plain array', async () => {
    const item: EnvelopeContractItem = {
      id: 21,
      envelopeId: 11,
      contractNo: 'CT-21',
      title: 'NDA',
      mimeType: 'application/pdf',
      size: 4096,
      hashAlgorithm: 'sha256',
      contentHash: 'h-content',
      signedContentHash: 'h-signed',
      status: 'SIGNED',
      createTime: '2026-05-20T00:00:00',
    };
    const { fetch, calls } = captureFetch(() =>
      jsonResponse({ code: 0, data: [item] }),
    );
    const client = clientWith(fetch);
    const contracts = await client.compliance.listEnvelopeContracts(11);
    expect(calls[0].url).toContain('/admin-api/compliance/signing-envelopes/11/contracts');
    expect(calls[0].url).not.toContain('/api/v4');
    expect(calls[0].init.headers).toMatchObject({ Authorization: 'Bearer token-1' });
    expect(Array.isArray(contracts)).toBe(true);
    expect(contracts).toHaveLength(1);
    expect(contracts[0].contractNo).toBe('CT-21');
    expect(contracts[0].signedContentHash).toBe('h-signed');
    expect(contracts[0].createTime).toBe('2026-05-20T00:00:00');
  });

  it('GET retries once on 401 (token refresh path)', async () => {
    let firstSeen = false;
    const { fetch, calls } = captureFetch(() => {
      if (!firstSeen) {
        firstSeen = true;
        return emptyResponse(401);
      }
      return jsonResponse({ code: 0, data: [] });
    });
    const client = clientWith(fetch);
    client.forceRefresh = async () => {
      client.tokens = { ...client.tokens!, access_token: 'token-2' };
    };
    const contracts = await client.compliance.listEnvelopeContracts(11);
    expect(contracts).toHaveLength(0);
    expect(calls).toHaveLength(2);
    expect(calls[1].init.headers).toMatchObject({ Authorization: 'Bearer token-2' });
  });
});

describe('ComplianceClient — listEnvelopeProviderRequests (S4)', () => {
  it('GETs /compliance/signing-envelopes/{id}/provider-requests and reuses OperationPageItem', async () => {
    const item: OperationPageItem = {
      id: 31,
      operationId: 'op-31',
      status: 'SUCCESS',
      terminal: true,
      retryable: false,
      attemptCount: 1,
      createTime: '2026-05-21T00:00:00',
    };
    const { fetch, calls } = captureFetch(() =>
      jsonResponse({ code: 0, data: [item] }),
    );
    const client = clientWith(fetch);
    const ops = await client.compliance.listEnvelopeProviderRequests(11);
    expect(calls[0].url).toContain('/compliance/signing-envelopes/11/provider-requests');
    expect(calls[0].init.headers).toMatchObject({ Authorization: 'Bearer token-1' });
    expect(Array.isArray(ops)).toBe(true);
    expect(ops[0].operationId).toBe('op-31');
    expect(ops[0].terminal).toBe(true);
  });
});

describe('ComplianceClient — listSealApprovals', () => {
  it('GETs /compliance/seal-approvals/page and unwraps PageResult', async () => {
    const item: SealApprovalPageItem = {
      id: 13,
      status: 'PENDING',
      createTime: '2026-05-06T00:00:00',
    };
    const { fetch, calls } = captureFetch(() =>
      jsonResponse({ code: 0, data: { total: 1, list: [item] } }),
    );
    const client = clientWith(fetch);
    const page = await client.compliance.listSealApprovals({ status: 'PENDING' });
    expect(calls[0].url).toContain('/compliance/seal-approvals/page');
    expect(queryOf(calls[0].url).get('status')).toBe('PENDING');
    expect(page.total).toBe(1);
    expect(page.list[0].id).toBe(13);
  });

  it('sends Authorization Bearer header on the paginated GET', async () => {
    const { fetch, calls } = captureFetch(() =>
      jsonResponse({ code: 0, data: { total: 0, list: [] } }),
    );
    const client = clientWith(fetch);
    await client.compliance.listSealApprovals();
    expect(calls[0].init.headers).toMatchObject({ Authorization: 'Bearer token-1' });
  });
});

describe('ComplianceClient — listSealUses (S6)', () => {
  it('GETs /compliance/seal-uses/page and unwraps PageResult', async () => {
    const item: SealUsePageItem = {
      id: 41,
      envelopeId: 11,
      contractId: 21,
      sealId: 7,
      usageStatus: 'CONSUMED',
      signLocationType: 'KEYWORD',
      invokedAt: '2026-05-22T10:00:00',
      consumedAt: '2026-05-22T10:00:05',
      createTime: '2026-05-22T10:00:00',
    };
    const { fetch, calls } = captureFetch(() =>
      jsonResponse({ code: 0, data: { total: 1, list: [item] } }),
    );
    const client = clientWith(fetch);
    const page = await client.compliance.listSealUses();
    expect(calls[0].url).toContain('/admin-api/compliance/seal-uses/page');
    expect(calls[0].url).not.toContain('/api/v4');
    expect(calls[0].init.headers).toMatchObject({ Authorization: 'Bearer token-1' });
    expect(page.total).toBe(1);
    expect(page.list).toHaveLength(1);
    expect(page.list[0].id).toBe(41);
    expect(page.list[0].usageStatus).toBe('CONSUMED');
    expect(page.list[0].consumedAt).toBe('2026-05-22T10:00:05');
  });

  it('serializes pageNo/pageSize + sealId/envelopeId/usageStatus/createTime* filters into query', async () => {
    const { fetch, calls } = captureFetch(() =>
      jsonResponse({ code: 0, data: { total: 0, list: [] } }),
    );
    const client = clientWith(fetch);
    await client.compliance.listSealUses({
      pageNo: 2,
      pageSize: 50,
      sealId: 7,
      envelopeId: 11,
      usageStatus: 'CONSUMED',
      createTimeStart: '2026-05-01 00:00:00',
      createTimeEnd: '2026-05-22 23:59:59',
    });
    const q = queryOf(calls[0].url);
    expect(q.get('pageNo')).toBe('2');
    expect(q.get('pageSize')).toBe('50');
    expect(q.get('sealId')).toBe('7');
    expect(q.get('envelopeId')).toBe('11');
    expect(q.get('usageStatus')).toBe('CONSUMED');
    expect(q.get('createTimeStart')).toBe('2026-05-01 00:00:00');
    expect(q.get('createTimeEnd')).toBe('2026-05-22 23:59:59');
  });

  it('omits empty filters — no query string when called with no args', async () => {
    const { fetch, calls } = captureFetch(() =>
      jsonResponse({ code: 0, data: { total: 0, list: [] } }),
    );
    const client = clientWith(fetch);
    await client.compliance.listSealUses();
    expect(calls[0].url.endsWith('/compliance/seal-uses/page')).toBe(true);
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
    const page = await client.compliance.listSealUses();
    expect(page.total).toBe(0);
    expect(calls).toHaveLength(2);
    expect(calls[1].init.headers).toMatchObject({ Authorization: 'Bearer token-2' });
  });
});
