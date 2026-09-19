// chat-stream-options.test.ts — 2.19.5
//
// `chatStream` / `chatMessagesStream` 的末位可选实参 `ChatStreamOptions`：
//
//   1. `requestTimeoutMs` —— 这一次流的**总时长**安全网。缺席 = 不武装任何计时器，
//      与 2.19.4 逐字一致（流式链路历来只受调用方 signal 约束；给它凭空补一道默认
//      墙钟，第一个被杀的就是健康的长任务）。
//   2. `onResponseHeaders` —— 在 `resp.ok` 判断之前拿到整份响应头。网关的流控提示
//      （`X-Acosmi-Stream-Keepalive`，秒）只存在于头里，等流内事件已经晚了 ——
//      最需要它的恰恰是一个事件都不来的流。
//
// 两条都是旁路 / 追加语义：不传时行为逐字节不变，回调抛错不得杀死主流。

import { describe, expect, it } from 'vitest';

import { Client, NetworkError } from '../src';
import type { StreamEvent } from '../src/models/types';
import type { ManagedModel } from '../src/models/types';

const future = new Date(Date.now() + 3_600_000).toISOString();

const ANTHROPIC_MODEL = {
  id: 'anthropic-model',
  preferred_format: 'anthropic',
  supported_formats: ['anthropic'],
} as const;

const SSE_BODY = [
  'event: message_start\n',
  'data: {"type":"message_start"}\n\n',
  'event: message_stop\n',
  'data: {"type":"message_stop"}\n\n',
].join('');

/** 网关本批新增的流控提示头：消费方据此标定自己的空闲预算（秒）。 */
const KEEPALIVE_HEADER = 'x-acosmi-stream-keepalive';

function primeClient(fetchImpl: typeof fetch): Client {
  const client = new Client({ serverURL: 'https://nexus.test', fetchImpl });
  client.tokens = {
    access_token: 'AT',
    refresh_token: 'RT',
    expires_at: future,
    scope: 'managed-models',
    client_id: 'cid',
    server_url: 'https://nexus.test',
  };
  client.modelCache = [
    {
      name: '',
      provider: 'anthropic',
      modelId: ANTHROPIC_MODEL.id,
      maxTokens: 0,
      isEnabled: true,
      ...ANTHROPIC_MODEL,
    } as unknown as ManagedModel,
  ];
  client.modelCacheTimeMs = Date.now();
  return client;
}

/** 永不响应、但在 signal abort 时按真实 fetch 的形态 reject。 */
function hangingClient(): Client {
  const fetchImpl = ((_url: string | URL | Request, init?: RequestInit) =>
    new Promise<Response>((_resolve, reject) => {
      const fail = () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
      const sig = init?.signal as AbortSignal | undefined;
      if (!sig) return;
      if (sig.aborted) fail();
      else sig.addEventListener('abort', fail, { once: true });
    })) as unknown as typeof fetch;
  return primeClient(fetchImpl);
}

function sseClient(headers: Record<string, string>): Client {
  return primeClient((async () =>
    new Response(SSE_BODY, {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream', ...headers },
    })) as unknown as typeof fetch);
}

async function drain(stream: AsyncIterable<StreamEvent>): Promise<string[]> {
  const events: string[] = [];
  for await (const ev of stream) events.push(ev.event);
  return events;
}

const TIMED_OUT = Symbol('observation-window-elapsed');

/**
 * 在观察窗内等 p 先落地。判据是**谁先到**而不是耗时数字 —— 换台慢机器只会让哨兵更
 * 容易赢，不会把一条正确的断言翻红。
 */
