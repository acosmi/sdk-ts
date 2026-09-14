import { it, expect, vi } from 'vitest';
import { Client } from './client';
import { Memory, metadata } from '../../test/credential-memory';
import { StreamError } from '../shared/errors';
import { newOpenAIStreamConverter } from '../models/adapters/openai';
import type { ChatRequest } from '../models/types';

/**
 * [W-QUAD-CHAIN-20260914 D1-5 落点①] OpenAI 线必须认得网关的结构化失败帧。
 *
 * 实测真因 (2026-09-14): G-1 修好含 `/` 的 slug 路由后, 两个 ZHIPU 模型首轮即失败,
 * 客户端看到的却是 `undefined is not an object (evaluating 'chunk.choices.length')` ——
 * 一句与真因毫无关系的 TypeError。
 *
 * 链条: 上游 400 → 网关以 `event: failed` 发出错误契约帧
 * (managed_model.go::writeManagedModelEvent) → `chatMessagesStreamGen` 的 OpenAI 分支
 * **把事件名只写不读** (变量名 `_currentEvent` 的下划线前缀就是作者自己的承认) →
 * 错误帧被当成 OpenAI chunk 喂进 converter → 撞 `chunk.choices` 未定义。
 * 同函数的 Anthropic 分支一直在消费 `currentEvent`, OpenAI 分支是唯一漏网者。
 *
 * 下面的帧是**生产实录**(仅把三个 ID 换成占位符)。
 */
const GATEWAY_FAILED_FRAME = JSON.stringify({
  type: 'managed_model_stream_failed',
  protocol: 'managed-model.v2',
  stage: 'provider',
  error: 'gateway: tools[0].type:type cannot be empty. (kind=invalid_request, status=400)',
  errorCode: 'invalid_request',
  errorContractVersion: 1,
  faultDomain: 'provider',
  message: '',
  requestDisposition: 'unknown',
  retryable: false,
  requestId: 'req-0001',
  consumeRequestId: 'req-0001',
  providerRequestId: 'prov-0001',
  transportRequestId: 'trans-0001',
});

const MODEL = 'ZHIPU/GLM-5.3-Flash';

function sse(body: string): Response {
  return new Response(body, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  });
}

/** 造一个已登录、模型缓存已预热成 **OpenAI 线** 的 Client。 */
async function openAILineClient(streamBody: string): Promise<Client> {
  const store = new Memory(); // fixture() 即 credentialState:'ready' + 未过期 token, 无需驱动 OAuth
  const fetcher = vi.fn(async (url: unknown) => {
    const path = String(url);
    // 路由方向刻意是「只有聊天端点给 SSE, 其余一律给 JSON」。
    // 反过来写 (默认给 SSE) 会让凭据链路自己发起的请求在 response.json() 上撞
    // `SyntaxError: Unexpected token 'd', "data: {...}"` —— 那个症状与被测缺陷毫无关系,
    // 会把排查引到完全错误的方向。
    if (path.includes('/managed-models/')) return sse(streamBody);
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
    // 必须与 fixture() 的 authorityConfig.serverURL 逐字相等: CredentialLifecycle 拿到的是
    // client.serverURL (client.ts 构造处 `serverURL: this.serverURL`), 而 ensureSnapshot 会比
    // `s.authorityConfig.serverURL !== this.protocol.serverURL` 并抛 auth_contract_unsupported。
    // 既有的 credentials-client.test.ts 是靠显式把 authorityConfig 置 null 绕开的 (它本就要驱动登录);
    // 本用例直接复用已登录夹具, 故改为对齐 URL, 不去动共享夹具。
    serverURL: 'https://fake.test',
    credentialMode: 'versioned',
    versionedCredentialStore: store,
    fetchImpl: fetcher as unknown as typeof fetch,
  });
  // 复用仓内既有的测试辅助产出合法 ManagedModel (内部调 zeroModelCapabilities),
  // 再把路由字段改成 OpenAI 线 —— 手写 ModelCapabilities 全字段字面量既冗长又易随类型漂移。
  client.primeModelCacheForTest(MODEL);
  const cached = client.modelCache[0]!;
  cached.provider = 'zhipu';
  cached.supported_formats = ['openai'];
  cached.preferred_format = 'openai';
  return client;
}

/** ChatRequest 的其余字段在本用例里不参与判定; 断言只覆盖流的错误分流。 */
const REQ = { messages: [{ role: 'user', content: 'hi' }] } as unknown as ChatRequest;

it('OpenAI 线收到网关 failed 帧时抛 StreamError, 并带出真实上游错误', async () => {
  const client = await openAILineClient(`event: failed\ndata: ${GATEWAY_FAILED_FRAME}\n\n`);

  let thrown: unknown;
  try {
    for await (const _ev of client.chatMessagesStream(MODEL, REQ)) {
      // 不应产出任何事件
    }
  } catch (e) {
    thrown = e;
  }

  expect(thrown).toBeInstanceOf(StreamError);
  const err = thrown as StreamError & { rawError?: string };
  expect(err.code).toBe('invalid_request');

  const surfaced = `${err.message} ${err.rawError ?? ''}`;
  // 承重: 真因必须抵达调用方, 否则排障时症状与病因之间没有任何联系
  expect(surfaced.includes('tools[0].type')).toBe(true);
  // 负向: 绝不能再退化成那句与真因无关的 TypeError
  expect(surfaced.includes('chunk.choices')).toBe(false);
});

it('正向对照: 正常 OpenAI chunk 流仍照常产出事件, 新分支不吞好帧', async () => {
  const chunk = JSON.stringify({
    id: 'c1',
    object: 'chat.completion.chunk',
    choices: [{ index: 0, delta: { content: 'PONG' }, finish_reason: null }],
  });
  const client = await openAILineClient(`data: ${chunk}\n\ndata: [DONE]\n\n`);

  const events: string[] = [];
  for await (const ev of client.chatMessagesStream(MODEL, REQ)) {
    events.push(ev.event);
  }

  expect(events.length > 0).toBe(true);
  expect(events.includes('message_start')).toBe(true);
});

it('转换器纵深防御: 没有 choices 的 data 帧返回零事件而不是抛 TypeError', () => {
  const converter = newOpenAIStreamConverter();

  // 形态一: 完全没有 choices 键 (网关错误契约帧就是这个形状)
  expect(() => converter.convert(GATEWAY_FAILED_FRAME)).not.toThrow();
  expect(converter.convert(GATEWAY_FAILED_FRAME).events.length).toBe(0);

  // 形态二: 有 choices 但为空数组 (OpenAI include_usage 的尾帧), 改前就已正确处理, 作对照
  const usageOnly = JSON.stringify({
    id: 'c1',
    object: 'chat.completion.chunk',
    choices: [],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
  });
  expect(() => converter.convert(usageOnly)).not.toThrow();
  expect(converter.convert(usageOnly).events.length).toBe(0);
});
