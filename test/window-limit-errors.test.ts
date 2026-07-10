// window-limit-errors.test.ts — 窗口限额 (WINDOW_LIMIT_EXCEEDED) 结构化承接 (v2.11.0)。
//
// 覆盖：
//   - parseHTTPError 三形态：Anthropic (/anthropic, 嵌套 error 对象 + 顶层窗口字段)、
//     OpenAI 网关 (/chat, 顶层扁平 {code,message} — 历史缺口: message 恒为空)、
//     非 JSON / 空 body 行为逐字节不变。
//   - isWindowLimitError：结构化 errorCode 优先 / message+body 子串防御兜底 /
//     普通 429 rate limit 不误判。
//   - isWindowLimitStreamError：agent-run SSE code / StreamError / 防御兜底 / negative。
//   - agent-run SSE error 事件 windowKind / windowResetAt 透传 (camelCase 契约 + snake 兼容)。
//   - QuotaSummary.windowLimits 类型形态 + getQuotaSummary 解析透传 (后端未启用时缺失)。

import { describe, expect, it } from 'vitest';

import {
  AgentRunStreamError,
  Client,
  HTTPError,
  RateLimitError,
  StreamError,
  isWindowLimitError,
  isWindowLimitStreamError,
  type AgentRunStreamEvent,
  type QuotaSummary,
  type WindowLimitStatus,
} from '../src/index';
import { parseHTTPError, parseHTTPErrorWithHeader, parseStreamError } from '../src/core/http';

const future = new Date(Date.now() + 60_000).toISOString();

function clientWithFetch(fetchImpl: typeof fetch): Client {
  const client = new Client({ serverURL: 'https://nexus.test', fetchImpl });
  client.tokens = {
    access_token: 'token-1',
    refresh_token: 'refresh-1',
    expires_at: future,
    scope: 'ai',
    client_id: 'client-1',
    server_url: 'https://nexus.test',
  };
  return client;
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function sseResponse(frames: string): Response {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(frames));
        controller.close();
      },
    }),
    {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    },
  );
}

// 后端契约样例 (冻结)
const anthropicWindowBody = JSON.stringify({
  type: 'error',
  error: {
    type: 'rate_limit_error',
    message: '已达 5 小时用量上限，预计 07-09 18:30 起逐步恢复 (WINDOW_LIMIT_EXCEEDED)',
  },
  errorCode: 'WINDOW_LIMIT_EXCEEDED',
  windowKind: 'FIVE_HOUR',
  windowResetAt: '2026-07-09T10:30:00Z',
});

const openaiGatewayWindowBody = JSON.stringify({
  code: 429,
  message: '已达 5 小时用量上限 (WINDOW_LIMIT_EXCEEDED)',
  errorCode: 'WINDOW_LIMIT_EXCEEDED',
  windowKind: 'FIVE_HOUR',
  windowResetAt: '2026-07-09T10:30:00Z',
  retryable: false,
});