async function raceWindow<T>(p: Promise<T>, windowMs: number): Promise<T | typeof TIMED_OUT> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const sentinel = new Promise<typeof TIMED_OUT>(resolve => {
    timer = setTimeout(() => resolve(TIMED_OUT), windowMs);
  });
  try {
    return await Promise.race([p, sentinel]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

const REQ = { messages: [{ role: 'user' as const, content: 'hi' }], max_tokens: 16 };

describe('ChatStreamOptions.requestTimeoutMs（2.19.5）', () => {
  it('传有限正数时武装总预算，到点以超时错误中止', async () => {
    const client = hangingClient();
    const run = drain(
      client.chatMessagesStream(ANTHROPIC_MODEL.id, REQ, undefined, undefined, undefined, {
        requestTimeoutMs: 30,
      }),
    ).then(
      () => ({ ok: true }) as const,
      (e: unknown) => ({ ok: false, err: e }) as const,
    );

    const settled = await raceWindow(run, 2_000);
    expect(settled, '30ms 预算在 2s 观察窗内没有落地 —— 计时器没武装上').not.toBe(TIMED_OUT);
    const outcome = settled as { ok: boolean; err?: unknown };
    expect(outcome.ok).toBe(false);
    expect(outcome.err).toBeInstanceOf(NetworkError);
    expect((outcome.err as NetworkError).isTimeout()).toBe(true);
  });

  it('不传 opts 时不武装任何计时器（2.19.4 行为逐字保留）', async () => {
    const client = hangingClient();
    const run = drain(client.chatMessagesStream(ANTHROPIC_MODEL.id, REQ)).then(
      () => 'resolved',
      () => 'rejected',
    );

    expect(await raceWindow(run, 200)).toBe(TIMED_OUT);
  });

  it('非有限正数（0 / 负数 / NaN / Infinity）一律不武装 —— 不回落成任何默认墙钟', async () => {
    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      const client = hangingClient();
      const run = drain(
        client.chatMessagesStream(ANTHROPIC_MODEL.id, REQ, undefined, undefined, undefined, {
          requestTimeoutMs: bad,
        }),
      ).then(
        () => 'resolved',
        () => 'rejected',
      );

      expect(await raceWindow(run, 120), `requestTimeoutMs=${String(bad)}`).toBe(TIMED_OUT);
    }
  });

  // 「没武装计时器」这件事不能只靠观察窗断言 —— 换成 11 分钟的默认墙钟，上面那条
  // 200ms 观察窗照样绿。下面这对恒等断言才是能被反方向篡改证伪的那一档：
  // 没武装时 fetch 拿到的必须是调用方**那一个** signal 对象本身。
  it('不传 opts 时把调用方 signal 原样交给 fetch（中间没有夹一层 SDK 计时器）', async () => {
    const ctrl = new AbortController();
    let seen: unknown;
    const client = primeClient((async (_url: string | URL | Request, init?: RequestInit) => {
      seen = init?.signal;
      return new Response(SSE_BODY, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
    }) as unknown as typeof fetch);

    await drain(client.chatMessagesStream(ANTHROPIC_MODEL.id, REQ, ctrl.signal));
    expect(seen).toBe(ctrl.signal);
  });

  it('正向对照：传 requestTimeoutMs 时 fetch 拿到的是组合 signal', async () => {
    const ctrl = new AbortController();
    let seen: unknown;
    const client = primeClient((async (_url: string | URL | Request, init?: RequestInit) => {
      seen = init?.signal;
      return new Response(SSE_BODY, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
    }) as unknown as typeof fetch);

    await drain(
      client.chatMessagesStream(ANTHROPIC_MODEL.id, REQ, ctrl.signal, undefined, undefined, {
        requestTimeoutMs: 60_000,
      }),
    );
    expect(seen).toBeInstanceOf(AbortSignal);
    expect(seen).not.toBe(ctrl.signal);
  });

  it('chatStream 同样接这一条（两个流式入口同契约）', async () => {
    const client = hangingClient();
    const run = drain(
      client.chatStream(ANTHROPIC_MODEL.id, REQ, undefined, undefined, undefined, {
        requestTimeoutMs: 30,
      }),
    ).then(
      () => ({ ok: true }) as const,
      (e: unknown) => ({ ok: false, err: e }) as const,
    );

    const settled = await raceWindow(run, 2_000);
    expect(settled).not.toBe(TIMED_OUT);
    expect((settled as { ok: boolean }).ok).toBe(false);
  });

  it('调用方提前 break 时释放计时器（迭代器 return 也要走到 dispose）', async () => {
    const client = sseClient({ [KEEPALIVE_HEADER]: '15' });
    const seen: string[] = [];
    for await (const ev of client.chatMessagesStream(
      ANTHROPIC_MODEL.id,
      REQ,
      undefined,
      undefined,
      undefined,
      { requestTimeoutMs: 60_000 },
    )) {
      seen.push(ev.event);
      break;
    }
    // 计时器没释放的话，这个 60s 的 handle 会把 vitest 的进程按住不退出。
    expect(seen).toEqual(['message_start']);
  });
});

describe('ChatStreamOptions.onResponseHeaders（2.19.5）', () => {
  it('恰触发一次，且在第一个事件之前拿到流控提示头', async () => {
    const client = sseClient({ [KEEPALIVE_HEADER]: '15' });
    const keepalives: (string | null)[] = [];
    let callsBeforeFirstEvent = -1;
    const events: string[] = [];

    for await (const ev of client.chatMessagesStream(
      ANTHROPIC_MODEL.id,
      REQ,
      undefined,
      undefined,
      undefined,
      { onResponseHeaders: h => keepalives.push(h.get(KEEPALIVE_HEADER)) },
    )) {
      if (callsBeforeFirstEvent < 0) callsBeforeFirstEvent = keepalives.length;
      events.push(ev.event);
    }

    expect(keepalives).toEqual(['15']);
    expect(callsBeforeFirstEvent).toBe(1);
    expect(events).toEqual(['message_start', 'message_stop']);
  });

  it('回调抛错不得杀死主流（旁路信号无权中断链路）', async () => {
    const client = sseClient({ [KEEPALIVE_HEADER]: '15' });
    const events = await drain(
      client.chatMessagesStream(ANTHROPIC_MODEL.id, REQ, undefined, undefined, undefined, {
        onResponseHeaders: () => {
          throw new Error('consumer blew up');
        },
      }),
    );

    expect(events).toEqual(['message_start', 'message_stop']);
  });

  it('网关没下发该头时照常触发，只是读不到值（绝不合成占位）', async () => {
    const client = sseClient({});
    const keepalives: (string | null)[] = [];

    await drain(
      client.chatMessagesStream(ANTHROPIC_MODEL.id, REQ, undefined, undefined, undefined, {
        onResponseHeaders: h => keepalives.push(h.get(KEEPALIVE_HEADER)),
      }),
    );

    expect(keepalives).toEqual([null]);
  });

  it('401 刷新重试后，回调拿到的是重试腿那次响应的头', async () => {
    let calls = 0;
    const client = primeClient((async () => {
      calls += 1;
      if (calls === 1) {
        // 完整的 v1 用户凭据被拒合同 —— 只有它才触发刷新重试。
        return new Response(
          JSON.stringify({
            errorContractVersion: 1,
            faultDomain: 'user_auth',
            errorCode: 'USER_ACCESS_TOKEN_INVALID',
            transportRequestId: null,
            consumeRequestId: null,
            providerRequestId: null,
            requestDisposition: 'not_accepted',
            retryable: false,
          }),
          { status: 401, headers: { 'Content-Type': 'application/json', [KEEPALIVE_HEADER]: '99' } },
        );
      }
      return new Response(SSE_BODY, {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream', [KEEPALIVE_HEADER]: '15' },
      });
    }) as unknown as typeof fetch);
    client.forceRefresh = async () => {
      client.tokens = { ...client.tokens!, access_token: 'AT-2' };
    };

    const keepalives: (string | null)[] = [];
    const events = await drain(
      client.chatMessagesStream(ANTHROPIC_MODEL.id, REQ, undefined, undefined, undefined, {
        onResponseHeaders: h => keepalives.push(h.get(KEEPALIVE_HEADER)),
      }),
    );

    expect(calls).toBe(2);
    expect(events).toEqual(['message_start', 'message_stop']);
    // 被处理掉的那次 401 刻意不触发：回调与 notifyGatewayRequestID 同位置（在 401 分支
    // 之后），语义同为「至多一次」。真正开始流的那一次响应才是消费方要标定预算的对象。
    expect(keepalives).toEqual(['15']);
  });

  it('不传 opts 时事件产出逐字不变（追加式，零行为改动）', async () => {
    const client = sseClient({ [KEEPALIVE_HEADER]: '15' });
    expect(await drain(client.chatMessagesStream(ANTHROPIC_MODEL.id, REQ))).toEqual([
      'message_start',
      'message_stop',
    ]);
  });
});
