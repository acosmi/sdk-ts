// window-reset-credits.test.ts — 邀请奖励窗口重置券 (window-reset credits, v2.13.0)。
//
// 覆盖：
//   - WindowResetSummary 类型形态 (nextExpireAt 可为 string / null) + 公共导出面可达。
//   - getWindowResetSummary: GET /entitlements/window-reset/summary 六字段解析透传。
//   - redeemWindowReset: POST /entitlements/window-reset/redeem, clientRequestId 幂等键
//     入 body; 缺省时 body 不含该键 (JSON.stringify 丢弃 undefined)。
//   - 业务错透出: 信封 code != 0 按 SDK 惯例抛 BusinessError, 机器码
//     (NO_AVAILABLE_CREDIT / NO_WINDOW_USAGE) 随 message 透出, code 原样保留。

import { describe, expect, it } from 'vitest';

import { BusinessError, Client, type WindowResetSummary } from '../src/index';

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

describe('WindowResetSummary 类型形态', () => {
  it('nextExpireAt 可为 ISO 串 / null; 六字段齐备', () => {
    const withCredits: WindowResetSummary = {
      availableCount: 2,
      nextExpireAt: '2026-08-31T10:30:00Z',
      totalGranted: 5,
      totalUsed: 3,
      qualifiedInvites: 5,
      pendingInvites: 1,
    };
    // 无可用券: nextExpireAt 为 null (不是缺失, 契约为 string | null)
    const empty: WindowResetSummary = {
      availableCount: 0,
      nextExpireAt: null,
      totalGranted: 0,
      totalUsed: 0,
      qualifiedInvites: 0,
      pendingInvites: 0,
    };
    expect(withCredits.nextExpireAt).toBe('2026-08-31T10:30:00Z');
    expect(empty.nextExpireAt).toBeNull();
    expect(empty.availableCount).toBe(0);
  });
});

describe('getWindowResetSummary', () => {
  it('GET /entitlements/window-reset/summary 六字段解析透传', async () => {
    const data = {
      availableCount: 2,
      nextExpireAt: '2026-08-31T10:30:00Z',
      totalGranted: 5,
      totalUsed: 3,
      qualifiedInvites: 5,
      pendingInvites: 1,
    };
    const urls: string[] = [];
    const methods: (string | undefined)[] = [];
    const client = clientWithFetch(async (url, init) => {
      urls.push(String(url));
      methods.push(init?.method);
      return jsonResponse({ code: 0, message: 'success', data });
    });

    const summary = await client.getWindowResetSummary();
    expect(urls[0]).toContain('/entitlements/window-reset/summary');
    expect(methods[0]).toBe('GET');
    expect(summary).toEqual(data);
  });

  it('无可用券: availableCount=0 且 nextExpireAt=null 原样透传', async () => {
    const client = clientWithFetch(async () =>
      jsonResponse({
        code: 0,
        message: 'success',
        data: {
          availableCount: 0,
          nextExpireAt: null,
          totalGranted: 3,
          totalUsed: 3,
          qualifiedInvites: 3,
          pendingInvites: 2,
        },
      }),
    );

    const summary = await client.getWindowResetSummary();
    expect(summary.availableCount).toBe(0);
    expect(summary.nextExpireAt).toBeNull();
    expect(summary.totalUsed).toBe(3);
    expect(summary.pendingInvites).toBe(2);
  });
});

describe('redeemWindowReset', () => {
  it('POST /entitlements/window-reset/redeem 带 clientRequestId 幂等键, 返回 remaining', async () => {
    let capturedUrl = '';
    let capturedMethod: string | undefined;
    let capturedBody: unknown;
    const client = clientWithFetch(async (url, init) => {
      capturedUrl = String(url);
      capturedMethod = init?.method;
      capturedBody = init?.body ? JSON.parse(String(init.body)) : undefined;
      return jsonResponse({ code: 0, message: 'success', data: { remaining: 1 } });
    });

    const res = await client.redeemWindowReset({ clientRequestId: 'req-abc-1' });
    expect(capturedUrl).toContain('/entitlements/window-reset/redeem');
    expect(capturedMethod).toBe('POST');
    expect(capturedBody).toEqual({ clientRequestId: 'req-abc-1' });
    expect(res.remaining).toBe(1);
  });

  it('幂等键: 同一 clientRequestId 重放, 网关回同一 remaining (不二次扣券)', async () => {
    const bodies: unknown[] = [];
    const client = clientWithFetch(async (_url, init) => {
      bodies.push(init?.body ? JSON.parse(String(init.body)) : undefined);
      // 网关按幂等键返回首次结果 — 两次调用 remaining 相同
      return jsonResponse({ code: 0, message: 'success', data: { remaining: 2 } });
    });

    const first = await client.redeemWindowReset({ clientRequestId: 'req-dup' });
    const replay = await client.redeemWindowReset({ clientRequestId: 'req-dup' });
    expect(first.remaining).toBe(2);
    expect(replay.remaining).toBe(2);
    expect(bodies).toEqual([{ clientRequestId: 'req-dup' }, { clientRequestId: 'req-dup' }]);
  });

  it('缺省 opts: body 不含 clientRequestId 键 (undefined 被 JSON.stringify 丢弃)', async () => {
    let capturedBody: unknown;
    const client = clientWithFetch(async (_url, init) => {
      capturedBody = init?.body ? JSON.parse(String(init.body)) : undefined;
      return jsonResponse({ code: 0, message: 'success', data: { remaining: 0 } });
    });

    const res = await client.redeemWindowReset();
    expect(capturedBody).toEqual({});
    expect(Object.keys(capturedBody as object)).not.toContain('clientRequestId');
    expect(res.remaining).toBe(0);
  });

  it('业务错 NO_AVAILABLE_CREDIT: 抛 BusinessError, 机器码随 message 透出, code 保留', async () => {
    const client = clientWithFetch(async () =>
      jsonResponse({
        code: 1_002_001_001,
        message: 'NO_AVAILABLE_CREDIT: 无可用的窗口重置次数',
        data: null,
      }),
    );

    await expect(client.redeemWindowReset({ clientRequestId: 'req-1' })).rejects.toThrow(
      BusinessError,
    );

    try {
      await client.redeemWindowReset({ clientRequestId: 'req-1' });
      expect.unreachable('redeemWindowReset 应抛 BusinessError');
    } catch (e) {
      expect(e).toBeInstanceOf(BusinessError);
      expect((e as BusinessError).code).toBe(1_002_001_001);
      expect((e as BusinessError).message).toContain('NO_AVAILABLE_CREDIT');
    }
  });

  it('业务错 NO_WINDOW_USAGE: 同样抛 BusinessError (无已用量, 不扣券)', async () => {
    const client = clientWithFetch(async () =>
      jsonResponse({
        code: 1_002_001_002,
        message: 'NO_WINDOW_USAGE: 当前窗口无已用量, 无需重置',
        data: null,
      }),
    );

    try {
      await client.redeemWindowReset();
      expect.unreachable('redeemWindowReset 应抛 BusinessError');
    } catch (e) {
      expect(e).toBeInstanceOf(BusinessError);
      expect((e as BusinessError).code).toBe(1_002_001_002);
      expect((e as BusinessError).message).toContain('NO_WINDOW_USAGE');
    }
  });

  it('getWindowResetSummary 业务错同样透出 BusinessError', async () => {
    const client = clientWithFetch(async () =>
      jsonResponse({ code: 401, message: '未登录', data: null }),
    );
    await expect(client.getWindowResetSummary()).rejects.toThrow(BusinessError);
  });
});