describe('parseHTTPError — 窗口限额 / 网关形态', () => {
  it('Anthropic 形态 (/anthropic): 嵌套 error 对象照旧解析 + 顶层窗口字段透传 + Retry-After', () => {
    const err = parseHTTPErrorWithHeader(429, anthropicWindowBody, new Headers({ 'Retry-After': '1800' }));
    expect(err).toBeInstanceOf(HTTPError);
    expect(err.statusCode).toBe(429);
    expect(err.type).toBe('rate_limit_error');
    expect(err.message).toBe(
      'HTTP 429: [rate_limit_error] 已达 5 小时用量上限，预计 07-09 18:30 起逐步恢复 (WINDOW_LIMIT_EXCEEDED)',
    );
    expect(err.retryAfter).toBe(1800);
    expect(err.errorCode).toBe('WINDOW_LIMIT_EXCEEDED');
    expect(err.windowKind).toBe('FIVE_HOUR');
    expect(err.windowResetAt).toBe('2026-07-09T10:30:00Z');
    expect(err.body).toBe(anthropicWindowBody);
  });

  it('OpenAI 网关形态 (/chat): 顶层 {code,message} 的 message 不再为空 (历史缺口修复)', () => {
    // Uint8Array 入参走同一解码路径 (doJSONFullInternal 传 bytes)
    const err = parseHTTPError(429, new TextEncoder().encode(openaiGatewayWindowBody));
    expect(err.message).toBe('HTTP 429: 已达 5 小时用量上限 (WINDOW_LIMIT_EXCEEDED)');
    // 该形态无 anthropic/openai error.type 来源, type 留空 (语义: 缺失为空)
    expect(err.type).toBe('');
    expect(err.errorCode).toBe('WINDOW_LIMIT_EXCEEDED');
    expect(err.windowKind).toBe('FIVE_HOUR');
    expect(err.windowResetAt).toBe('2026-07-09T10:30:00Z');
    expect(err.body).toBe(openaiGatewayWindowBody);
  });

  it('Anthropic 旧形态 (无窗口字段): 输出与既往完全一致, 新属性为 undefined', () => {
    const body = JSON.stringify({ type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } });
    const err = parseHTTPError(529, body);
    expect(err.message).toBe('HTTP 529: [overloaded_error] Overloaded');
    expect(err.type).toBe('overloaded_error');
    expect(err.body).toBe(body);
    expect(err.errorCode).toBeUndefined();
    expect(err.windowKind).toBeUndefined();
    expect(err.windowResetAt).toBeUndefined();
  });

  it('windowKind 未知档位不伪造进闭合联合 (原值仍在 body 原串), errorCode 照常透传', () => {
    const body = JSON.stringify({ code: 429, message: 'x (WINDOW_LIMIT_EXCEEDED)', errorCode: 'WINDOW_LIMIT_EXCEEDED', windowKind: 'DAILY' });
    const err = parseHTTPError(429, body);
    expect(err.errorCode).toBe('WINDOW_LIMIT_EXCEEDED');
    expect(err.windowKind).toBeUndefined();
    expect(err.body).toContain('DAILY');
  });

  it('非 JSON body 行为不变: message = HTTP {status}: {body}, 新属性 undefined', () => {
    const err = parseHTTPError(500, 'upstream exploded');
    expect(err.message).toBe('HTTP 500: upstream exploded');
    expect(err.type).toBe('');
    expect(err.body).toBe('upstream exploded');
    expect(err.retryAfter).toBe(0);
    expect(err.errorCode).toBeUndefined();
    expect(err.windowKind).toBeUndefined();
    expect(err.windowResetAt).toBeUndefined();
  });

  it('空 body 行为不变: message = HTTP {status}', () => {
    const err = parseHTTPError(503, '');
    expect(err.message).toBe('HTTP 503');
    expect(err.type).toBe('');
    expect(err.body).toBe('');
    expect(err.errorCode).toBeUndefined();
  });
});

describe('isWindowLimitError', () => {
  it('结构化 errorCode 优先命中, 且 type guard 收窄到 HTTPError', () => {
    const err: unknown = parseHTTPErrorWithHeader(429, anthropicWindowBody, null);
    expect(isWindowLimitError(err)).toBe(true);
    if (isWindowLimitError(err)) {
      // 编译期已收窄为 HTTPError, 直接取窗口字段
      expect(err.windowKind).toBe('FIVE_HOUR');
      expect(err.windowResetAt).toBe('2026-07-09T10:30:00Z');
    }
  });

  it('防御兜底: 无顶层 errorCode 的旧后端, message 文案含机器码也命中', () => {
    const legacyBody = JSON.stringify({
      type: 'error',
      error: { type: 'rate_limit_error', message: '已达 5 小时用量上限 (WINDOW_LIMIT_EXCEEDED)' },
    });
    const err = parseHTTPError(429, legacyBody);
    expect(err.errorCode).toBeUndefined();
    expect(isWindowLimitError(err)).toBe(true);
  });

  it('防御兜底: 机器码只存活在 body 原串 (message 不含) 也命中', () => {
    const err = new HTTPError(429, { message: 'quota hold rejected', body: '{"errorCode":"WINDOW_LIMIT_EXCEEDED"}' });
    expect(err.message.includes('WINDOW_LIMIT_EXCEEDED')).toBe(false);
    expect(isWindowLimitError(err)).toBe(true);
  });

  it('negative: 普通 429 rate limit / RateLimitError / 非 HTTPError 不误判', () => {
    expect(isWindowLimitError(new HTTPError(429, { type: 'rate_limit_error', message: 'Too many requests' }))).toBe(false);
    expect(isWindowLimitError(new RateLimitError('too many downloads', '60', 'raw'))).toBe(false);
    expect(isWindowLimitError(new Error('WINDOW_LIMIT_EXCEEDED'))).toBe(false); // 非 HTTPError
    expect(isWindowLimitError('WINDOW_LIMIT_EXCEEDED')).toBe(false);
    expect(isWindowLimitError(null)).toBe(false);
    expect(isWindowLimitError(undefined)).toBe(false);
  });
});

