import { it, expect, vi } from 'vitest';
import { Client } from './client';
import { Memory } from '../../test/credential-memory';
vi.mock('../auth/auth', async (original) => ({
  ...(await original<typeof import('../auth/auth')>()),
  authorize: vi.fn(async () => ({
    result: { code: 'fake-code', redirectURI: 'http://127.0.0.1/fake' },
    verifier: 'fake-verifier',
  })),
}));
const meta = {
  issuer: 'https://fake.test',
  authorization_endpoint: 'https://fake.test/auth',
  token_endpoint: 'https://fake.test/token',
  registration_endpoint: 'https://fake.test/register',
  revocation_endpoint: 'https://fake.test/revoke',
  crabcode_auth_contract_version: 2,
  gateway_error_contract_version: 1,
};
it('Client login waits for durable ready; transient profile only retries profile', async () => {
  const store = new Memory();
  store.state = {
    ...store.state,
    credentialState: 'signed_out',
    authorityConfig: null,
    authSessionId: null,
    principal: null,
    tokenSet: null,
  };
  let profileOK = false;
  const fetcher = vi.fn(async (url: any) => {
    const path = String(url);
    if (path.includes('.well-known')) return Response.json(meta);
    if (path.endsWith('/register')) return Response.json({ client_id: 'fake-client' });
    if (path.endsWith('/token'))
      return Response.json({
        access_token: 'fake-new-access',
        refresh_token: 'fake-new-refresh',
        expires_in: 3600,
      });
    if (path.endsWith('/api/oauth/profile'))
      return profileOK
        ? Response.json({ account: { uuid: 'account-a', email: '', requires_phone_binding: false },
            picture: '', organization: { uuid: 'org-a', rate_limit_tier: 'tier-1', name: '',
              has_extra_usage_enabled: false, billing_type: 'individual' } })
        : new Response('', { status: 503 });
    if (path.endsWith('/revoke')) return new Response('', { status: 200 });
    throw new Error('unexpected fake URL');
  });
  const client = await Client.create({
    serverURL: 'https://fake.test/api/v4',
    credentialMode: 'versioned',
    versionedCredentialStore: store,
    fetchImpl: fetcher,
  });
  const handler = vi.fn();
  await expect(client.loginWithHandler('fake', ['account'], handler)).rejects.toThrow(
    'identity_unavailable',
  );
  expect(store.state.credentialState).toBe('pending_identity');
  expect(handler.mock.calls.some(([e]) => e.type === 'complete')).toBe(false);
  await expect(client.ensureCredential()).rejects.toThrow('pending_identity');
  profileOK = true;
  await client.retryCredentialIdentity();
  expect(store.state.credentialState).toBe('ready');
  expect(client.isAuthorized()).toBe(true);
  expect(client.getTokenSet()?.access_token).toBe('fake-new-access');
  expect(store.state.verifiedIdentity).toMatchObject({ email: '', requiresPhoneBinding: false,
    hasExtraUsageEnabled: false, rateLimitTier: 'tier-1', organizationName: '' });
  expect(fetcher.mock.calls.filter(([url]) => String(url).endsWith('/token'))).toHaveLength(1);
  expect(fetcher.mock.calls.some(([url]) => String(url) === 'https://fake.test/api/oauth/profile')).toBe(true);
  await expect(client.ensureCredential()).resolves.toBe('fake-new-access');
  await client.logoutCredential();
  expect(store.state.credentialState).toBe('signed_out');
  expect(client.isAuthorized()).toBe(false);
  expect(client.getTokenSet()).toBeNull();
});

it('external credential mode calls its provider for every request and never fabricates a TokenSet', async () => {
  const provider = vi.fn(async () => 'external-access');
  const store = { load: vi.fn(async () => null), save: vi.fn(async () => {}), clear: vi.fn(async () => {}) };
  const client = await Client.create({ credentialMode: 'external', accessTokenProvider: provider, store });
  await expect(client.ensureToken()).resolves.toBe('external-access');
  await expect(client.ensureToken()).resolves.toBe('external-access');
  expect(provider).toHaveBeenCalledTimes(2);
  expect(client.getTokenSet()).toBeNull();
  expect(client.isAuthorized()).toBe(false);
  expect(store.load).not.toHaveBeenCalled();
  expect(store.save).not.toHaveBeenCalled();
  expect(store.clear).not.toHaveBeenCalled();
  await expect(client.forceRefresh()).rejects.toThrow('cannot be refreshed');
});

it('logoutCredential with an old expected owner does not clear the current projection', async () => {
  const store = new Memory();
  store.state.tokenSet!.expires_at = new Date(Date.now() + 3_600_000).toISOString();
  const client = await Client.create({ serverURL: 'https://fake.test', credentialMode: 'versioned',
    versionedCredentialStore: store, fetchImpl: vi.fn(async () => Response.json(meta)) as typeof fetch });
  const result = await client.logoutCredential(undefined, {
    storeInstanceId: store.state.storeInstanceId,
    authSessionId: '00000000-0000-4000-8000-000000000099',
  });
  expect(result.status).toBe('superseded');
  expect(client.isAuthorized()).toBe(true);
  expect(client.getTokenSet()?.access_token).toBe('fake-access');
  expect(store.state.credentialState).toBe('ready');
});

