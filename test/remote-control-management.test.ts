// remote-control-management.test.ts — v2.7.0 远控管理面 + BYOK + chat-bridge CRUD 覆盖
//   - agentRuns.list (分页信封 {records,total,page,pageSize}; records 内 snake_case view)
//   - agentRuns.submitPermissionResult / submitUserMessage / revealRemoteToken
//   - createRemoteRun byok_credential_ref 透传
//   - crabcodeByok.list/create/rotate/revoke (wire snake_case; masked 视图)
//   - chatBridge integration/credential CRUD (请求 snake_case / 响应 camelCase, 契约 §12)
//
// 契约: docs/audit/sdk-remote-control-contract-2026-05-27.md §6/§12/§14/§18 附录 A。

import { describe, expect, it } from 'vitest';

import { Client } from '../src/index';

const future = new Date(Date.now() + 60_000).toISOString();

interface RecordedCall {
  url: string;
  method: string;
  body: unknown;
}

function recordingClient(
  respond: (url: string, init: RequestInit) => Response | Promise<Response>,
): { client: Client; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const client = new Client({
    baseURL: 'https://nexus.test',
    fetchImpl: async (url, init) => {
      const i = init ?? {};
      calls.push({
        url: String(url),
        method: i.method ?? 'GET',
        body: i.body ? JSON.parse(String(i.body)) : null,
      });
      return respond(String(url), i);
    },
  });
  client.tokens = {
    access_token: 'token-1',
    refresh_token: 'refresh-1',
    expires_at: future,
    scope: 'remote_control chat_bridge ai',
    client_id: 'client-1',
    server_url: 'https://nexus.test',
  };
  return { client, calls };
}

