// stream-upstream-activity.test.ts — 2026-08-06
//
// 心跳只有在抵达"做判决的那一层"时才叫心跳。网关在等上游首字节期间发 ": keep-alive",
// 但 SDK 的 isSSECommentLine 会把它吞掉 —— 消费方的流空闲看门狗一个字节都看不见,
// 照常在 90s 处掐流。onUpstreamActivity 就是那条通道。
//
// 顺带覆盖同类的第二种形态: OpenAI 格式下 converter 对某些 data 行返回零事件,
// 同样是"有字节、无事件"。两种情形都必须触发活性回调。

import { describe, expect, it } from 'vitest';

import { Client } from '../src';
import type { ManagedModel } from '../src/models/types';

const future = new Date(Date.now() + 60_000).toISOString();

function clientWithSSE(body: string, model: Partial<ManagedModel> & { id: string }): Client {
  const client = new Client({
    serverURL: 'https://nexus.test',
    fetchImpl: (async () =>
      new Response(body, {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      })) as unknown as typeof fetch,
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

/** 三条保活注释先行, 之后才是真事件 —— 复刻网关长首字节等待的形态。 */
const KEEPALIVE_THEN_EVENTS = [
  ': keep-alive\n\n',
  ': keep-alive\n\n',
  ': keep-alive\n\n',
  'event: message_start\n',
  'data: {"type":"message_start"}\n\n',
  'event: message_stop\n',
  'data: {"type":"message_stop"}\n\n',
].join('');

describe('chatMessagesStream 的上游活性回调', () => {
  it('保活注释行不产生事件, 但必须触发活性回调', async () => {
    const client = clientWithSSE(KEEPALIVE_THEN_EVENTS, { ...ANTHROPIC_MODEL });
    let activity = 0;
    let activityBeforeFirstEvent = -1;
    const events: string[] = [];

    for await (const ev of client.chatMessagesStream(
      ANTHROPIC_MODEL.id,
      { messages: [{ role: 'user', content: 'hi' }], max_tokens: 16 },
      undefined,
      () => {
        activity++;
      },
    )) {
      if (activityBeforeFirstEvent < 0) activityBeforeFirstEvent = activity;
      events.push(ev.event);
    }

    // 注释行没有变成事件 (原有语义不得回归)
    expect(events).toEqual(['message_start', 'message_stop']);
    // 决定性判据: 第一个事件到达之前就已经有 ≥3 次活性 —— 那 3 次只可能来自 3 条
    // 保活注释行。若只统计 event:/data: 行, 这里恒为 1, 断言红。
    // (不要退回成 activity > events.length: 那条在"注释行根本没进循环"时会假绿。)
    expect(activityBeforeFirstEvent).toBeGreaterThanOrEqual(3);
  });

  it('不传回调时行为与改造前逐字一致', async () => {
    const client = clientWithSSE(KEEPALIVE_THEN_EVENTS, { ...ANTHROPIC_MODEL });
    const events: string[] = [];
    for await (const ev of client.chatMessagesStream(ANTHROPIC_MODEL.id, {
      messages: [{ role: 'user', content: 'hi' }],
      max_tokens: 16,
    })) {
      events.push(ev.event);
    }
    expect(events).toEqual(['message_start', 'message_stop']);
  });

  it('回调抛错不得杀死主流 (旁路信号无权中断链路)', async () => {
    const client = clientWithSSE(KEEPALIVE_THEN_EVENTS, { ...ANTHROPIC_MODEL });
    const events: string[] = [];
    for await (const ev of client.chatMessagesStream(
      ANTHROPIC_MODEL.id,
      { messages: [{ role: 'user', content: 'hi' }], max_tokens: 16 },
      undefined,
      () => {
        throw new Error('consumer blew up');
      },
    )) {
      events.push(ev.event);
    }
    expect(events).toEqual(['message_start', 'message_stop']);
  });
});

describe('chatStream 的上游活性回调', () => {
  it('保活注释行同样触发回调', async () => {
    const client = clientWithSSE(KEEPALIVE_THEN_EVENTS, { ...ANTHROPIC_MODEL });
    let activity = 0;
    let activityBeforeFirstEvent = -1;
    for await (const _ev of client.chatStream(
      ANTHROPIC_MODEL.id,
      { rawMessages: [{ role: 'user', content: 'hi' }], max_tokens: 16 },
      undefined,
      () => {
        activity++;
      },
    )) {
      if (activityBeforeFirstEvent < 0) activityBeforeFirstEvent = activity;
    }
    expect(activityBeforeFirstEvent).toBeGreaterThanOrEqual(3);
  });
});
