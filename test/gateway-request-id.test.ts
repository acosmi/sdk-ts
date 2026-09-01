// gateway-request-id.test.ts — 2026-09-01
//
// 立项: cloud-agent docs/audit/2026-09-01-网关请求ID跨系统关联缺口-根因审计与实施方案.md
//
// 客户端的失败与上游的成功之间此前没有任何共同标识符 (2026-08-31 事故: 6 次上游搜索
// 全部成功并已计费, GUI 上 6 次全失败, 定位只能靠时间戳人工对齐)。网关现在把
// consumeRequestID 放进 X-Acosmi-Request-Id 响应头, SDK 经回调透出。
//
// 每条断言都带正向对照 —— 在「网关压根没下发」的世界里必须变红:
//   · 没头 → 回调一次都不触发 (若实现改成"没头就编一个", 此条红)
//   · 有头 → 回调拿到的必须是**头里那个值**, 不是任何自造/派生的 ID

import { describe, expect, it } from 'vitest';

import { Client, GATEWAY_REQUEST_ID_HEADER } from '../src';
import type { ManagedModel } from '../src/models/types';

const future = new Date(Date.now() + 60_000).toISOString();

const CONSUME_ID = '6f2b1c04-9a8d-4e71-b350-2c7e5f9a1d84';

function makeClient(
  responder: () => Response,
  model: Partial<ManagedModel> & { id: string },
): Client {
  const client = new Client({
    serverURL: 'https://nexus.test',
    fetchImpl: (async () => responder()) as unknown as typeof fetch,
  });
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
      modelId: model.id,
      maxTokens: 0,
      isEnabled: true,
      ...model,
    } as ManagedModel,
  ];
  client.modelCacheTimeMs = Date.now();
  return client;
}

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

function sseResponse(headers: Record<string, string>): Response {
  return new Response(SSE_BODY, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream', ...headers },
  });
}

describe('chatMessagesStream 的网关请求 ID 回调', () => {
  it('网关下发时, 回调拿到头里那个值, 且恰好一次', async () => {
    const client = makeClient(
      () => sseResponse({ [GATEWAY_REQUEST_ID_HEADER]: CONSUME_ID }),
      { ...ANTHROPIC_MODEL },
    );
    const seen: string[] = [];
    let seenBeforeFirstEvent = -1;
    const events: string[] = [];

    for await (const ev of client.chatMessagesStream(
      ANTHROPIC_MODEL.id,
      { messages: [{ role: 'user', content: 'hi' }], max_tokens: 16 },
      undefined,
      undefined,
      id => seen.push(id),
    )) {
      if (seenBeforeFirstEvent < 0) seenBeforeFirstEvent = seen.length;
      events.push(ev.event);
    }

    expect(seen).toEqual([CONSUME_ID]);
    // 决定性判据: ID 必须在**第一个事件之前**就到手 —— 这正是它能覆盖
    // 「事件根本没来」场景的原因。若实现改成从流内某个事件里取, 此条红。
    expect(seenBeforeFirstEvent).toBe(1);
    expect(events).toEqual(['message_start', 'message_stop']);
  });

  // 正向对照。
  it('网关没下发时, 回调一次都不触发 (绝不合成占位值)', async () => {
    const client = makeClient(() => sseResponse({}), { ...ANTHROPIC_MODEL });
    const seen: string[] = [];

    const events: string[] = [];
    for await (const ev of client.chatMessagesStream(
      ANTHROPIC_MODEL.id,
      { messages: [{ role: 'user', content: 'hi' }], max_tokens: 16 },
      undefined,
      undefined,
      id => seen.push(id),
    )) {
      events.push(ev.event);
    }

    expect(seen).toEqual([]);
    // 旧网关 + 新客户端必须照常出流 (fail-open)。
    expect(events).toEqual(['message_start', 'message_stop']);
  });

  it('空白头等同于没下发', async () => {
    const client = makeClient(() => sseResponse({ [GATEWAY_REQUEST_ID_HEADER]: '   ' }), {
      ...ANTHROPIC_MODEL,
    });
    const seen: string[] = [];
    for await (const _ev of client.chatMessagesStream(
      ANTHROPIC_MODEL.id,
      { messages: [{ role: 'user', content: 'hi' }], max_tokens: 16 },
      undefined,
      undefined,
      id => seen.push(id),
    )) {
      /* drain */
    }
    expect(seen).toEqual([]);
  });

  it('回调抛错不得杀死主流 (旁路信号无权中断链路)', async () => {
    const client = makeClient(
      () => sseResponse({ [GATEWAY_REQUEST_ID_HEADER]: CONSUME_ID }),
      { ...ANTHROPIC_MODEL },
    );
    const events: string[] = [];
    for await (const ev of client.chatMessagesStream(
      ANTHROPIC_MODEL.id,
      { messages: [{ role: 'user', content: 'hi' }], max_tokens: 16 },
      undefined,
      undefined,
      () => {
        throw new Error('consumer blew up');
      },
    )) {
      events.push(ev.event);
    }
    expect(events).toEqual(['message_start', 'message_stop']);
  });

  it('HTTP 错误响应上同样透出 —— 错误体未必带这个 ID', async () => {
    const client = makeClient(
      () =>
        new Response('{"error":{"type":"api_error","message":"boom"}}', {
          status: 500,
          headers: {
            'Content-Type': 'application/json',
            [GATEWAY_REQUEST_ID_HEADER]: CONSUME_ID,
          },
        }),
      { ...ANTHROPIC_MODEL },
    );
    const seen: string[] = [];

    await expect(async () => {
      for await (const _ev of client.chatMessagesStream(
        ANTHROPIC_MODEL.id,
        { messages: [{ role: 'user', content: 'hi' }], max_tokens: 16 },
        undefined,
        undefined,
        id => seen.push(id),
      )) {
        /* 不会有事件 */
      }
    }).rejects.toThrow();

    expect(seen).toEqual([CONSUME_ID]);
  });

  it('不传回调时行为与改造前逐字一致', async () => {
    const client = makeClient(
      () => sseResponse({ [GATEWAY_REQUEST_ID_HEADER]: CONSUME_ID }),
      { ...ANTHROPIC_MODEL },
    );
    const events: string[] = [];
    for await (const ev of client.chatMessagesStream(ANTHROPIC_MODEL.id, {
      messages: [{ role: 'user', content: 'hi' }],
      max_tokens: 16,
    })) {
      events.push(ev.event);
    }
    expect(events).toEqual(['message_start', 'message_stop']);
  });
});

