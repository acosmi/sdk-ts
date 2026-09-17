import { describe, it, expect, vi } from 'vitest';
import { Client } from './client';
import { Memory, metadata } from '../../test/credential-memory';
import { newOpenAIStreamConverter } from '../models/adapters/index';
import type { ChatRequest, StreamEvent } from '../models/types';

/**
 * [W-QUAD-CHAIN-20260914] OpenAI 线流式 usage 不得丢失。
 *
 * 主控实测真因 (2026-09-14): 上游在 `stream_options.include_usage: true` 时的帧序是
 * 内容帧 → 带 finish_reason 的帧 → `{"choices":[],"usage":{...}}` → `data: [DONE]`。
 * 转换器对没有 choices 的帧整帧返回零事件, 而 finish_reason 帧上已经发出了不带 usage 的
 * message_delta + message_stop —— 经本 SDK 跑的每个 OpenAI 线回合 usage 恒为 0。
 *
 * 契约: usage 出现在紧挨唯一 message_stop 之前的那个 message_delta 里; 字段映射与非流式路径
 * 逐字相同 (只搬 prompt_tokens / completion_tokens), 缓存 / 推理明细不映射、不做净额换算。
 */

/** 主控实测的 usage 尾帧 (ZHIPU/GLM-5.3 经网关原样转发)。 */
const USAGE_TAIL_FRAME = JSON.stringify({
  choices: [],
  usage: {
    prompt_tokens: 13171,
    completion_tokens: 16,
    total_tokens: 13187,
    completion_tokens_details: { reasoning_tokens: 14 },
    prompt_tokens_details: { cached_tokens: 13056 },
  },
});

/** 尾帧搬运后的期望值: 只有两个键, 数值原样 (13171, 不是 13171 − 13056)。 */
const TAIL_USAGE = { input_tokens: 13171, output_tokens: 16 };

function contentChunk(text: string): string {
  return JSON.stringify({
    id: 'c1',
    object: 'chat.completion.chunk',
    choices: [{ index: 0, delta: { content: text }, finish_reason: null }],
  });
}

function finishChunk(reason: string, usage?: Record<string, unknown>): string {
  return JSON.stringify({
    id: 'c1',
    object: 'chat.completion.chunk',
    choices: [{ index: 0, delta: {}, finish_reason: reason }],
    ...(usage === undefined ? {} : { usage }),
  });
}

interface ParsedEvent {
  event: string;
  payload: Record<string, unknown>;
}

function parse(events: StreamEvent[]): ParsedEvent[] {
  return events.map((e) => ({
    event: e.event,
    payload: JSON.parse(e.data) as Record<string, unknown>,
  }));
}

/** 逐帧喂入转换器, 同时记下每一帧各自产出的事件名 —— 断言「收尾在哪一帧发出」要用。 */
function feed(frames: string[]): { steps: string[][]; all: ParsedEvent[] } {
  const conv = newOpenAIStreamConverter();
  const steps: string[][] = [];
  const all: ParsedEvent[] = [];
  for (const frame of frames) {
    const parsed = parse(conv.convert(frame).events);
    steps.push(parsed.map((e) => e.event));
    all.push(...parsed);
  }
  return { steps, all };
}

/**
 * 整条流恰好一个 message_delta 与一个 message_stop, message_stop 收尾且 message_delta 紧挨在它之前。
 * 返回那个 message_delta。
 */
function expectSingleCloseAtEnd(all: ParsedEvent[]): ParsedEvent {
  const names = all.map((e) => e.event);
  expect(names.filter((n) => n === 'message_delta').length).toBe(1);
  expect(names.filter((n) => n === 'message_stop').length).toBe(1);
  const stopAt = names.indexOf('message_stop');
  expect(stopAt).toBe(names.length - 1);
  expect(names[stopAt - 1]).toBe('message_delta');
  return all[stopAt - 1]!;
}