it('credentialRequestOwner prevents a retired Client from borrowing a replacement account token', async () => {
  const store = new Memory();
  store.state.tokenSet!.expires_at = new Date(Date.now() + 3_600_000).toISOString();
  const owner = { storeInstanceId: store.state.storeInstanceId,
    authSessionId: store.state.authSessionId, principal: structuredClone(store.state.principal) };
  const fetcher = vi.fn(async () => Response.json({ ok: true }));
  const client = await Client.create({ serverURL: 'https://fake.test', credentialMode: 'versioned',
    versionedCredentialStore: store, credentialRequestOwner: owner, fetchImpl: fetcher as typeof fetch });
  store.state = { ...store.state, revision: '9', authSessionId: '00000000-0000-4000-8000-000000000099',
    principal: { ...store.state.principal!, subject: 'account-b' },
    tokenSet: { ...store.state.tokenSet!, access_token: 'account-b-token' } };
  await expect(client.doJSON('POST', '/managed-models/fake/chat', { owner: 'a' })).rejects.toThrow('superseded');
  expect(fetcher).not.toHaveBeenCalled();
});

it('credentialRequestOwner allows normal revision and token rotation for the same principal', async () => {
  const store = new Memory();
  store.state.tokenSet!.expires_at = new Date(Date.now() + 3_600_000).toISOString();
  const owner = { storeInstanceId: store.state.storeInstanceId,
    authSessionId: store.state.authSessionId, principal: structuredClone(store.state.principal) };
  const fetcher = vi.fn(async () => Response.json({ ok: true }));
  const client = await Client.create({ serverURL: 'https://fake.test', credentialMode: 'versioned',
    versionedCredentialStore: store, credentialRequestOwner: owner, fetchImpl: fetcher as typeof fetch });
  store.state = { ...store.state, revision: '9', tokenSet: { ...store.state.tokenSet!, access_token: 'rotated' } };
  await expect(client.doJSON('POST', '/managed-models/fake/chat', { owner: 'a' })).resolves.toEqual({ ok: true });
  expect(new Headers(fetcher.mock.calls[0]![1]?.headers).get('Authorization')).toBe('Bearer rotated');
});

it('credentialRequestOwner is cloned at construction and cannot be retargeted by caller mutation', async () => {
  const store = new Memory();
  store.state.tokenSet!.expires_at = new Date(Date.now() + 3_600_000).toISOString();
  const owner = { storeInstanceId: store.state.storeInstanceId,
    authSessionId: store.state.authSessionId, principal: structuredClone(store.state.principal) };
  const fetcher = vi.fn(async () => Response.json({ ok: true }));
  const client = await Client.create({ serverURL: 'https://fake.test', credentialMode: 'versioned',
    versionedCredentialStore: store, credentialRequestOwner: owner, fetchImpl: fetcher as typeof fetch });
  owner.authSessionId = '00000000-0000-4000-8000-000000000099';
  owner.principal!.subject = 'account-b';
  await expect(client.doJSON('POST', '/managed-models/fake/chat', { owner: 'a' })).resolves.toEqual({ ok: true });
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(new Headers(fetcher.mock.calls[0]![1]?.headers).get('Authorization')).toBe('Bearer fake-access');
});

it('external and versioned credential inputs are mutually exclusive', () => {
  expect(() => new Client({ credentialMode: 'external' })).toThrow('accessTokenProvider is required');
  expect(() => new Client({ credentialMode: 'external', accessTokenProvider: () => 'x', versionedCredentialStore: new Memory() })).toThrow('incompatible');
  expect(() => new Client({ credentialMode: 'versioned', versionedCredentialStore: new Memory(), accessTokenProvider: () => 'x' })).toThrow('requires credentialMode=external');
});

it('beforeCredentialInstall runs before install and a replaced attempt cannot become ready', async () => {
  const store = new Memory();
  store.state = { ...store.state, credentialState: 'signed_out', authSessionId: null, principal: null, tokenSet: null };
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const hook = vi.fn(async ({ accessToken }: { accessToken: string }) => {
    expect(accessToken).toBe('hook-access');
    store.state = { ...store.state, loginAttempt: store.state.loginAttempt && { ...store.state.loginAttempt, attemptId: 'replacement-attempt' } };
    await gate;
  });
  const fetcher = vi.fn(async (url: any) => {
    const path = String(url);
    if (path.includes('.well-known')) return Response.json(meta);
    if (path.endsWith('/register')) return Response.json({ client_id: 'fake-client' });
    if (path.endsWith('/token')) return Response.json({ access_token: 'hook-access', refresh_token: 'hook-refresh', expires_in: 3600 });
    throw new Error('unexpected fake URL');
  });
  const client = await Client.create({
    serverURL: 'https://fake.test', credentialMode: 'versioned', versionedCredentialStore: store,
    fetchImpl: fetcher, beforeCredentialInstall: hook,
  });
  const login = client.login('fake', ['account']);
  await vi.waitFor(() => expect(hook).toHaveBeenCalledTimes(1));
  release();
  await expect(login).rejects.toThrow('superseded');
  expect(store.state.credentialState).not.toBe('ready');
  expect(store.state.tokenSet).toBeNull();
});