describe('isWindowLimitStreamError', () => {
  it('agent-run SSE 契约: code === "window_limit_exceeded" 命中 (AgentRunStreamError / 裸 payload)', () => {
    const streamErr = new AgentRunStreamError({
      type: 'error',
      error: {
        code: 'window_limit_exceeded',
        message: '已达 5 小时用量上限',
        stage: 'entitlement',
        retryable: false,
        windowKind: 'FIVE_HOUR',
        windowResetAt: '2026-07-09T10:30:00Z',
      },
    });
    expect(isWindowLimitStreamError(streamErr)).toBe(true);
    expect(isWindowLimitStreamError(streamErr.event.error)).toBe(true); // 裸 AgentRunErrorPayload
  });

  it('StreamError (managed-model failed 事件) code 命中', () => {
    expect(isWindowLimitStreamError(new StreamError({ code: 'window_limit_exceeded', message: '限额' }))).toBe(true);
  });

  it('防御兜底: Anthropic 形态流错误事件只有文案内机器码也命中', () => {
    const streamErr = parseStreamError(
      JSON.stringify({
        type: 'error',
        error: { type: 'rate_limit_error', message: '已达 5 小时用量上限 (WINDOW_LIMIT_EXCEEDED)' },
      }),
    );
    expect(streamErr.code).toBe('rate_limit_error'); // 结构化 code 不是窗口限额
    expect(isWindowLimitStreamError(streamErr)).toBe(true); // 子串兜底命中
  });

  it('negative: 普通流错误 / 非对象不误判', () => {
    expect(isWindowLimitStreamError(new StreamError({ code: 'rate_limit', message: '请求过快' }))).toBe(false);
    expect(
      isWindowLimitStreamError(
        new AgentRunStreamError({ type: 'error', error: { code: 'quota_exhausted', message: 'no quota' } }),
      ),
    ).toBe(false);
    expect(isWindowLimitStreamError(null)).toBe(false);
    expect(isWindowLimitStreamError('window_limit_exceeded')).toBe(false);
    expect(isWindowLimitStreamError(42)).toBe(false);
  });
});