describe('OpenAIStreamConverter — usage 随收尾 message_delta 送达', () => {
  it('usage 尾帧晚于 finish_reason: 收尾推迟到尾帧, message_delta 带 usage 且紧挨唯一的 message_stop', () => {
    const { steps, all } = feed([
      contentChunk('PONG'),
      finishChunk('stop'),
      USAGE_TAIL_FRAME,
      '[DONE]',
    ]);
    expect(steps[1]).toEqual(['content_block_stop']); // finish_reason 帧只关块
    expect(steps[2]).toEqual(['message_delta', 'message_stop']); // 尾帧到达即收尾
    expect(steps[3]).toEqual([]); // [DONE] 不重复收口
    const delta = expectSingleCloseAtEnd(all);
    expect(delta.payload.delta).toEqual({ stop_reason: 'end_turn' });
    expect(delta.payload.usage).toEqual(TAIL_USAGE);
  });

  it('usage 与 finish_reason 同帧: 该帧一次发出带 usage 的收尾', () => {
    const { steps, all } = feed([
      contentChunk('PONG'),
      finishChunk('length', { prompt_tokens: 20, completion_tokens: 3, total_tokens: 23 }),
      '[DONE]',
    ]);
    expect(steps[1]).toEqual(['content_block_stop', 'message_delta', 'message_stop']);
    expect(steps[2]).toEqual([]);
    const delta = expectSingleCloseAtEnd(all);
    expect(delta.payload.delta).toEqual({ stop_reason: 'max_tokens' });
    expect(delta.payload.usage).toEqual({ input_tokens: 20, output_tokens: 3 });
  });

  it('推迟期间到达的带 choices 帧若携带 usage, 同样在该帧立即补发收尾', () => {
    const { steps, all } = feed([
      contentChunk('PONG'),
      finishChunk('stop'),
      JSON.stringify({
        id: 'c1',
        choices: [{ index: 0, delta: {}, finish_reason: null }],
        usage: { prompt_tokens: 30, completion_tokens: 4, total_tokens: 34 },
      }),
      '[DONE]',
    ]);
    expect(steps[1]).toEqual(['content_block_stop']);
    expect(steps[2]).toEqual(['message_delta', 'message_stop']);
    expect(steps[3]).toEqual([]);
    const delta = expectSingleCloseAtEnd(all);
    expect(delta.payload.usage).toEqual({ input_tokens: 30, output_tokens: 4 });
  });

  it('usage 先于 finish_reason 到达: finish_reason 帧立即收尾, 带最后一次到达的 usage (后到覆盖先到)', () => {
    const contentWithUsage = (text: string, usage: Record<string, unknown>) =>
      JSON.stringify({
        id: 'c1',
        choices: [{ index: 0, delta: { content: text }, finish_reason: null }],
        usage,
      });
    const { steps, all } = feed([
      contentWithUsage('PO', { prompt_tokens: 7, completion_tokens: 1 }),
      contentWithUsage('NG', { prompt_tokens: 7, completion_tokens: 2 }),
      finishChunk('stop'),
      '[DONE]',
    ]);
    expect(steps[2]).toEqual(['content_block_stop', 'message_delta', 'message_stop']);
    const delta = expectSingleCloseAtEnd(all);
    expect(delta.payload.usage).toEqual({ input_tokens: 7, output_tokens: 2 });
  });

  it('有 finish_reason、无 usage、有 [DONE]: 收尾在 [DONE] 发出, message_delta 没有 usage 键', () => {
    const { steps, all } = feed([contentChunk('PONG'), finishChunk('stop'), '[DONE]']);
    expect(steps[1]).toEqual(['content_block_stop']);
    expect(steps[2]).toEqual(['message_delta', 'message_stop']);
    const delta = expectSingleCloseAtEnd(all);
    expect(delta.payload.delta).toEqual({ stop_reason: 'end_turn' });
    expect('usage' in delta.payload).toBe(false);
  });

  it('EOF 收场 (flush): 推迟中的收尾由 flush 发出, 再调一次不产出第二个 message_stop', () => {
    const conv = newOpenAIStreamConverter();
    const all: ParsedEvent[] = [];
    all.push(...parse(conv.convert(contentChunk('PONG')).events));
    all.push(...parse(conv.convert(finishChunk('stop')).events));
    const flushed = parse(conv.flush());
    expect(flushed.map((e) => e.event)).toEqual(['message_delta', 'message_stop']);
    all.push(...flushed);
    expect(conv.flush()).toEqual([]);
    expectSingleCloseAtEnd(all);
  });

  it('flush 在已收口后返回空: usage 尾帧已触发收尾时不再发第二个 message_stop', () => {
    const conv = newOpenAIStreamConverter();
    for (const frame of [contentChunk('PONG'), finishChunk('stop'), USAGE_TAIL_FRAME]) {
      conv.convert(frame);
    }
    expect(conv.flush()).toEqual([]);
  });

  it('flush 不替从未收到 finish_reason 的截断流伪造正常结束', () => {
    const conv = newOpenAIStreamConverter();
    // 正向对照: 流确实开过块, 「flush 返回空」不是因为转换器什么都没做
    const opened = parse(conv.convert(contentChunk('PART')).events).map((e) => e.event);
    expect(opened).toEqual(['message_start', 'content_block_start', 'content_block_delta']);
    expect(conv.flush()).toEqual([]);
  });

  it('S-1 回归: 无 choices 且无 usage 的帧零事件、不抛错, 也不会提前触发推迟中的收尾', () => {
    const conv = newOpenAIStreamConverter();
    const noChoicesNoUsage = JSON.stringify({ type: 'managed_model_stream_failed', message: '' });
    const emptyChoicesNullUsage = JSON.stringify({ id: 'c1', choices: [], usage: null });

    expect(conv.convert(noChoicesNoUsage).events).toEqual([]); // 流开头
    conv.convert(contentChunk('PONG'));
    const atFinish = parse(conv.convert(finishChunk('stop')).events).map((e) => e.event);
    expect(atFinish).toEqual(['content_block_stop']);
    expect(conv.convert(noChoicesNoUsage).events).toEqual([]); // 推迟期间
    expect(conv.convert(emptyChoicesNullUsage).events).toEqual([]); // usage: null 不是 usage 对象

    const end = parse(conv.convert('[DONE]').events);
    expect(end.map((e) => e.event)).toEqual(['message_delta', 'message_stop']);
    expect('usage' in end[0]!.payload).toBe(false);
  });

  it('cached_tokens 在场时不出现 cache_read_input_tokens, 也不做 prompt − cached 净额换算', () => {
    const { all } = feed([contentChunk('PONG'), finishChunk('stop'), USAGE_TAIL_FRAME, '[DONE]']);
    const usage = expectSingleCloseAtEnd(all).payload.usage as Record<string, unknown>;
    expect('cache_read_input_tokens' in usage).toBe(false);
    expect(Object.keys(usage).sort()).toEqual(['input_tokens', 'output_tokens']);
    expect(usage.input_tokens).toBe(13171);
  });

  it('计数缺失或不是有限数时不写对应键 (缺席 ≠ 0)', () => {
    const usageOf = (usage: Record<string, unknown>) =>
      expectSingleCloseAtEnd(
        feed([
          contentChunk('PONG'),
          finishChunk('stop'),
          JSON.stringify({ choices: [], usage }),
          '[DONE]',
        ]).all,
      ).payload.usage;
    expect(usageOf({ prompt_tokens: null, completion_tokens: 16 })).toEqual({ output_tokens: 16 });
    expect(usageOf({ prompt_tokens: 12, completion_tokens: '16' })).toEqual({ input_tokens: 12 });
  });
});

