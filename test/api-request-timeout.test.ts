// C5 (P2-5): 非流式 JSON 请求默认超时 + 用户 signal 优先。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Client, DEFAULT_API_TIMEOUT_MS } from '../src';

const future = new Date(Date.now() + 3600_000).toISOString();

function hangingClient(): { client: Client; aborted: () => boolean } {
  let sawAbort = false;
  // fetchImpl 永不响应, 但监听传入 signal 的 abort → reject (模拟真实 fetch 的 AbortError)。
  const fetchImpl = ((_url: string | URL | Request, init?: RequestInit) =>
    new Promise<Response>((_resolve, reject) => {
      let settled = false;
      const fail = () => {
        if (settled) return;
        settled = true;
        sawAbort = true;
        reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
      };
      const sig = init?.signal as AbortSignal | undefined;
      if (sig) {
        if (sig.aborted) {
          fail();
          return;
        }
        sig.addEventListener('abort', fail, { once: true });
      }
    })) as unknown as typeof fetch;

  const client = new Client({ serverURL: 'https://nexus.test', fetchImpl });
  client.tokens = {
    access_token: 'AT',
    refresh_token: 'RT',
    expires_at: future,
    scope: 'ai',
    client_id: 'cid',
    server_url: 'https://nexus.test',
  };
  return { client, aborted: () => sawAbort };
}

describe('agent-runs 非流式请求默认超时', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('未传 signal → 默认超时后 abort 抛错', async () => {
    const { client, aborted } = hangingClient();
    // 预先附上 rejection 捕获 (避免 fake-timer 同步触发 abort 时出现瞬时 unhandled rejection)。
    let rejected = false;
    const p = client.agentRuns.get('run_hang').catch(() => {
      rejected = true;
    });
    // 让 ensureToken / microtask 先跑, 再推进到默认超时点。
    await vi.advanceTimersByTimeAsync(DEFAULT_API_TIMEOUT_MS + 10);
    await p;
    expect(rejected).toBe(true);
    expect(aborted()).toBe(true);
  });

  it('传入 signal → 用户 signal abort 立即生效 (早于默认超时)', async () => {
    const { client, aborted } = hangingClient();
    const ac = new AbortController();
    let rejected = false;
    const p = client.agentRuns.get('run_hang', ac.signal).catch(() => {
      rejected = true;
    });
    await vi.advanceTimersByTimeAsync(50);
    ac.abort();
    await p;
    expect(rejected).toBe(true);
    expect(aborted()).toBe(true);
  });
});

describe('compliance 非流式请求默认超时', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('未传 signal → executeJson 默认超时后 abort 抛错', async () => {
    const { client, aborted } = hangingClient();
    // compliance read 路径走 executeJson (publicRead 不走)。listEvidenceAssets = read。
    let rejected = false;
    const p = client.compliance.listEvidenceAssets({}).catch(() => {
      rejected = true;
    });
    await vi.advanceTimersByTimeAsync(DEFAULT_API_TIMEOUT_MS + 10);
    await p;
    expect(rejected).toBe(true);
    expect(aborted()).toBe(true);
  });
});