describe('chatStream 的网关请求 ID 回调', () => {
  it('同样透出', async () => {
    const client = makeClient(
      () => sseResponse({ [GATEWAY_REQUEST_ID_HEADER]: CONSUME_ID }),
      { ...ANTHROPIC_MODEL },
    );
    const seen: string[] = [];
    for await (const _ev of client.chatStream(
      ANTHROPIC_MODEL.id,
      { rawMessages: [{ role: 'user', content: 'hi' }], max_tokens: 16 },
      undefined,
      undefined,
      id => seen.push(id),
    )) {
      /* drain */
    }
    expect(seen).toEqual([CONSUME_ID]);
  });
});

describe('同步路径的网关请求 ID 回调', () => {
  it('chatMessages (Anthropic 格式) 透出', async () => {
    const client = makeClient(
      () =>
        new Response(
          JSON.stringify({
            id: 'msg_1',
            type: 'message',
            role: 'assistant',
            content: [{ type: 'text', text: 'ok' }],
          }),
          {
            status: 200,
            headers: {
              'Content-Type': 'application/json',
              [GATEWAY_REQUEST_ID_HEADER]: CONSUME_ID,
            },
          },
        ),
      { ...ANTHROPIC_MODEL },
    );
    const seen: string[] = [];
    await client.chatMessages(
      ANTHROPIC_MODEL.id,
      { messages: [{ role: 'user', content: 'hi' }], max_tokens: 16 },
      undefined,
      id => seen.push(id),
    );
    expect(seen).toEqual([CONSUME_ID]);
  });

  // 正向对照。
  it('chatMessages 在网关没下发时不触发', async () => {
    const client = makeClient(
      () =>
        new Response(
          JSON.stringify({
            id: 'msg_1',
            type: 'message',
            role: 'assistant',
            content: [{ type: 'text', text: 'ok' }],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      { ...ANTHROPIC_MODEL },
    );
    const seen: string[] = [];
    await client.chatMessages(
      ANTHROPIC_MODEL.id,
      { messages: [{ role: 'user', content: 'hi' }], max_tokens: 16 },
      undefined,
      id => seen.push(id),
    );
    expect(seen).toEqual([]);
  });
});

describe('头名契约', () => {
  // 网关侧 middleware.ConsumeRequestIDHeader 与此处必须逐字一致; 任一侧改名而另一侧
  // 不改, 表现是"永远读不到"而不是报错 —— 所以把字面量钉在测试里。
  it('头名与网关侧常量逐字一致', () => {
    expect(GATEWAY_REQUEST_ID_HEADER).toBe('X-Acosmi-Request-Id');
  });

  // 传输层 X-Request-ID 不是计费 join key, 绝不能被当成同一个东西读。
  it('不是传输层 X-Request-ID', () => {
    expect(GATEWAY_REQUEST_ID_HEADER.toLowerCase()).not.toBe('x-request-id');
  });
});
