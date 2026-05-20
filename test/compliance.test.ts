// compliance.test.ts — ComplianceClient subclient unit tests (fake fetch)。
//
// 覆盖：URL 拼接 / Authorization header / Idempotency-Key / GET retry / POST no retry /
//      POST no 401 replay / CommonResult 解包 / numeric error classify / step-up
//      semantics / Timestamp polling 终态 / Provider request polling 终态 / public
//      verify 隐私边界。

import { describe, expect, it } from 'vitest';

import {
  Client,
  CompliancePollError,
  classifyComplianceError,
  isComplianceBusinessError,
  BusinessError,
} from '../src/index';

const future = new Date(Date.now() + 60_000).toISOString();

function clientWith(fetchImpl: typeof fetch, opts: { complianceBaseURL?: string } = {}): Client {
  const client = new Client({
    serverURL: 'https://nexus.test',
    complianceBaseURL: opts.complianceBaseURL,
    fetchImpl,
  });
  client.tokens = {
    access_token: 'token-1',
    refresh_token: 'refresh-1',
    expires_at: future,
    scope: 'compliance:evidence:write compliance:timestamp:issue',
    client_id: 'client-1',
    server_url: 'https://nexus.test',
  };
  return client;
}

/** 未 login 的客户端 — tokens 保持 null（构造函数不加载 store）。用于公开 verify 匿名路径测试。 */
function anonClient(fetchImpl: typeof fetch, opts: { complianceBaseURL?: string } = {}): Client {
  return new Client({
    serverURL: 'https://nexus.test',
    complianceBaseURL: opts.complianceBaseURL,
    fetchImpl,
  });
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function emptyResponse(status: number, headers: Record<string, string> = {}): Response {
  return new Response('', { status, headers });
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

describe('Client.complianceURL', () => {
  it('defaults to ${serverURL}/admin-api when complianceBaseURL not set', () => {
    const c = new Client({ serverURL: 'https://nexus.test' });
    expect(c.complianceURL('/compliance/timestamps')).toBe(
      'https://nexus.test/admin-api/compliance/timestamps',
    );
  });

  it('honors complianceBaseURL override', () => {
    const c = new Client({
      serverURL: 'https://nexus.test',
      complianceBaseURL: 'https://compliance.test',
    });
    expect(c.complianceURL('/compliance/timestamps/1')).toBe(
      'https://compliance.test/compliance/timestamps/1',
    );
  });

  it('trims trailing slash on complianceBaseURL', () => {
    const c = new Client({
      serverURL: 'https://nexus.test',
      complianceBaseURL: 'https://compliance.test/',
    });
    expect(c.complianceURL('/x')).toBe('https://compliance.test/x');
  });

  it('does not collide with apiURL (/api/v4)', () => {
    const c = new Client({ serverURL: 'https://nexus.test' });
    expect(c.apiURL('/chat')).toBe('https://nexus.test/api/v4/chat');
    expect(c.complianceURL('/compliance/x')).toBe(
      'https://nexus.test/admin-api/compliance/x',
    );
  });
});

describe('ComplianceClient — read (GET)', () => {
  it('sends Authorization Bearer header on GET', async () => {
    const { fetch, calls } = captureFetch(() =>
      jsonResponse({ code: 0, data: { id: 1, evidenceNo: 'EV-1' } }),
    );
    const client = clientWith(fetch);
    await client.compliance.getEvidenceAsset(1);
    expect(calls[0].init.headers).toMatchObject({ Authorization: 'Bearer token-1' });
  });

  it('GET getEvidenceAsset returns unwrapped data', async () => {
    const { fetch } = captureFetch(() =>
      jsonResponse({
        code: 0,
        data: { id: 1, evidenceNo: 'EV-1', assetType: 'HASH_ONLY', name: 'x', hashAlgorithm: 'sha256', contentHash: 'h', digestSource: 'CLIENT', privacyLevel: 'private', status: 'READY' },
      }),
    );
    const client = clientWith(fetch);
    const out = await client.compliance.getEvidenceAsset(1);
    expect(out.evidenceNo).toBe('EV-1');
    expect(out.assetType).toBe('HASH_ONLY');
  });

  it('GET retries once on 401 (token refresh path)', async () => {
    let firstSeen = false;
    const { fetch, calls } = captureFetch((_call) => {
      if (!firstSeen) {
        firstSeen = true;
        return emptyResponse(401);
      }
      return jsonResponse({ code: 0, data: { id: 1, evidenceNo: 'EV-1' } });
    });
    const client = clientWith(fetch);
    // forceRefresh would hit OAuth metadata; stub it to keep the test offline.
    client.forceRefresh = async () => {
      client.tokens = { ...client.tokens!, access_token: 'token-2' };
    };
    const out = await client.compliance.getEvidenceAsset(1);
    expect(out.id).toBe(1);
    expect(calls).toHaveLength(2);
    expect(calls[1].init.headers).toMatchObject({ Authorization: 'Bearer token-2' });
  });

  it('publicVerify omits PII and storage fields (privacy boundary)', async () => {
    const { fetch, calls } = captureFetch(() =>
      jsonResponse({
        code: 0,
        data: {
          evidenceNo: 'EV-public',
          assetType: 'HASH_ONLY',
          hashAlgorithm: 'sha256',
          contentHash: 'abcd',
          verifiedAt: '2026-01-01T00:00:00',
          manifestOfflineVerify: true,
        },
      }),
    );
    const client = clientWith(fetch);
    const out = await client.compliance.verifyEvidencePublic({ evidenceNo: 'EV-public' });
    expect(out.evidenceNo).toBe('EV-public');
    expect(out.manifestOfflineVerify).toBe(true);
    // 隐私边界：返回字段不允许出现 PII / storage / provider raw / subject snapshot
    expect((out as unknown as Record<string, unknown>).storageBucket).toBeUndefined();
    expect((out as unknown as Record<string, unknown>).storageKey).toBeUndefined();
    expect((out as unknown as Record<string, unknown>).subjectSnapshotId).toBeUndefined();
    expect((out as unknown as Record<string, unknown>).provider).toBeUndefined();
    expect(calls[0].url).toContain('/compliance/evidence/verify?evidenceNo=EV-public');
  });
});

describe('ComplianceClient — public verify (anonymous)', () => {
  const publicData = {
    code: 0,
    data: {
      evidenceNo: 'EV-public',
      assetType: 'HASH_ONLY',
      hashAlgorithm: 'sha256',
      contentHash: 'abcd',
      manifestOfflineVerify: true,
    },
  };

  it('does not throw "not authorized" when called without login', async () => {
    const { fetch } = captureFetch(() => jsonResponse(publicData));
    const client = anonClient(fetch);
    expect(client.isAuthorized()).toBe(false);
    // 未 login 不再走 ensureToken 抛错路径
    const out = await client.compliance.verifyEvidencePublic({ evidenceNo: 'EV-public' });
    expect(out.evidenceNo).toBe('EV-public');
  });

  it('sends NO Authorization header when not logged in (anonymous request)', async () => {
    const { fetch, calls } = captureFetch(() => jsonResponse(publicData));
    const client = anonClient(fetch);
    await client.compliance.verifyEvidencePublic({ evidenceNo: 'EV-public' });
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers.Authorization).toBeUndefined();
  });

  it('sends Authorization header when a token is present (audit context preserved)', async () => {
    const { fetch, calls } = captureFetch(() => jsonResponse(publicData));
    const client = clientWith(fetch);
    await client.compliance.verifyEvidencePublic({ evidenceNo: 'EV-public' });
    expect(calls[0].init.headers).toMatchObject({ Authorization: 'Bearer token-1' });
  });

  it('honors complianceBaseURL and never targets /api/v4', async () => {
    const { fetch, calls } = captureFetch(() => jsonResponse(publicData));
    const client = anonClient(fetch, { complianceBaseURL: 'https://compliance.test' });
    await client.compliance.verifyEvidencePublic({ evidenceNo: 'EV-public' });
    expect(calls[0].url).toBe(
      'https://compliance.test/compliance/evidence/verify?evidenceNo=EV-public',
    );
    expect(calls[0].url).not.toContain('/api/v4');
  });

  it('defaults to ${serverURL}/admin-api and never targets /api/v4', async () => {
    const { fetch, calls } = captureFetch(() => jsonResponse(publicData));
    const client = anonClient(fetch);
    await client.compliance.verifyEvidencePublic({ publicVerifyCode: 'PVC-1' });
    expect(calls[0].url).toBe(
      'https://nexus.test/admin-api/compliance/evidence/verify?publicVerifyCode=PVC-1',
    );
    expect(calls[0].url).not.toContain('/api/v4');
  });

  it('401 does NOT trigger forceRefresh or replay (public endpoint, no refresh)', async () => {
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
      client.compliance.verifyEvidencePublic({ evidenceNo: 'EV-public' }),
    ).rejects.toThrow();
    expect(count).toBe(1);
    expect(calls).toHaveLength(1);
    expect(refreshCount).toBe(0); // public verify 不触发 forceRefresh
  });
});