it('beforeCredentialInstall rejection emits a closed marker and preserves the typed thrown error', async () => {
  const store = new Memory();
  store.state = { ...store.state, credentialState: 'signed_out', authSessionId: null,
    principal: null, tokenSet: null, verifiedIdentity: null };
  const rejection = Object.assign(new Error('private host detail'), { code: 'HOST_CAP' });
  const handler = vi.fn();
  const fetcher = vi.fn(async (url: any) => {
    const path = String(url);
    if (path.includes('.well-known')) return Response.json(meta);
    if (path.endsWith('/register')) return Response.json({ client_id: 'fake-client' });
    if (path.endsWith('/token')) return Response.json({ access_token: 'hook-access', refresh_token: 'hook-refresh', expires_in: 3600 });
    throw new Error('unexpected fake URL');
  });
  const client = await Client.create({ serverURL: 'https://fake.test', credentialMode: 'versioned',
    versionedCredentialStore: store, fetchImpl: fetcher,
    beforeCredentialInstall: async () => { throw rejection; } });
  await expect(client.loginWithHandler('fake', ['account'], handler)).rejects.toBe(rejection);
  expect(handler).toHaveBeenCalledWith(expect.objectContaining({ type: 'error',
    err_code: 'credential_install_rejected', error: 'credential_install_rejected' }));
  expect(JSON.stringify(handler.mock.calls)).not.toContain('private host detail');
  expect(store.state.tokenSet).toBeNull();
});

it('profile classifies the wire errorCode without treating a transient backend failure as permission', async () => {
  const profileContract = (errorCode: string, faultDomain: 'account_permission' | 'gateway') => ({
    errorContractVersion: 1, faultDomain, errorCode, transportRequestId: null,
    consumeRequestId: null, providerRequestId: null, requestDisposition: 'not_accepted', retryable: false,
  });
  for (const [wire, expected] of [
    [profileContract('ACCOUNT_NOT_FOUND', 'account_permission'), 'account_permission'],
    [profileContract('AUTH_BACKEND_UNAVAILABLE', 'gateway'), 'identity_unavailable'],
  ] as const) {
    const store = new Memory();
    store.state = { ...store.state, credentialState: 'signed_out', authSessionId: null,
      principal: null, tokenSet: null, verifiedIdentity: null };
    const fetcher = vi.fn(async (url: any) => {
      const path = String(url);
      if (path.includes('.well-known')) return Response.json(meta);
      if (path.endsWith('/register')) return Response.json({ client_id: 'fake-client' });
      if (path.endsWith('/token')) return Response.json({ access_token: 'profile-access', refresh_token: 'profile-refresh', expires_in: 3600 });
      if (path.endsWith('/api/oauth/profile')) return Response.json(wire, { status: 403 });
      throw new Error('unexpected fake URL');
    });
    const client = await Client.create({ serverURL: 'https://fake.test', credentialMode: 'versioned',
      versionedCredentialStore: store, fetchImpl: fetcher });
    await expect(client.login('fake', ['account'])).rejects.toThrow(expected);
    expect(fetcher.mock.calls.filter(([url]) => String(url).endsWith('/token'))).toHaveLength(1);
  }
});
it('short TTL refresh returns once without second token POST', async () => {
  const store = new Memory();
  const fetcher = vi.fn(async (url: any) =>
    String(url).includes('.well-known')
      ? Response.json(meta)
      : Response.json({
          access_token: 'short-access',
          refresh_token: 'short-refresh',
          expires_in: 120,
        }),
  );
  const client = await Client.create({
    serverURL: 'https://fake.test',
    credentialMode: 'versioned',
    versionedCredentialStore: store,
    fetchImpl: fetcher,
  });
  await expect(client.ensureCredential()).resolves.toBe('short-access');
  expect(fetcher.mock.calls.filter(([url]) => String(url).endsWith('/token'))).toHaveLength(1);
});
it('two late rejected-access reconciliations adopt first winner', async () => {
  const store = new Memory();
  store.state.tokenSet!.expires_at = new Date(Date.now() + 3600_000).toISOString();
  const fetcher = vi.fn(async (url: any) =>
    String(url).includes('.well-known')
      ? Response.json(meta)
      : Response.json({
          access_token: 'winner-access',
          refresh_token: 'winner-refresh',
          expires_in: 120,
        }),
  );
  const client = await Client.create({
    serverURL: 'https://fake.test',
    credentialMode: 'versioned',
    versionedCredentialStore: store,
    fetchImpl: fetcher,
  });
  const rejected = await client.ensureToken();
  await client.forceRefresh(undefined, rejected);
  await client.forceRefresh(undefined, rejected);
  expect(fetcher.mock.calls.filter(([url]) => String(url).endsWith('/token'))).toHaveLength(1);
});