// ---------------------------------------------------------------------------
// client 级: chatMessagesStream 的 OpenAI 分支。EOF 收场只能在这一层验证 —— 流在没有
// `[DONE]` 时结束, 补发推迟收尾的调用点在 client.ts 读循环结束处, 转换器自己看不到 EOF。
// ---------------------------------------------------------------------------

const MODEL = 'ZHIPU/GLM-5.3';

/** ChatRequest 的其余字段不参与判定。 */
const REQ = { messages: [{ role: 'user', content: 'hi' }] } as unknown as ChatRequest;

function sseBody(frames: string[]): string {
  return frames.map((frame) => `data: ${frame}\n\n`).join('');
}

/**
 * 造一个已登录、模型缓存已预热成 OpenAI 线的 Client。夹具写法同 openai-line-stream-error.test.ts,
 * 那里记录的两个坑在这里同样成立: serverURL 必须与凭据夹具 authorityConfig.serverURL 逐字相等;
 * 假 fetcher 只对聊天端点 (`/managed-models/`) 返回 SSE, 其余一律返回 JSON。
 */
async function openAILineClient(streamBody: string): Promise<Client> {
  const store = new Memory();
  const fetcher = vi.fn(async (url: unknown) => {
    const path = String(url);
    if (path.includes('/managed-models/')) {
      return new Response(streamBody, {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      });
    }
    if (path.includes('.well-known')) return Response.json(metadata);
    if (path.endsWith('/api/oauth/profile'))
      return Response.json({
        account: { uuid: 'account-a', email: '', requires_phone_binding: false },
        picture: '',
        organization: {
          uuid: 'org-a',
          rate_limit_tier: 'tier-1',
          name: '',
          has_extra_usage_enabled: false,
          billing_type: 'individual',
        },
      });
    if (path.endsWith('/token'))
      return Response.json({
        access_token: 'fake-access',
        refresh_token: 'fake-refresh',
        expires_in: 3600,
      });
    if (path.endsWith('/register')) return Response.json({ client_id: 'fake-client' });
    if (path.endsWith('/revoke')) return new Response('', { status: 200 });
    return Response.json({});
  });
  const client = await Client.create({
    serverURL: 'https://fake.test',
    credentialMode: 'versioned',
    versionedCredentialStore: store,
    fetchImpl: fetcher as unknown as typeof fetch,
  });
  client.primeModelCacheForTest(MODEL);
  const cached = client.modelCache[0]!;
  cached.provider = 'zhipu';
  cached.supported_formats = ['openai'];
  cached.preferred_format = 'openai';
  return client;
}