describe('agent-run SSE error 事件 — 窗口字段透传', () => {
  it('契约扁平 payload (camelCase): windowKind / windowResetAt 透传到 event.error', async () => {
    const frame = `event: error\ndata: ${JSON.stringify({
      code: 'window_limit_exceeded',
      message: '已达 5 小时用量上限',
      stage: 'entitlement',
      retryable: false,
      windowKind: 'FIVE_HOUR',
      windowResetAt: '2026-07-09T10:30:00Z',
    })}\n\n`;
    const client = clientWithFetch(async () => sseResponse(frame));

    const events: AgentRunStreamEvent[] = [];
    for await (const event of client.agentRuns.stream('run_1', { throwOnError: false })) {
      events.push(event);
    }

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: 'error',
      error: {
        code: 'window_limit_exceeded',
        stage: 'entitlement',
        retryable: false,
        windowKind: 'FIVE_HOUR',
        windowResetAt: '2026-07-09T10:30:00Z',
      },
    });
    expect(isWindowLimitStreamError((events[0] as Extract<AgentRunStreamEvent, { type: 'error' }>).error)).toBe(true);
  });

  it('嵌套 error 对象 + snake_case 拼写兼容兜底', async () => {
    const frame = `event: error\ndata: ${JSON.stringify({
      type: 'error',
      error: {
        code: 'window_limit_exceeded',
        message: '已达 7 天用量上限',
        window_kind: 'WEEKLY',
        window_reset_at: '2026-07-14T00:00:00Z',
      },
    })}\n\n`;
    const client = clientWithFetch(async () => sseResponse(frame));

    const events: AgentRunStreamEvent[] = [];
    for await (const event of client.agentRuns.stream('run_1', { throwOnError: false })) {
      events.push(event);
    }

    expect(events[0]).toMatchObject({
      type: 'error',
      error: { code: 'window_limit_exceeded', windowKind: 'WEEKLY', windowResetAt: '2026-07-14T00:00:00Z' },
    });
  });

  it('默认 throwOnError: 抛出的 AgentRunStreamError 保留窗口字段且可被识别', async () => {
    const frame = `event: error\ndata: ${JSON.stringify({
      code: 'window_limit_exceeded',
      message: '已达 5 小时用量上限',
      stage: 'entitlement',
      retryable: false,
      windowKind: 'FIVE_HOUR',
      windowResetAt: '2026-07-09T10:30:00Z',
    })}\n\n`;
    const client = clientWithFetch(async () => sseResponse(frame));

    let caught: unknown;
    try {
      for await (const _event of client.agentRuns.stream('run_1')) {
        // consume
      }
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(AgentRunStreamError);
    const streamErr = caught as AgentRunStreamError;
    expect(streamErr.code).toBe('window_limit_exceeded');
    expect(streamErr.event.error.windowKind).toBe('FIVE_HOUR');
    expect(streamErr.event.error.windowResetAt).toBe('2026-07-09T10:30:00Z');
    expect(isWindowLimitStreamError(streamErr)).toBe(true);
  });
});

describe('QuotaSummary.windowLimits', () => {
  it('类型形态: windowLimits 可选, resetAt 可为 string / null / 缺失', () => {
    const limits: WindowLimitStatus[] = [
      { kind: 'FIVE_HOUR', limitCredits: 123, usedCredits: 45, resetAt: '2026-07-09T10:30:00Z' },
      { kind: 'WEEKLY', limitCredits: 1000, usedCredits: 0, resetAt: null },
      { kind: 'WEEKLY', limitCredits: 1000, usedCredits: 0 },
    ];
    const withLimits: QuotaSummary = {
      freeTotalEtu: 1,
      paidTotalEtu: 2,
      freeBuckets: [],
      paidBuckets: [],
      windowLimits: limits,
    };
    // 后端未启用窗口限额: 字段整个缺失, 老形态照常合法 (向后兼容)
    const withoutLimits: QuotaSummary = {
      freeTotalEtu: 1,
      paidTotalEtu: 2,
      freeBuckets: [],
      paidBuckets: [],
    };
    expect(withLimits.windowLimits).toHaveLength(3);
    expect(withoutLimits.windowLimits).toBeUndefined();
  });

  it('getQuotaSummary 解析透传 windowLimits; 后端未启用时为 undefined', async () => {
    const data = {
      freeTotalEtu: 10,
      paidTotalEtu: 20,
      freeBuckets: [],
      paidBuckets: [],
      windowLimits: [
        { kind: 'FIVE_HOUR', limitCredits: 123, usedCredits: 45, resetAt: '2026-07-09T10:30:00Z' },
        { kind: 'WEEKLY', limitCredits: 1000, usedCredits: 45, resetAt: null },
      ],
    };
    const urls: string[] = [];
    const client = clientWithFetch(async (url) => {
      urls.push(String(url));
      return jsonResponse({ code: 0, message: 'success', data });
    });

    const summary = await client.getQuotaSummary();
    expect(urls[0]).toContain('/entitlements/quota-summary');
    expect(summary.windowLimits).toEqual(data.windowLimits);

    const legacyClient = clientWithFetch(async () =>
      jsonResponse({ code: 0, message: 'success', data: { freeTotalEtu: 1, paidTotalEtu: 2, freeBuckets: [], paidBuckets: [] } }),
    );
    const legacy = await legacyClient.getQuotaSummary();
    expect(legacy.windowLimits).toBeUndefined();
  });
});