describe('ComplianceClient — write (POST)', () => {
  it('sends Idempotency-Key header when provided', async () => {
    const { fetch, calls } = captureFetch(() =>
      jsonResponse({ code: 0, data: { id: 10, evidenceNo: 'EV-2', assetType: 'HASH_ONLY' } }),
    );
    const client = clientWith(fetch);
    await client.compliance.createEvidenceAsset(
      {
        assetType: 'HASH_ONLY',
        name: 'doc',
        hashAlgorithm: 'sha256',
        declaredHash: 'aabb',
      },
      { idempotencyKey: 'user-key-1' },
    );
    expect(calls[0].init.headers).toMatchObject({
      'Idempotency-Key': 'user-key-1',
      'Content-Type': 'application/json',
    });
  });

  it('omits Idempotency-Key header when not provided (server falls back to UUID)', async () => {
    const { fetch, calls } = captureFetch(() =>
      jsonResponse({ code: 0, data: { id: 10, evidenceNo: 'EV-2', assetType: 'HASH_ONLY' } }),
    );
    const client = clientWith(fetch);
    await client.compliance.createEvidenceAsset({
      assetType: 'HASH_ONLY',
      name: 'doc',
      hashAlgorithm: 'sha256',
      declaredHash: 'aabb',
    });
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers['Idempotency-Key']).toBeUndefined();
  });

  it('POST does NOT auto-retry on 401 (no replay — compliance write safety)', async () => {
    let count = 0;
    const { fetch, calls } = captureFetch(() => {
      count++;
      return emptyResponse(401);
    });
    const client = clientWith(fetch);
    let stubbedRefresh = 0;
    client.forceRefresh = async () => {
      stubbedRefresh++;
    };
    await expect(
      client.compliance.issueTimestamp({ hashAlgorithm: 'sha256', digest: 'd' }),
    ).rejects.toThrow();
    expect(count).toBe(1);
    expect(calls).toHaveLength(1);
    expect(stubbedRefresh).toBe(0); // 写路径不主动触发 forceRefresh
  });

  it('POST does NOT auto-retry on 5xx (no retry — compliance write safety)', async () => {
    let count = 0;
    const { fetch } = captureFetch(() => {
      count++;
      return emptyResponse(503);
    });
    const client = clientWith(fetch);
    await expect(
      client.compliance.issueTimestamp({ hashAlgorithm: 'sha256', digest: 'd' }),
    ).rejects.toThrow();
    expect(count).toBe(1);
  });

  it('signing envelope create never sends caller-controlled tenant header/body', async () => {
    const { fetch, calls } = captureFetch(() =>
      jsonResponse({ code: 0, data: 42 }),
    );
    const client = clientWith(fetch);
    const id = await client.compliance.createSigningEnvelope(
      { envelopeNo: 'ENV-1' },
      { idempotencyKey: 'env-1' },
    );
    expect(id).toBe(42);
    expect(calls[0].init.headers).toMatchObject({
      'Idempotency-Key': 'env-1',
    });
    expect(calls[0].init.headers).not.toHaveProperty('tenant-id');
    const body = JSON.parse(String(calls[0].init.body));
    expect(body).not.toHaveProperty('tenantId');
    expect(body).not.toHaveProperty('applicantUserId');
  });

  it('issueTimestamp request body does NOT contain provider field', async () => {
    const { fetch, calls } = captureFetch(() =>
      jsonResponse({ code: 0, data: { id: 1, assetId: 1, verificationStatus: 'PENDING' } }),
    );
    const client = clientWith(fetch);
    await client.compliance.issueTimestamp({
      name: 'doc',
      hashAlgorithm: 'sha256',
      digest: 'aabb',
    });
    const body = JSON.parse(String(calls[0].init.body));
    expect(body).not.toHaveProperty('provider');
  });
});

