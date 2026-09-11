import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Client } from '../core/client';
import { Memory } from '../../test/credential-memory';
import './ws';

class FakeWebSocket extends EventTarget {
  static instances: FakeWebSocket[] = [];
  static closeGate: Promise<void> | null = null;
  sent: string[] = [];
  constructor(readonly url: string) {
    super();
    FakeWebSocket.instances.push(this);
    queueMicrotask(() => {
      this.dispatchEvent(new Event('open'));
      this.dispatchEvent(Object.assign(new Event('message'), { data: JSON.stringify({ type: 'welcome', connId: 'fake' }) }));
    });
  }
  send(value: string) { this.sent.push(value); }
  close(code = 1000, reason = '') {
    const emit = () => this.dispatchEvent(Object.assign(new Event('close'), { code, reason }));
    if (FakeWebSocket.closeGate) void FakeWebSocket.closeGate.then(emit);
    else emit();
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(r => { resolve = r; });
  return { promise, resolve };
}

function ticket(value: string): Response {
  return Response.json({ code: 0, data: { ticket: value, expiresIn: 30 } });
}

beforeEach(() => {
  FakeWebSocket.instances = [];
  FakeWebSocket.closeGate = null;
  vi.stubGlobal('WebSocket', FakeWebSocket);
});
afterEach(() => vi.unstubAllGlobals());

it('disconnect invalidates an in-flight ticket before any socket is created', async () => {
  const store = new Memory();
  store.state.tokenSet!.expires_at = new Date(Date.now() + 3_600_000).toISOString();
  const pending = deferred<Response>();
  const client = await Client.create({ serverURL: 'https://fake.test', credentialMode: 'versioned',
    versionedCredentialStore: store, fetchImpl: vi.fn(async () => pending.promise) as typeof fetch });
  const connecting = client.connect({ autoReconnect: false });
  await vi.waitFor(() => expect((client.fetchImpl as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(1));
  const disconnecting = client.disconnect();
  pending.resolve(ticket('old'));
  await expect(connecting).rejects.toThrow(/superseded|aborted/i);
  await disconnecting;
  expect(FakeWebSocket.instances).toHaveLength(0);
  expect(client.isConnected()).toBe(false);
});

it('a principal change while the ticket is pending cannot create or publish the old connection', async () => {
  const store = new Memory();
  store.state.tokenSet!.expires_at = new Date(Date.now() + 3_600_000).toISOString();
  const pending = deferred<Response>();
  const onConnect = vi.fn();
  const client = await Client.create({ serverURL: 'https://fake.test', credentialMode: 'versioned',
    versionedCredentialStore: store, fetchImpl: vi.fn(async () => pending.promise) as typeof fetch });
  const connecting = client.connect({ autoReconnect: false, onConnect });
  await vi.waitFor(() => expect((client.fetchImpl as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(1));
  store.state = { ...store.state, authSessionId: '00000000-0000-4000-8000-000000000099',
    principal: { ...store.state.principal!, subject: 'account-b' } };
  pending.resolve(ticket('old'));
  await expect(connecting).rejects.toThrow('owner changed');
  expect(FakeWebSocket.instances).toHaveLength(0);
  expect(onConnect).not.toHaveBeenCalled();
});

it('same-owner token rotation still allows a fresh connection', async () => {
  const store = new Memory();
  store.state.tokenSet!.expires_at = new Date(Date.now() + 3_600_000).toISOString();
  const fetcher = vi.fn(async () => ticket('fresh'));
  const client = await Client.create({ serverURL: 'https://fake.test', credentialMode: 'versioned',
    versionedCredentialStore: store, fetchImpl: fetcher as typeof fetch });
  store.state = { ...store.state, revision: '9', tokenSet: { ...store.state.tokenSet!, access_token: 'rotated' } };
  await client.connect({ autoReconnect: false, topics: ['balance', 'system'] });
  expect(client.isConnected()).toBe(true);
  expect(FakeWebSocket.instances).toHaveLength(1);
  expect(FakeWebSocket.instances[0]!.sent).toHaveLength(1);
  await client.disconnect();
});

it('replacing an in-flight connect cannot let its cleanup clear the new socket', async () => {
  const store = new Memory();
  store.state.tokenSet!.expires_at = new Date(Date.now() + 3_600_000).toISOString();
  const oldTicket = deferred<Response>();
  const fetcher = vi.fn()
    .mockImplementationOnce(async () => oldTicket.promise)
    .mockImplementationOnce(async () => ticket('new'));
  const client = await Client.create({ serverURL: 'https://fake.test', credentialMode: 'versioned',
    versionedCredentialStore: store, fetchImpl: fetcher as typeof fetch });
  const oldConnect = client.connect({ autoReconnect: false });
  await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
  const newConnect = client.connect({ autoReconnect: false });
  oldTicket.resolve(ticket('old'));
  await expect(oldConnect).rejects.toThrow(/superseded|aborted/i);
  await newConnect;
  expect(client.isConnected()).toBe(true);
  expect(FakeWebSocket.instances).toHaveLength(1);
  expect(FakeWebSocket.instances[0]!.url).toContain('ticket=new');
  await client.disconnect();
});

it('waits for a captured old close while the newly registered intent remains current', async () => {
  const store = new Memory();
  store.state.tokenSet!.expires_at = new Date(Date.now() + 3_600_000).toISOString();
  const fetcher = vi.fn(async () => ticket(`ticket-${fetcher.mock.calls.length}`));
  const client = await Client.create({ serverURL: 'https://fake.test', credentialMode: 'versioned',
    versionedCredentialStore: store, fetchImpl: fetcher as typeof fetch });
  await client.connect({ autoReconnect: false });
  const close = deferred<void>();
  FakeWebSocket.closeGate = close.promise;
  const replacement = client.connect({ autoReconnect: false });
  await Promise.resolve();
  expect(fetcher).toHaveBeenCalledTimes(1);
  close.resolve();
  await replacement;
  expect(client.isConnected()).toBe(true);
  expect(fetcher).toHaveBeenCalledTimes(2);
  FakeWebSocket.closeGate = null;
  await client.disconnect();
});

it('a user disconnect during the old-close wait cancels the registered replacement intent', async () => {
  const store = new Memory();
  store.state.tokenSet!.expires_at = new Date(Date.now() + 3_600_000).toISOString();
  const fetcher = vi.fn(async () => ticket('initial'));
  const client = await Client.create({ serverURL: 'https://fake.test', credentialMode: 'versioned',
    versionedCredentialStore: store, fetchImpl: fetcher as typeof fetch });
  await client.connect({ autoReconnect: false });
  const close = deferred<void>();
  FakeWebSocket.closeGate = close.promise;
  const replacement = client.connect({ autoReconnect: false });
  const stopping = client.disconnect();
  close.resolve();
  await expect(replacement).rejects.toThrow(/superseded|aborted/i);
  await stopping;
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(FakeWebSocket.instances).toHaveLength(1);
  expect(client.isConnected()).toBe(false);
});