async function collect(client: Client): Promise<ParsedEvent[]> {
  const out: StreamEvent[] = [];
  for await (const ev of client.chatMessagesStream(MODEL, REQ)) {
    out.push(ev);
  }
  return parse(out);
}

describe('chatMessagesStream (OpenAI 线) — usage 与收尾', () => {
  it('端到端: finish_reason → usage 尾帧 → [DONE], 调用方拿到带 usage 的 message_delta', async () => {
    const client = await openAILineClient(
      sseBody([contentChunk('PONG'), finishChunk('stop'), USAGE_TAIL_FRAME, '[DONE]']),
    );
    const delta = expectSingleCloseAtEnd(await collect(client));
    expect(delta.payload.usage).toEqual(TAIL_USAGE);
  });

  it('EOF 收场 (无 [DONE]): finish_reason 之后断流, 推迟的收尾仍被发出且只发一次', async () => {
    const client = await openAILineClient(sseBody([contentChunk('PONG'), finishChunk('stop')]));
    const delta = expectSingleCloseAtEnd(await collect(client));
    expect(delta.payload.delta).toEqual({ stop_reason: 'end_turn' });
    expect('usage' in delta.payload).toBe(false);
  });

  it('EOF 收场 (无 [DONE]): usage 尾帧已触发收尾时, 读循环结束处的 flush 不发第二个 message_stop', async () => {
    const client = await openAILineClient(
      sseBody([contentChunk('PONG'), finishChunk('stop'), USAGE_TAIL_FRAME]),
    );
    const delta = expectSingleCloseAtEnd(await collect(client));
    expect(delta.payload.usage).toEqual(TAIL_USAGE);
  });

  it('EOF 收场 (无 [DONE]): 从未收到 finish_reason 的截断流不被伪造成正常结束', async () => {
    const client = await openAILineClient(sseBody([contentChunk('PART')]));
    const names = (await collect(client)).map((e) => e.event);
    // 正向对照 + 断言合一: 事件确实流过, 且其中没有 message_delta / message_stop
    expect(names).toEqual(['message_start', 'content_block_start', 'content_block_delta']);
  });
});