describe('ComplianceClient — error classification', () => {
  it('classifies a numeric Java step-up code correctly', () => {
    const err = new BusinessError(1031000013, '该高风险动作要求 step-up 或 token introspection');
    const info = classifyComplianceError(err);
    expect(info.key).toBe('COMPLIANCE_STEP_UP_REQUIRED');
    expect(info.stepUpRequired).toBe(true);
    expect(info.retryable).toBe(false);
  });

  it('classifies envelope gate closed as terminal & non-retryable', () => {
    const err = new BusinessError(1031004004, 'gate closed');
    const info = classifyComplianceError(err);
    expect(info.key).toBe('ENVELOPE_GATE_CLOSED');
    expect(info.terminal).toBe(true);
    expect(info.retryable).toBe(false);
  });

  it('classifies provider unknown / not configured as terminal', () => {
    const notConfigured = classifyComplianceError(new BusinessError(1031003003, 'provider not configured'));
    expect(notConfigured.key).toBe('PROVIDER_NOT_CONFIGURED');
    expect(notConfigured.terminal).toBe(true);

    const unk = classifyComplianceError(new BusinessError(1031003001, 'provider unknown'));
    expect(unk.key).toBe('PROVIDER_REQUEST_UNKNOWN_NO_RETRY');
    expect(unk.terminal).toBe(true);
  });

  it('classifies timestamp local verify failed as terminal', () => {
    const info = classifyComplianceError(new BusinessError(1031002009, 'local verify failed'));
    expect(info.key).toBe('TIMESTAMP_LOCAL_VERIFY_FAILED');
    expect(info.terminal).toBe(true);
  });

  it('classifies seal approval mismatches as terminal', () => {
    const cases: Array<[number, string]> = [
      [1031005013, 'SEAL_APPROVAL_EXPIRED'],
      [1031005015, 'SEAL_APPROVAL_NONCE_USED'],
      [1031005019, 'SEAL_APPROVAL_CONTRACT_HASH_MISMATCH'],
    ];
    for (const [code, expected] of cases) {
      const info = classifyComplianceError(new BusinessError(code, 'x'));
      expect(info.key).toBe(expected);
      expect(info.terminal).toBe(true);
    }
  });

  it('unrecognized code → UNKNOWN_COMPLIANCE_ERROR', () => {
    const info = classifyComplianceError(new BusinessError(1031999999, 'unknown'));
    expect(info.key).toBe('UNKNOWN_COMPLIANCE_ERROR');
  });

  it('isComplianceBusinessError filters by segment', () => {
    expect(isComplianceBusinessError(new BusinessError(1031000013, 'x'))).toBe(true);
    expect(isComplianceBusinessError(new BusinessError(1, 'x'))).toBe(false);
    expect(isComplianceBusinessError(new BusinessError(2_000_000, 'x'))).toBe(false);
  });
});

