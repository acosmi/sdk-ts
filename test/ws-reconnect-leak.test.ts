// C6 (P2-6): 重复 connect 不泄漏旧连接 — 旧 WebSocket 必须被 close。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Client } from '../src';

const future = new Date(Date.now() + 3600_000).toISOString();

type Listener = (ev: unknown) => void;

/** 极简 mock WebSocket: 构造即异步触发 open + welcome, 记录 close 调用。 */
class MockWebSocket {
  static instances: MockWebSocket[] = [];
  url: string;
  closed = false;
  closeCalls = 0;
  private listeners: Record<string, Listener[]> = {};

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
    // 下一个 microtask 完成握手: open → welcome message。
    queueMicrotask(() => {
      this.emit('open', {});
      this.emit('message', { data: JSON.stringify({ type: 'welcome', connId: 'c1' }) });
    });
  }

  addEventListener(type: string, fn: Listener) {
    (this.listeners[type] ??= []).push(fn);
  }
  removeEventListener(type: string, fn: Listener) {
    this.listeners[type] = (this.listeners[type] ?? []).filter((f) => f !== fn);
  }
  send() {
    /* no-op */
  }
  close() {
    this.closeCalls += 1;
    this.closed = true;
    this.emit('close', { code: 1000, reason: '' });
  }
  private emit(type: string, ev: unknown) {
    for (const fn of this.listeners[type] ?? []) fn(ev);
  }
}

const originalWS = (globalThis as { WebSocket?: unknown }).WebSocket;

function makeClient(): Client {
  const client = new Client({ serverURL: 'https://nexus.test' });
  client.tokens = {
    access_token: 'AT',
    refresh_token: 'RT',
    expires_at: future,
    scope: 'ai',
    client_id: 'cid',
    server_url: 'https://nexus.test',
  };
  return client;
}

describe('WebSocket 重复 connect 不泄漏旧连接', () => {
  beforeEach(() => {
    MockWebSocket.instances = [];
    (globalThis as { WebSocket?: unknown }).WebSocket = MockWebSocket as unknown;
  });
  afterEach(async () => {
    (globalThis as { WebSocket?: unknown }).WebSocket = originalWS;
    vi.restoreAllMocks();
  });

  it('连续两次 connect → 旧连接被 close, 只剩一个活动连接', async () => {
    const client = makeClient();

    await client.connect({ autoReconnect: false });
    expect(MockWebSocket.instances).toHaveLength(1);
    const first = MockWebSocket.instances[0]!;

    await client.connect({ autoReconnect: false });
    // 第二次 connect 应先 disconnect 旧连接 (close 旧 ws), 再建新连接。
    expect(first.closeCalls).toBeGreaterThanOrEqual(1);
    expect(MockWebSocket.instances).toHaveLength(2);

    const second = MockWebSocket.instances[1]!;
    expect(second.closed).toBe(false);
    expect(client.isConnected()).toBe(true);

    await client.disconnect();
  });
});
