import { describe, it, expect, vi } from 'vitest';
import { CredentialLifecycle } from './credentials';
import { Client } from './client';
import type { VersionedCredentialStore } from './store';
import { Memory, fixture, fixtureAuthSessionId, metadata } from '../../test/credential-memory';
function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { resolve, promise };
}
const success = () =>
  new Response(
    JSON.stringify({
      access_token: 'winner-access',
      refresh_token: 'winner-refresh',
      expires_in: 3600,
    }),
  );
function setup(store = new Memory(), fetcher = vi.fn(async () => success())) {
  return {
    store,
    fetcher,
    life: new CredentialLifecycle(store, {
      serverURL: 'https://fake.test',
      metadata: async () => metadata,
      profile: async () => ({ subject: 'a', organizationId: null }),
      fetch: fetcher as typeof fetch,
    }),
  };
}
async function dispatched(store: Memory) {
  await vi.waitFor(() => expect(store.state.credentialState).toBe('refresh_dispatched'));
}
describe('durable credentials with fake tokens only', () => {
  it('expected logout cannot cross an account replacement during its first read', async () => {
    const base = new Memory();
    const entered = deferred<void>();
    const release = deferred<void>();
    const delayed: VersionedCredentialStore = {
      async readSnapshot(signal) {
        entered.resolve();
        await release.promise;
        return base.readSnapshot(signal);
      },
      compareAndSwap: (...args) => base.compareAndSwap(...args),
    };
    const life = setup(delayed as Memory).life;
    const expected = { storeInstanceId: base.state.storeInstanceId, authSessionId: base.state.authSessionId };
    const logout = life.logout(undefined, expected);
    await entered.promise;
    base.state = { ...base.state, authSessionId: '00000000-0000-4000-8000-000000000099',
      principal: { ...base.state.principal!, subject: 'account-b' }, revision: '9' };
    const before = structuredClone(base.state);
    release.resolve();
    await expect(logout).resolves.toMatchObject({ status: 'superseded' });
    expect(base.state).toEqual(before);
  });

  it('expected logout allows a normal revision change for the same owner', async () => {
    const { life, store } = setup();
    const expected = { storeInstanceId: store.state.storeInstanceId, authSessionId: store.state.authSessionId };
    store.state = { ...store.state, revision: '8' };
    await expect(life.logout(undefined, expected)).resolves.toMatchObject({ status: 'committed' });
    expect(store.state.credentialState).toBe('signed_out');
  });

  it('joins parallel clients and a cancelled waiter leaves owner alive', async () => {
    const gate = deferred<Response>();
    const a = setup(
      new Memory(),
      vi.fn(() => gate.promise),
    );
    const b = setup(a.store, a.fetcher);
    const ctl = new AbortController();
    const one = a.life.ensure(ctl.signal);
    await dispatched(a.store);
    const two = b.life.ensure();
    ctl.abort();
    await expect(one).rejects.toThrow('aborted');
    gate.resolve(success());
    await expect(two).resolves.toBe('winner-access');
    expect(a.fetcher).toHaveBeenCalledTimes(1);
    expect(a.store.state.authSessionId).toBe(fixtureAuthSessionId);
  });
  it('late refresh after logout cannot resurrect and revokes returned token', async () => {
    const gate = deferred<Response>();
    const fetcher = vi.fn((url: any) =>
      String(url).endsWith('/token') ? gate.promise : Promise.resolve(new Response()),
    );
    const { life, store } = setup(new Memory(), fetcher);
    const pending = life.ensure();
    await dispatched(store);
    const result = await life.logout();
    expect(result.status).toBe('committed');
    expect(store.state.tokenSet).toBeNull();
    gate.resolve(success());
    await expect(pending).rejects.toThrow();
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(3));
    expect(store.state.credentialState).toBe('signed_out');
  });
  it('late invalid_grant cannot clear newer session', async () => {
    const gate = deferred<Response>();
    const { life, store } = setup(
      new Memory(),
      vi.fn(() => gate.promise),
    );
    const pending = life.ensure();
    await dispatched(store);
    store.state = { ...fixture(), authSessionId: 'new-session', revision: '9' };
    const before = JSON.stringify(store.state);
    gate.resolve(new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 }));
    await expect(pending).rejects.toThrow();
    expect(JSON.stringify(store.state)).toBe(before);
  });
  it.each(['invalid_grant', 'invalid_client', 'invalid_scope', 'unsupported_grant_type'])(
    'persists definite %s only for owned operation',
    async (code) => {
      const { life, store } = setup(
        new Memory(),
        vi.fn(async () => new Response(JSON.stringify({ error: code }), { status: 400 })),
      );
      await expect(life.ensure()).rejects.toThrow(code);
      expect(store.state.reason).toBe(code);
      expect(store.state.credentialState).toBe(
        code === 'invalid_grant' ? 'reauth_required' : 'configuration_error',
      );
    },
  );
  it('unknown response becomes terminal without resending RT', async () => {
    const { life, store, fetcher } = setup(
      new Memory(),
      vi.fn(async () => {
        throw new Error('offline');
      }),
    );
    await expect(life.ensure()).rejects.toThrow();
    await expect(life.ensure()).rejects.toThrow();
    expect(store.state.reason).toBe('refresh_outcome_unknown');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('known rollback preserves credentials but does not retry this call', async () => {
    const { life, store, fetcher } = setup(
      new Memory(),
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({ error: 'temporarily_unavailable', rotationOutcome: 'not_committed' }),
            { status: 503 },
          ),
      ),
    );
    await expect(life.ensure()).rejects.toThrow();
    expect(store.state.credentialState).toBe('ready');
    expect(store.state.tokenSet?.refresh_token).toBe('fake-refresh');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('retries saving exactly the same response', async () => {
    const a = setup();
    a.store.saveFailures = 3;
    await expect(a.life.ensure()).resolves.toBe('winner-access');
    expect(a.fetcher).toHaveBeenCalledTimes(1);
  });
  it('storage read failure fails closed', async () => {
    const a = setup();
    a.store.failRead = true;
    await expect(a.life.ensure()).rejects.toThrow('storage_unavailable');
    expect(a.fetcher).not.toHaveBeenCalled();
    expect(a.store.state.tokenSet).not.toBeNull();
  });
  it('cold observer expires dispatched without HTTP', async () => {
    const a = setup();
    a.store.state.credentialState = 'refresh_dispatched';
    a.store.state.refreshOperation = {
      operationId: 'crashed',
      sessionId: fixtureAuthSessionId,
      baseRevision: '0',
      phase: 'dispatched',
      returnState: 'ready',
      startedAt: new Date(0).toISOString(),
      dispatchedAt: new Date(0).toISOString(),
      deadlineAt: new Date(1).toISOString(),
    };
    await expect(a.life.ensure()).rejects.toThrow('refresh_outcome_unknown');
    expect(a.fetcher).not.toHaveBeenCalled();
  });
  it('adopts another revision after rejected access token', async () => {
    const a = setup();
    const rejected = await a.life.read();
    a.store.state.revision = '7';
    a.store.state.tokenSet!.expires_at = new Date(Date.now() + 3600_000).toISOString();
    await expect(a.life.ensure(undefined, rejected)).resolves.toBe('fake-access');
    expect(a.fetcher).not.toHaveBeenCalled();
  });
  it('login attempts replace old callbacks and complete durable identity', async () => {
    const a = setup();
    await a.life.logout();
    const first = await a.life.reserveLogin();
    const second = await a.life.reserveLogin();
    const tokens = {
      ...fixture().tokenSet!,
      expires_at: new Date(Date.now() + 3600_000).toISOString(),
    };
    await expect(a.life.installLogin(first.attemptId, tokens)).rejects.toThrow('superseded');
    const ready = await a.life.installLogin(second.attemptId, tokens);
    expect(ready.credentialState).toBe('ready');
    expect(ready.lastLoginAttemptId).toBe(second.attemptId);
    expect(ready.principal?.subject).toBe('a');
  });
  it('local Client create/read never discover and notifications omit unknown secret keys', async () => {
    const a = setup();
    a.store.state.tokenSet!.expires_at = new Date(Date.now() + 3600_000).toISOString();
    const fetcher = vi.fn();
    const client = await Client.create({
      serverURL: 'https://fake.test',
      credentialMode: 'versioned',
      versionedCredentialStore: a.store,
      fetchImpl: fetcher,
    });
    await client.getCredentialSnapshot();
    expect(fetcher).not.toHaveBeenCalled();
    const events: any[] = [];
    a.life.subscribe((e) => events.push(e));
    (a.store.state as any).client_secret = 'fake-secret';
    await a.life.reconcile();
    await a.life.reconcile();
    expect(events).toHaveLength(1);
    expect(JSON.stringify(events)).not.toMatch(
      /access_token|refresh_token|client_secret|fake-secret|verifier/,
    );
  });
});
describe('crash, deadline and persistence fences', () => {
  it('suspended reserved owner cannot dispatch after observer withdraws reservation', async () => {
    const store = new Memory();
    const real = store.compareAndSwap.bind(store);
    const gate = deferred<void>();
    let parked = false;
    store.compareAndSwap = async (e, n, m) => {
      const result = await real(e, n, m);
      if (n.credentialState === 'refresh_reserved' && !parked && result.status === 'committed') {
        parked = true;
        await gate.promise;
      }
      return result;
    };
    const a = setup(store);
    const first = a.life.ensure();
    await vi.waitFor(() => expect(store.state.credentialState).toBe('refresh_reserved'));
    store.state.refreshOperation!.startedAt = new Date(Date.now() - 31_000).toISOString();
    const other = setup(store, a.fetcher);
    const second = other.life.ensure();
    await expect(second).resolves.toBe('winner-access');
    gate.resolve();
    await expect(first).resolves.toBe('winner-access');
    expect(a.fetcher).toHaveBeenCalledTimes(1);
  });
  it('body decode timeout aborts independent owner and never repeats token HTTP', async () => {
    vi.useFakeTimers();
    try {
      const body = deferred<any>();
      const fetcher = vi.fn(async () => ({ ok: true, json: () => body.promise }) as Response);
      const a = setup(new Memory(), fetcher);
      const promise = a.life.ensure();
      const observed = expect(promise).rejects.toThrow();
      await vi.advanceTimersByTimeAsync(30_001);
      await observed;
      expect(a.store.state.reason).toBe('refresh_outcome_unknown');
      expect(fetcher.mock.calls[0][1].signal.aborted).toBe(true);
      expect(fetcher).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
  it('permanent save failure keeps dispatched and reports persistence failure', async () => {
    vi.useFakeTimers();
    try {
      const a = setup();
      a.store.saveFailures = 1000;
      const promise = a.life.ensure();
      const observed = expect(promise).rejects.toThrow('credential_persist_failed');
      await vi.advanceTimersByTimeAsync(2100);
      await observed;
      expect(a.store.state.credentialState).toBe('refresh_dispatched');
      expect(a.fetcher).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
  it('pending identity survives transient profile failure and refresh returns pending', async () => {
    const a = setup();
    a.store.state.credentialState = 'pending_identity';
    a.store.state.principal = null;
    const life = new CredentialLifecycle(a.store, {
      serverURL: 'https://fake.test',
      metadata: async () => metadata,
      fetch: a.fetcher,
      profile: async () => {
        throw new Error('identity_unavailable');
      },
    });
    await expect(life.bindIdentity(fixtureAuthSessionId)).rejects.toThrow('identity_unavailable');
    expect(a.store.state.credentialState).toBe('pending_identity');
    expect(a.store.state.tokenSet?.access_token).toBe('winner-access');
    await expect(life.ensure()).rejects.toThrow('pending_identity');
  });
  it('scope failure is configuration error, unsupported metadata never posts token', async () => {
    const a = setup();
    a.store.state.credentialState = 'pending_identity';
    const life = new CredentialLifecycle(a.store, {
      serverURL: 'https://fake.test',
      metadata: async () => metadata,
      fetch: a.fetcher,
      profile: async () => {
        throw new Error('invalid_scope');
      },
    });
    await expect(life.bindIdentity(fixtureAuthSessionId)).rejects.toThrow('invalid_scope');
    expect(a.store.state.credentialState).toBe('configuration_error');
    const b = setup();
    const unsupported = new CredentialLifecycle(b.store, {
      serverURL: 'https://fake.test',
      metadata: async () => ({ ...metadata, crabcode_auth_contract_version: undefined }),
      fetch: b.fetcher,
      profile: async () => ({ subject: 'a', organizationId: null }),
    });
    await expect(unsupported.ensure()).rejects.toThrow('auth_contract_unsupported');
    expect(b.fetcher).not.toHaveBeenCalled();
  });
});