function ok(data: unknown): Response {
  return new Response(JSON.stringify({ code: 0, message: 'success', data }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

// =============================================================================
// agentRuns.list
// =============================================================================

describe('agentRuns.list', () => {
  it('sends snake_case query params and unwraps the pagination envelope', async () => {
    const { client, calls } = recordingClient(() =>
      ok({
        records: [
          {
            run_id: 'run_1',
            session_id: 'sess_1',
            status: 'running',
            created_at: '2026-06-11T10:00:00Z',
            metadata: { title: '修复登录bug' },
            runtime: 'crabcode_remote',
            runner: 'cloud',
            adapter: 'remote_io',
          },
        ],
        total: 41,
        page: 2,
        pageSize: 20,
      }),
    );

    const result = await client.agentRuns.list({
      runtime: 'crabcode_remote',
      status: 'running',
      page: 2,
      pageSize: 20,
    });

    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe('GET');
    const url = new URL(calls[0].url);
    expect(url.pathname).toBe('/api/v4/agent-runs');
    expect(url.searchParams.get('runtime')).toBe('crabcode_remote');
    expect(url.searchParams.get('status')).toBe('running');
    expect(url.searchParams.get('page')).toBe('2');
    expect(url.searchParams.get('page_size')).toBe('20');

    expect(result.total).toBe(41);
    expect(result.page).toBe(2);
    expect(result.pageSize).toBe(20);
    expect(result.records).toHaveLength(1);
    expect(result.records[0]).toMatchObject({
      runId: 'run_1',
      sessionId: 'sess_1',
      status: 'running',
      createdAt: '2026-06-11T10:00:00Z',
      runtime: 'crabcode_remote',
      runner: 'cloud',
      adapter: 'remote_io',
    });
    expect(result.records[0].metadata?.title).toBe('修复登录bug');
  });

  it('omits unset filters and tolerates an empty page', async () => {
    const { client, calls } = recordingClient(() =>
      ok({ records: [], total: 0, page: 1, pageSize: 20 }),
    );
    const result = await client.agentRuns.list();
    expect(new URL(calls[0].url).search).toBe('');
    expect(result.records).toEqual([]);
    expect(result.total).toBe(0);
  });
});

// =============================================================================
// submitPermissionResult / submitUserMessage / revealRemoteToken
// =============================================================================

describe('agentRuns.submitPermissionResult', () => {
  it('POSTs snake_case decision payload (contract §14: approved|rejected only)', async () => {
    const { client, calls } = recordingClient(() => ok({ ok: true }));
    await client.agentRuns.submitPermissionResult('run_1', {
      requestId: 'perm-9',
      decision: 'approved',
      reason: '同意执行',
    });
    expect(calls[0].method).toBe('POST');
    expect(new URL(calls[0].url).pathname).toBe('/api/v4/agent-runs/run_1/permission-results');
    expect(calls[0].body).toEqual({
      request_id: 'perm-9',
      decision: 'approved',
      reason: '同意执行',
    });
  });

  it('surfaces business errors (e.g. session gone 409 → HTTPError)', async () => {
    const { client } = recordingClient(
      () => new Response(JSON.stringify({ code: 409, msg: '远控会话不可用' }), { status: 409 }),
    );
    await expect(
      client.agentRuns.submitPermissionResult('run_1', { requestId: 'p', decision: 'rejected' }),
    ).rejects.toThrow();
  });
});

describe('agentRuns.submitUserMessage', () => {
  it('POSTs content and returns the server-final request id', async () => {
    const { client, calls } = recordingClient(() =>
      ok({ ok: true, request_id: 'srv-generated-1' }),
    );
    const ack = await client.agentRuns.submitUserMessage('run_1', { content: '继续, 用方案B' });
    expect(new URL(calls[0].url).pathname).toBe('/api/v4/agent-runs/run_1/messages');
    expect(calls[0].body).toEqual({ content: '继续, 用方案B' });
    expect(ack).toEqual({ ok: true, requestId: 'srv-generated-1' });
  });

  it('forwards a caller-supplied idempotency key', async () => {
    const { client, calls } = recordingClient(() => ok({ ok: true, request_id: 'my-key' }));
    const ack = await client.agentRuns.submitUserMessage('run_1', {
      content: 'x',
      requestId: 'my-key',
    });
    expect(calls[0].body).toEqual({ request_id: 'my-key', content: 'x' });
    expect(ack.requestId).toBe('my-key');
  });
});

describe('agentRuns.revealRemoteToken', () => {
  it('maps the one-shot grant including workspace (contract §18.3 r4)', async () => {
    const { client, calls } = recordingClient(() =>
      ok({
        access_token: 'sess-token-1',
        session_url: 'wss://acosmi.com/api/v4/agent-runs/run_1/remote-io?tenant_id=1',
        tenant_id: '1',
        workspace: '/Users/me/projects/demo',
      }),
    );
    const grant = await client.agentRuns.revealRemoteToken('run_1');
    expect(calls[0].method).toBe('POST');
    expect(new URL(calls[0].url).pathname).toBe('/api/v4/agent-runs/run_1/remote-token');
    expect(grant).toEqual({
      accessToken: 'sess-token-1',
      sessionUrl: 'wss://acosmi.com/api/v4/agent-runs/run_1/remote-io?tenant_id=1',
      tenantId: '1',
      workspace: '/Users/me/projects/demo',
    });
  });

  it('leaves workspace undefined when the run declared none', async () => {
    const { client } = recordingClient(() =>
      ok({ access_token: 't', session_url: 'wss://x', tenant_id: '1' }),
    );
    const grant = await client.agentRuns.revealRemoteToken('run_1');
    expect(grant.workspace).toBeUndefined();
  });
});

// =============================================================================
// createRemoteRun: byok_credential_ref + metadata 约定键透传
// =============================================================================

describe('createRemoteRun BYOK + metadata', () => {
  it('forwards byok_credential_ref and metadata title/workspace on the wire', async () => {
    const { client, calls } = recordingClient(() =>
      ok({ run_id: 'run_1', session_id: 'sess_1', status: 'queued' }),
    );
    await client.agentRuns.createRemoteRun({
      appId: '',
      input: '修复构建',
      runtime: 'crabcode_remote',
      runner: 'cloud',
      adapter: 'remote_io',
      byokCredentialRef: 'cred_abc123',
      metadata: { title: '修复构建', workspace: '/srv/app' },
    });
    expect(calls[0].body).toMatchObject({
      byok_credential_ref: 'cred_abc123',
      metadata: { title: '修复构建', workspace: '/srv/app' },
    });
  });
});

// =============================================================================
// crabcodeByok
// =============================================================================

describe('crabcodeByok', () => {
  const maskedWire = {
    credential_ref: 'cred_byok1',
    provider: 'deepseek',
    name: '我的DS钥匙',
    fingerprint: 'fp-1',
    status: 'active',
    created_at: '2026-06-10T00:00:00Z',
  };

  it('list GETs /crabcode/byok-credentials and maps masked views', async () => {
    const { client, calls } = recordingClient(() => ok({ items: [maskedWire] }));
    const items = await client.crabcodeByok.list();
    expect(new URL(calls[0].url).pathname).toBe('/api/v4/crabcode/byok-credentials');
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      credentialRef: 'cred_byok1',
      provider: 'deepseek',
      name: '我的DS钥匙',
      fingerprint: 'fp-1',
      status: 'active',
      createdAt: '2026-06-10T00:00:00Z',
    });
    expect(items[0].baseUrl).toBeUndefined();
  });

  it('create submits plaintext once and never receives it back', async () => {
    const { client, calls } = recordingClient(() => ok(maskedWire));
    const cred = await client.crabcodeByok.create({
      provider: 'deepseek',
      plaintext: 'sk-SECRET',
      name: '我的DS钥匙',
    });
    expect(calls[0].method).toBe('POST');
    expect(calls[0].body).toEqual({
      provider: 'deepseek',
      name: '我的DS钥匙',
      plaintext: 'sk-SECRET',
    });
    // masked view: plaintext 永不出现在响应映射结果里
    expect(JSON.stringify(cred)).not.toContain('sk-SECRET');
    expect(cred.credentialRef).toBe('cred_byok1');
  });

  it('create forwards custom base_url', async () => {
    const { client, calls } = recordingClient(() => ok(maskedWire));
    await client.crabcodeByok.create({
      provider: 'custom',
      plaintext: 'k',
      baseUrl: 'https://my-llm.example.com/v1',
    });
    expect(calls[0].body).toMatchObject({
      provider: 'custom',
      base_url: 'https://my-llm.example.com/v1',
    });
  });

  it('rotate POSTs new_plaintext to /:ref/rotate', async () => {
    const { client, calls } = recordingClient(() => ok({ ...maskedWire, fingerprint: 'fp-2' }));
    const cred = await client.crabcodeByok.rotate('cred_byok1', 'sk-NEW');
    expect(new URL(calls[0].url).pathname).toBe(
      '/api/v4/crabcode/byok-credentials/cred_byok1/rotate',
    );
    expect(calls[0].body).toEqual({ new_plaintext: 'sk-NEW' });
    expect(cred.fingerprint).toBe('fp-2');
  });

  it('revoke POSTs /:ref/revoke and maps the revoked view', async () => {
    const { client, calls } = recordingClient(() => ok({ ...maskedWire, status: 'revoked' }));
    const cred = await client.crabcodeByok.revoke('cred_byok1');
    expect(new URL(calls[0].url).pathname).toBe(
      '/api/v4/crabcode/byok-credentials/cred_byok1/revoke',
    );
    expect(cred.status).toBe('revoked');
  });
});

// =============================================================================
// chatBridge (请求 snake_case / 响应 camelCase — 契约 §12 平面分化)
// =============================================================================

describe('chatBridge integrations', () => {
  const integrationWire = {
    id: 'integ-1',
    tenantId: '1',
    appId: 'app-1',
    platform: 'feishu',
    region: 'cn',
    workspaceIdHash: 'wh-1',
    status: 'pending',
    installedByUserId: 'u-1',
    createdAt: '2026-06-10T00:00:00Z',
  };

  it('createIntegration sends snake_case body, returns camelCase view', async () => {
    const { client, calls } = recordingClient(() => ok(integrationWire));
    const integ = await client.chatBridge.createIntegration({
      appId: 'app-1',
      platform: 'feishu',
      region: 'cn',
      workspaceId: 'ws-raw-id',
      botId: 'bot-raw-id',
      configJson: '{"rate_limit":10}',
    });
    expect(calls[0].method).toBe('POST');
    expect(new URL(calls[0].url).pathname).toBe('/api/v4/chat-bridge/integrations');
    expect(calls[0].body).toEqual({
      app_id: 'app-1',
      platform: 'feishu',
      region: 'cn',
      workspace_id: 'ws-raw-id',
      bot_id: 'bot-raw-id',
      config_json: '{"rate_limit":10}',
    });
    expect(integ).toMatchObject({ id: 'integ-1', platform: 'feishu', status: 'pending' });
  });

  it('listIntegrations filters by app_id and unwraps {items}', async () => {
    const { client, calls } = recordingClient(() => ok({ items: [integrationWire] }));
    const items = await client.chatBridge.listIntegrations('app-1');
    const url = new URL(calls[0].url);
    expect(url.pathname).toBe('/api/v4/chat-bridge/integrations');
    expect(url.searchParams.get('app_id')).toBe('app-1');
    expect(items).toHaveLength(1);
  });

  it('getIntegration GETs by id', async () => {
    const { client, calls } = recordingClient(() => ok(integrationWire));
    const integ = await client.chatBridge.getIntegration('integ-1');
    expect(new URL(calls[0].url).pathname).toBe('/api/v4/chat-bridge/integrations/integ-1');
    expect(integ.id).toBe('integ-1');
  });

  it('updateIntegrationStatus PATCHes {status}', async () => {
    const { client, calls } = recordingClient(() => ok({ ok: true }));
    await client.chatBridge.updateIntegrationStatus('integ-1', 'active');
    expect(calls[0].method).toBe('PATCH');
    expect(new URL(calls[0].url).pathname).toBe('/api/v4/chat-bridge/integrations/integ-1/status');
    expect(calls[0].body).toEqual({ status: 'active' });
  });
});

describe('chatBridge credentials', () => {
  const credentialWire = {
    credentialRef: 'cred_cb1',
    integrationId: 'integ-1',
    platform: 'feishu',
    region: 'cn',
    secretKind: 'app_secret',
    fingerprint: 'fp-cb-1',
    keyId: 'v1',
    version: 1,
    status: 'active',
  };

  it('storeCredential sends secret_kind/plaintext once, returns masked view', async () => {
    const { client, calls } = recordingClient(() => ok(credentialWire));
    const cred = await client.chatBridge.storeCredential('integ-1', {
      secretKind: 'app_secret',
      plaintext: 'feishu-SECRET',
      region: 'cn',
      platform: 'feishu',
    });
    expect(new URL(calls[0].url).pathname).toBe(
      '/api/v4/chat-bridge/integrations/integ-1/credentials',
    );
    expect(calls[0].body).toEqual({
      secret_kind: 'app_secret',
      plaintext: 'feishu-SECRET',
      region: 'cn',
      platform: 'feishu',
    });
    expect(JSON.stringify(cred)).not.toContain('feishu-SECRET');
    expect(cred.credentialRef).toBe('cred_cb1');
    expect(cred.fingerprint).toBe('fp-cb-1');
  });

  it('listCredentials unwraps {items} masked views', async () => {
    const { client, calls } = recordingClient(() => ok({ items: [credentialWire] }));
    const items = await client.chatBridge.listCredentials('integ-1');
    expect(new URL(calls[0].url).pathname).toBe(
      '/api/v4/chat-bridge/integrations/integ-1/credentials',
    );
    expect(items[0].secretKind).toBe('app_secret');
  });

  it('rotateCredential POSTs secret_kind/new_plaintext', async () => {
    const { client, calls } = recordingClient(() =>
      ok({ ...credentialWire, version: 2, fingerprint: 'fp-cb-2' }),
    );
    const cred = await client.chatBridge.rotateCredential('integ-1', 'app_secret', 'NEW-SECRET');
    expect(new URL(calls[0].url).pathname).toBe(
      '/api/v4/chat-bridge/integrations/integ-1/credentials/rotate',
    );
    expect(calls[0].body).toEqual({ secret_kind: 'app_secret', new_plaintext: 'NEW-SECRET' });
    expect(cred.version).toBe(2);
    expect(cred.fingerprint).toBe('fp-cb-2');
  });

  it('revokeCredential POSTs /credentials/:ref/revoke', async () => {
    const { client, calls } = recordingClient(() => ok({ ok: true }));
    await client.chatBridge.revokeCredential('cred_cb1');
    expect(calls[0].method).toBe('POST');
    expect(new URL(calls[0].url).pathname).toBe('/api/v4/chat-bridge/credentials/cred_cb1/revoke');
  });
});
