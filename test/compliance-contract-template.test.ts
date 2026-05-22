// compliance-contract-template.test.ts — ComplianceClient.contractTemplate*
// 方法覆盖（compliance gateway S5 / gap-register U-2）。
//
// 覆盖：URL 拼接 / Authorization header / Idempotency-Key / GET retry / POST no retry /
//      POST no 401 replay / CommonResult 解包 / PageResult{total,list} 形态 /
//      过滤项为空时不发空参数 / createTime* 原样透传 / pdfBase64 写入 JSON body /
//      versions 返回普通数组。

import { describe, expect, it } from 'vitest';

import { Client } from '../src/index';
import type {
  ContractTemplatePageItem,
  ContractTemplateResp,
  ContractTemplateVersion,
} from '../src/index';

const future = new Date(Date.now() + 60_000).toISOString();

function clientWith(fetchImpl: typeof fetch): Client {
  const client = new Client({ serverURL: 'https://nexus.test', fetchImpl });
  client.tokens = {
    access_token: 'token-1',
    refresh_token: 'refresh-1',
    expires_at: future,
    scope:
      'compliance:contract_template:read compliance:contract_template:write',
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

function captureFetch(
  handler: (call: CapturedCall, callIndex: number) => Response | Promise<Response>,
): { fetch: typeof fetch; calls: CapturedCall[] } {
  const calls: CapturedCall[] = [];
  const fn: typeof fetch = async (url, init) => {
    const call: CapturedCall = { url: String(url), init: init ?? {} };
    calls.push(call);
    return handler(call, calls.length - 1);
  };
  return { fetch: fn, calls };
}

function queryOf(url: string): URLSearchParams {
  const qIdx = url.indexOf('?');
  return new URLSearchParams(qIdx < 0 ? '' : url.slice(qIdx + 1));
}

const baseTemplate: ContractTemplateResp = {
  id: 1,
  templateNo: 'CT-1',
  name: 'NDA',
  description: 'mutual NDA',
  status: 'DRAFT',
  pdfHash: null,
  pdfPageCount: null,
  fields: [],
  currentVersion: 0,
  createTime: '2026-05-22T00:00:00',
};

// =============================================================================
// createContractTemplate
// =============================================================================

describe('ComplianceClient — createContractTemplate', () => {
  it('POSTs /compliance/contract-templates with Idempotency-Key and JSON body', async () => {
    const { fetch, calls } = captureFetch(() =>
      jsonResponse({ code: 0, data: baseTemplate }),
    );
    const client = clientWith(fetch);
    const out = await client.compliance.createContractTemplate(
      { name: 'NDA', description: 'mutual NDA' },
      { idempotencyKey: 'tpl-create-1' },
    );
    expect(out.id).toBe(1);
    expect(out.status).toBe('DRAFT');
    expect(calls[0].url).toContain('/admin-api/compliance/contract-templates');
    expect(calls[0].url).not.toContain('/api/v4');
    expect((calls[0].init.method ?? 'GET').toUpperCase()).toBe('POST');
    expect(calls[0].init.headers).toMatchObject({
      Authorization: 'Bearer token-1',
      'Idempotency-Key': 'tpl-create-1',
      'Content-Type': 'application/json',
    });
    const body = JSON.parse(String(calls[0].init.body));
    expect(body).toEqual({ name: 'NDA', description: 'mutual NDA' });
  });

  it('omits Idempotency-Key header when not provided (server falls back to UUID)', async () => {
    const { fetch, calls } = captureFetch(() =>
      jsonResponse({ code: 0, data: baseTemplate }),
    );
    const client = clientWith(fetch);
    await client.compliance.createContractTemplate({ name: 'NDA' });
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers['Idempotency-Key']).toBeUndefined();
  });

  it('does NOT auto-retry / replay on 401 (write safety)', async () => {
    let count = 0;
    const { fetch, calls } = captureFetch(() => {
      count++;
      return emptyResponse(401);
    });
    const client = clientWith(fetch);
    let refreshCount = 0;
    client.forceRefresh = async () => {
      refreshCount++;
    };
    await expect(
      client.compliance.createContractTemplate({ name: 'NDA' }),
    ).rejects.toThrow();
    expect(count).toBe(1);
    expect(calls).toHaveLength(1);
    expect(refreshCount).toBe(0);
  });

  it('does NOT auto-retry on 5xx (write safety)', async () => {
    let count = 0;
    const { fetch } = captureFetch(() => {
      count++;
      return emptyResponse(503);
    });
    const client = clientWith(fetch);
    await expect(
      client.compliance.createContractTemplate({ name: 'NDA' }),
    ).rejects.toThrow();
    expect(count).toBe(1);
  });
});

// =============================================================================
// updateContractTemplate
// =============================================================================

describe('ComplianceClient — updateContractTemplate', () => {
  it('POSTs /compliance/contract-templates/{id} with partial body', async () => {
    const { fetch, calls } = captureFetch(() =>
      jsonResponse({ code: 0, data: { ...baseTemplate, name: 'NDA v2' } }),
    );
    const client = clientWith(fetch);
    const out = await client.compliance.updateContractTemplate(
      1,
      { name: 'NDA v2' },
      { idempotencyKey: 'tpl-update-1' },
    );
    expect(out.name).toBe('NDA v2');
    expect(calls[0].url).toContain('/compliance/contract-templates/1');
    expect(calls[0].url).not.toContain('/delete');
    expect(calls[0].url).not.toContain('/pdf');
    expect((calls[0].init.method ?? 'GET').toUpperCase()).toBe('POST');
    expect(calls[0].init.headers).toMatchObject({
      'Idempotency-Key': 'tpl-update-1',
      'Content-Type': 'application/json',
    });
    const body = JSON.parse(String(calls[0].init.body));
    expect(body).toEqual({ name: 'NDA v2' });
  });

  it('accepts fields payload and forwards as-is (no client-side validation)', async () => {
    const { fetch, calls } = captureFetch(() =>
      jsonResponse({ code: 0, data: baseTemplate }),
    );
    const client = clientWith(fetch);
    await client.compliance.updateContractTemplate(1, {
      fields: [
        {
          key: 'sig-1',
          type: 'signature',
          label: '签名',
          page: 1,
          x: 100,
          y: 200,
          width: 80,
          height: 30,
          assignedRole: 'partyA',
          order: 0,
          required: true,
        },
      ],
    });
    const body = JSON.parse(String(calls[0].init.body));
    expect(body.fields).toHaveLength(1);
    expect(body.fields[0].type).toBe('signature');
    expect(body.fields[0].assignedRole).toBe('partyA');
  });
});

// =============================================================================
// deleteContractTemplate
// =============================================================================

describe('ComplianceClient — deleteContractTemplate', () => {
  it('POSTs /compliance/contract-templates/{id}/delete (no body) and returns void', async () => {
    const { fetch, calls } = captureFetch(() =>
      jsonResponse({ code: 0, data: null }),
    );
    const client = clientWith(fetch);
    await client.compliance.deleteContractTemplate(7, { idempotencyKey: 'del-7' });
    expect(calls[0].url).toContain('/compliance/contract-templates/7/delete');
    expect((calls[0].init.method ?? 'GET').toUpperCase()).toBe('POST');
    expect(calls[0].init.headers).toMatchObject({ 'Idempotency-Key': 'del-7' });
    expect(calls[0].init.body).toBeUndefined();
  });

  it('does NOT auto-retry / replay on 401 (write safety)', async () => {
    let count = 0;
    const { fetch } = captureFetch(() => {
      count++;
      return emptyResponse(401);
    });
    const client = clientWith(fetch);
    await expect(client.compliance.deleteContractTemplate(7)).rejects.toThrow();
    expect(count).toBe(1);
  });
});

// =============================================================================
// getContractTemplate
// =============================================================================

describe('ComplianceClient — getContractTemplate', () => {
  it('GETs /compliance/contract-templates/{id} with Authorization', async () => {
    const { fetch, calls } = captureFetch(() =>
      jsonResponse({ code: 0, data: baseTemplate }),
    );
    const client = clientWith(fetch);
    const out = await client.compliance.getContractTemplate(1);
    expect(out.templateNo).toBe('CT-1');
    expect(calls[0].url).toContain('/compliance/contract-templates/1');
    expect((calls[0].init.method ?? 'GET').toUpperCase()).toBe('GET');
    expect(calls[0].init.headers).toMatchObject({ Authorization: 'Bearer token-1' });
  });

  it('GET retries once on 401 (token refresh path)', async () => {
    let firstSeen = false;
    const { fetch, calls } = captureFetch(() => {
      if (!firstSeen) {
        firstSeen = true;
        return emptyResponse(401);
      }
      return jsonResponse({ code: 0, data: baseTemplate });
    });
    const client = clientWith(fetch);
    client.forceRefresh = async () => {
      client.tokens = { ...client.tokens!, access_token: 'token-2' };
    };
    const out = await client.compliance.getContractTemplate(1);
    expect(out.id).toBe(1);
    expect(calls).toHaveLength(2);
    expect(calls[1].init.headers).toMatchObject({ Authorization: 'Bearer token-2' });
  });
});

// =============================================================================
// listContractTemplates
// =============================================================================

describe('ComplianceClient — listContractTemplates', () => {
  it('GETs /compliance/contract-templates/page and unwraps PageResult', async () => {
    const item: ContractTemplatePageItem = {
      id: 1,
      templateNo: 'CT-1',
      name: 'NDA',
      status: 'DRAFT',
      currentVersion: 0,
      createTime: '2026-05-22T00:00:00',
    };
    const { fetch, calls } = captureFetch(() =>
      jsonResponse({ code: 0, data: { total: 1, list: [item] } }),
    );
    const client = clientWith(fetch);
    const page = await client.compliance.listContractTemplates();
    expect(calls[0].url).toContain('/admin-api/compliance/contract-templates/page');
    expect(calls[0].url).not.toContain('/api/v4');
    expect(page.total).toBe(1);
    expect(page.list).toHaveLength(1);
    expect(page.list[0].templateNo).toBe('CT-1');
    // 列表项不下发 fields
    expect((page.list[0] as unknown as Record<string, unknown>).fields).toBeUndefined();
  });

  it('serializes pageNo/pageSize/status/createTime* into query', async () => {
    const { fetch, calls } = captureFetch(() =>
      jsonResponse({ code: 0, data: { total: 0, list: [] } }),
    );
    const client = clientWith(fetch);
    await client.compliance.listContractTemplates({
      pageNo: 2,
      pageSize: 50,
      status: 'PUBLISHED',
      createTimeStart: '2026-05-01 00:00:00',
      createTimeEnd: '2026-05-22 23:59:59',
    });
    const q = queryOf(calls[0].url);
    expect(q.get('pageNo')).toBe('2');
    expect(q.get('pageSize')).toBe('50');
    expect(q.get('status')).toBe('PUBLISHED');
    expect(q.get('createTimeStart')).toBe('2026-05-01 00:00:00');
    expect(q.get('createTimeEnd')).toBe('2026-05-22 23:59:59');
  });

  it('omits empty filters — no query string when called with no args', async () => {
    const { fetch, calls } = captureFetch(() =>
      jsonResponse({ code: 0, data: { total: 0, list: [] } }),
    );
    const client = clientWith(fetch);
    await client.compliance.listContractTemplates();
    expect(calls[0].url.endsWith('/compliance/contract-templates/page')).toBe(true);
    expect(calls[0].url).not.toContain('?');
  });
});

// =============================================================================
// uploadContractTemplatePdf
// =============================================================================

describe('ComplianceClient — uploadContractTemplatePdf', () => {
  it('POSTs /compliance/contract-templates/{id}/pdf with { pdfBase64 } body', async () => {
    const { fetch, calls } = captureFetch(() =>
      jsonResponse({
        code: 0,
        data: { ...baseTemplate, pdfHash: 'h-pdf', pdfPageCount: 4 },
      }),
    );
    const client = clientWith(fetch);
    const out = await client.compliance.uploadContractTemplatePdf(
      1,
      { pdfBase64: 'JVBERi0xLjQ=' },
      { idempotencyKey: 'pdf-upload-1' },
    );
    expect(out.pdfHash).toBe('h-pdf');
    expect(out.pdfPageCount).toBe(4);
    expect(calls[0].url).toContain('/compliance/contract-templates/1/pdf');
    expect((calls[0].init.method ?? 'GET').toUpperCase()).toBe('POST');
    expect(calls[0].init.headers).toMatchObject({
      'Idempotency-Key': 'pdf-upload-1',
      'Content-Type': 'application/json',
    });
    const body = JSON.parse(String(calls[0].init.body));
    expect(body).toEqual({ pdfBase64: 'JVBERi0xLjQ=' });
  });

  it('does NOT auto-retry on 5xx (write safety)', async () => {
    let count = 0;
    const { fetch } = captureFetch(() => {
      count++;
      return emptyResponse(503);
    });
    const client = clientWith(fetch);
    await expect(
      client.compliance.uploadContractTemplatePdf(1, { pdfBase64: 'x' }),
    ).rejects.toThrow();
    expect(count).toBe(1);
  });
});

// =============================================================================
// publishContractTemplate
// =============================================================================

describe('ComplianceClient — publishContractTemplate', () => {
  it('POSTs /compliance/contract-templates/{id}/publish and returns PUBLISHED', async () => {
    const { fetch, calls } = captureFetch(() =>
      jsonResponse({
        code: 0,
        data: { ...baseTemplate, status: 'PUBLISHED', currentVersion: 1 },
      }),
    );
    const client = clientWith(fetch);
    const out = await client.compliance.publishContractTemplate(1, {
      idempotencyKey: 'pub-1',
    });
    expect(out.status).toBe('PUBLISHED');
    expect(out.currentVersion).toBe(1);
    expect(calls[0].url).toContain('/compliance/contract-templates/1/publish');
    expect((calls[0].init.method ?? 'GET').toUpperCase()).toBe('POST');
    expect(calls[0].init.headers).toMatchObject({ 'Idempotency-Key': 'pub-1' });
    expect(calls[0].init.body).toBeUndefined();
  });
});

// =============================================================================
// archiveContractTemplate
// =============================================================================

describe('ComplianceClient — archiveContractTemplate', () => {
  it('POSTs /compliance/contract-templates/{id}/archive and returns ARCHIVED', async () => {
    const { fetch, calls } = captureFetch(() =>
      jsonResponse({
        code: 0,
        data: { ...baseTemplate, status: 'ARCHIVED', currentVersion: 1 },
      }),
    );
    const client = clientWith(fetch);
    const out = await client.compliance.archiveContractTemplate(1, {
      idempotencyKey: 'arc-1',
    });
    expect(out.status).toBe('ARCHIVED');
    expect(calls[0].url).toContain('/compliance/contract-templates/1/archive');
    expect((calls[0].init.method ?? 'GET').toUpperCase()).toBe('POST');
    expect(calls[0].init.headers).toMatchObject({ 'Idempotency-Key': 'arc-1' });
  });
});

// =============================================================================
// listContractTemplateVersions
// =============================================================================

describe('ComplianceClient — listContractTemplateVersions', () => {
  it('GETs /compliance/contract-templates/{id}/versions and unwraps a plain array', async () => {
    const ver: ContractTemplateVersion = {
      id: 11,
      templateId: 1,
      version: 1,
      name: 'NDA',
      pdfHash: 'h-pdf',
      fields: [],
      statusAtSnapshot: 'PUBLISHED',
      createTime: '2026-05-22T01:00:00',
    };
    const { fetch, calls } = captureFetch(() =>
      jsonResponse({ code: 0, data: [ver] }),
    );
    const client = clientWith(fetch);
    const versions = await client.compliance.listContractTemplateVersions(1);
    expect(calls[0].url).toContain('/compliance/contract-templates/1/versions');
    expect((calls[0].init.method ?? 'GET').toUpperCase()).toBe('GET');
    expect(Array.isArray(versions)).toBe(true);
    expect(versions).toHaveLength(1);
    expect(versions[0].version).toBe(1);
    expect(versions[0].statusAtSnapshot).toBe('PUBLISHED');
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
    const out = await client.compliance.listContractTemplateVersions(1);
    expect(out).toHaveLength(0);
    expect(calls).toHaveLength(2);
    expect(calls[1].init.headers).toMatchObject({ Authorization: 'Bearer token-2' });
  });
});