describe('ComplianceClient — polling', () => {
  it('waitForTimestampVerified returns on VERIFIED', async () => {
    const seq = [
      { code: 0, data: { id: 5, assetId: 1, verificationStatus: 'UNKNOWN' } },
      { code: 0, data: { id: 5, assetId: 1, verificationStatus: 'PENDING' } },
      { code: 0, data: { id: 5, assetId: 1, verificationStatus: 'VERIFIED' } },
    ];
    let i = 0;
    const { fetch } = captureFetch(() => jsonResponse(seq[i++]));
    const client = clientWith(fetch);
    const out = await client.compliance.waitForTimestampVerified(5, {
      initialIntervalMs: 1,
      maxIntervalMs: 2,
      multiplier: 1,
      timeoutMs: 1000,
    });
    expect(out.verificationStatus).toBe('VERIFIED');
  });

  it('waitForTimestampVerified throws CompliancePollError on FAILED', async () => {
    const { fetch } = captureFetch(() =>
      jsonResponse({ code: 0, data: { id: 5, assetId: 1, verificationStatus: 'FAILED' } }),
    );
    const client = clientWith(fetch);
    await expect(
      client.compliance.waitForTimestampVerified(5, {
        initialIntervalMs: 1,
        timeoutMs: 100,
      }),
    ).rejects.toBeInstanceOf(CompliancePollError);
  });

  it('waitForTimestampVerified throws CompliancePollError on LOCAL_VERIFY_FAILED', async () => {
    const { fetch } = captureFetch(() =>
      jsonResponse({
        code: 0,
        data: { id: 5, assetId: 1, verificationStatus: 'LOCAL_VERIFY_FAILED' },
      }),
    );
    const client = clientWith(fetch);
    let captured: CompliancePollError | undefined;
    try {
      await client.compliance.waitForTimestampVerified(5, {
        initialIntervalMs: 1,
        timeoutMs: 100,
      });
    } catch (e) {
      captured = e as CompliancePollError;
    }
    expect(captured?.kind).toBe('terminal_failure');
  });

  it('waitForTimestampVerified throws on timeout (UNKNOWN never terminates)', async () => {
    const { fetch } = captureFetch(() =>
      jsonResponse({ code: 0, data: { id: 5, assetId: 1, verificationStatus: 'UNKNOWN' } }),
    );
    const client = clientWith(fetch);
    let captured: CompliancePollError | undefined;
    try {
      await client.compliance.waitForTimestampVerified(5, {
        initialIntervalMs: 5,
        maxIntervalMs: 5,
        timeoutMs: 30,
      });
    } catch (e) {
      captured = e as CompliancePollError;
    }
    expect(captured?.kind).toBe('timeout');
  });

  it('waitForProviderRequestTerminal returns on SUCCESS', async () => {
    const seq = [
      { code: 0, data: { id: 8, status: 'UNKNOWN', terminal: false, retryable: false } },
      { code: 0, data: { id: 8, status: 'SUCCESS', terminal: true, retryable: false } },
    ];
    let i = 0;
    const { fetch } = captureFetch(() => jsonResponse(seq[i++]));
    const client = clientWith(fetch);
    const out = await client.compliance.waitForProviderRequestTerminal(8, {
      initialIntervalMs: 1,
      multiplier: 1,
      timeoutMs: 200,
    });
    expect(out.status).toBe('SUCCESS');
    expect(out.terminal).toBe(true);
  });

  it('waitForProviderRequestTerminal throws on FAILED', async () => {
    const { fetch } = captureFetch(() =>
      jsonResponse({ code: 0, data: { id: 8, status: 'FAILED', terminal: true, retryable: false } }),
    );
    const client = clientWith(fetch);
    let captured: CompliancePollError | undefined;
    try {
      await client.compliance.waitForProviderRequestTerminal(8, { initialIntervalMs: 1 });
    } catch (e) {
      captured = e as CompliancePollError;
    }
    expect(captured?.kind).toBe('terminal_failure');
  });
});
