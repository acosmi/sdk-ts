// request-immutability.test.ts — D-2 (P3-2)
//
// 验证 SDK 的 chat / chatStream / chatMessages* 入口不会原地 mutate 调用方传入的
// ChatRequest 对象 (历史 bug: 直接设 req.stream, sanitize-bridge 改 req.rawMessages)。
// 修复: 每个方法入口先浅拷贝 req, 后续只动拷贝。

import { describe, expect, it } from 'vitest';

import { Client } from '../src/index';
import type { ChatRequest } from '../src/models/types';

const future = new Date(Date.now() + 60_000).toISOString();

function clientWith(fetchImpl: typeof fetch): Client {
  const client = new Client({ serverURL: 'https://nexus.test', fetchImpl });
  client.tokens = {
    access_token: 'token-1',
    refresh_token: 'refresh-1',
    expires_at: future,
    scope: 'managed-models',
    client_id: 'client-1',
    server_url: 'https://nexus.test',
  };
  // 预热模型缓存, 避免 chat 触发真实 listModels 网络调用。
  client.primeModelCacheForTest('claude-test');
  return client;
}

/** 最小可解析的 Anthropic 同步响应。 */
function anthropicJSON(): Response {
  return new Response(
    JSON.stringify({
      id: 'msg_1',
      type: 'message',
      role: 'assistant',
      content: [{ type: 'text', text: 'ok' }],
      model: 'claude-test',
      stop_reason: 'end_turn',
      usage: { input_tokens: 1, output_tokens: 1 },
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
}

/** 简单 SSE 流 (message_stop 自然结束)。 */
function sseStream(): Response {
  const body = [
    'event: message_start\n',
    'data: {"type":"message_start"}\n\n',
    'event: message_stop\n',
    'data: {"type":"message_stop"}\n\n',
  ].join('');
  return new Response(body, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
  });
}

describe('request immutability — chat()', () => {
  it('does not mutate caller req (stream / rawMessages untouched)', async () => {
    const fetch: typeof fetch = async () => anthropicJSON();
    const client = clientWith(fetch);

    const rawMessages = [{ role: 'user', content: 'hi' }];
    const req: ChatRequest = { rawMessages, max_tokens: 16 };
    const snapshot = JSON.parse(JSON.stringify(req));

    await client.chat('claude-test', req);

    // stream 不应被写入调用方对象
    expect('stream' in req).toBe(false);
    // rawMessages 引用与内容均不变
    expect(req.rawMessages).toBe(rawMessages);
    expect(req).toEqual(snapshot);
  });
});

describe('request immutability — chatMessages() anthropic', () => {
  it('does not set stream on caller req', async () => {
    const fetch: typeof fetch = async () => anthropicJSON();
    const client = clientWith(fetch);

    const req: ChatRequest = { messages: [{ role: 'user', content: 'hi' }], max_tokens: 16 };
    const snapshot = JSON.parse(JSON.stringify(req));

    await client.chatMessages('claude-test', req);

    expect('stream' in req).toBe(false);
    expect(req).toEqual(snapshot);
  });
});

describe('request immutability — chatStream()', () => {
  it('does not set stream on caller req', async () => {
    const fetch: typeof fetch = async () => sseStream();
    const client = clientWith(fetch);

    const req: ChatRequest = { messages: [{ role: 'user', content: 'hi' }], max_tokens: 16 };
    const snapshot = JSON.parse(JSON.stringify(req));

    // 消费整个流
    for await (const _ev of client.chatStream('claude-test', req)) {
      void _ev;
    }

    expect('stream' in req).toBe(false);
    expect(req).toEqual(snapshot);
  });
});

describe('request immutability — chatMessagesStream()', () => {
  it('does not set stream on caller req', async () => {
    const fetch: typeof fetch = async () => sseStream();
    const client = clientWith(fetch);

    const req: ChatRequest = { messages: [{ role: 'user', content: 'hi' }], max_tokens: 16 };
    const snapshot = JSON.parse(JSON.stringify(req));

    for await (const _ev of client.chatMessagesStream('claude-test', req)) {
      void _ev;
    }

    expect('stream' in req).toBe(false);
    expect(req).toEqual(snapshot);
  });
});

describe('request immutability — applyRequestSanitizers does not mutate caller req', () => {
  it('autoStripEphemeral leaves caller rawMessages reference & content intact', async () => {
    const fetch: typeof fetch = async () => anthropicJSON();
    const client = clientWith(fetch);
    client.setAutoStripEphemeralHistory(true);

    // 含 ephemeral 标记的 block: sanitizer 会从 *拷贝* 中剥除, 但不应碰调用方对象。
    const rawMessages = [
      {
        role: 'assistant',
        content: [{ type: 'text', text: 'hi', acosmi_ephemeral: true }],
      },
      { role: 'user', content: [{ type: 'text', text: 'next' }] },
    ];
    const req: ChatRequest = { rawMessages, max_tokens: 16 };
    const snapshot = JSON.parse(JSON.stringify(req));

    await client.chat('claude-test', req);

    expect(req.rawMessages).toBe(rawMessages);
    expect(req).toEqual(snapshot);
  });
});
