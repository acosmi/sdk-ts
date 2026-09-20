// quota-summary.test.ts — 2026-09-20
//
// 立项: cloud-agent docs/audit/2026-09-20-重置卡语义与加油包-三笔账根因审计与实施方案.md
//       (W-RESET-CARD-WEEKLY-QUOTA-20260920, D-13「额度池行显示加油包份额」)
//
// 覆盖 QuotaSummary.subscriptionPool 的加油包三件套 boosterRemaining / boosterCount /
// boosterNextExpiresAt。这三个字段是**追加式可选**的: 缺席的含义是「老网关」或「此刻没有
// 加油包」, 两种都不可当 0 读 —— 展示端的合同是三个齐全才渲染副行。
//
// 每条断言都带正向对照, 在「网关压根没下发」的世界里必须变红:
//   · 网关下发 → 读到的必须是**网关给的那几个值**, 不是任何自造/派生/默认值
//   · 网关不下发 → 三个键在结果对象上**不存在** (不是 0、不是 null); 既有字段照常
//   · 只缺到期时刻 (全是永久加油包桶) → 份额与个数仍在, 只有 boosterNextExpiresAt 缺席

import { describe, expect, it } from 'vitest';

import { Client, type QuotaSummary } from '../src/index';

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

/** 网关 quota-summary 的骨架 (不含加油包三件套), 各用例只在 subscriptionPool 上做增量。 */
function summaryPayload(pool: Record<string, unknown>) {
  return {
    freeTotalEtu: 0,
    paidTotalEtu: 2_960_000,
    freeBuckets: [],
    paidBuckets: [],
    subscriptionPool: pool,
  };
}

describe('getQuotaSummary — 订阅池的加油包份额 (D-13)', () => {
  it('网关下发三字段时, 逐值透传 (读到的是网关给的那几个数)', async () => {
    let requestedPath = '';
    const client = clientWithFetch((async (input: RequestInfo | URL) => {
      requestedPath = new URL(String(input)).pathname;
      return jsonResponse({
        code: 0,
        message: 'success',
        data: summaryPayload({
          quota: 3_000_000,
          used: 40_000,
          remaining: 2_960_000,
          expiresAt: '2026-10-20T00:00:00Z',
          unit: 'MICRO_CREDIT',
          boosterRemaining: 2_960_000,
          boosterCount: 2,
          boosterNextExpiresAt: '2026-09-27T00:00:00Z',
        }),
      });
    }) as unknown as typeof fetch);

    const summary: QuotaSummary = await client.getQuotaSummary();

    expect(requestedPath).toBe('/api/v4/entitlements/quota-summary');
    const pool = summary.subscriptionPool;
    expect(pool).toBeDefined();
    // 正向对照的要点: 断言的是**网关给的那个值**, 换成 remaining / quota 都对不上。
    expect(pool?.boosterRemaining).toBe(2_960_000);
    expect(pool?.boosterCount).toBe(2);
    expect(pool?.boosterNextExpiresAt).toBe('2026-09-27T00:00:00Z');
    // 加油包份额是池的**子集**, 不是池本身 —— 两个到期时刻也各自独立。
    expect(pool?.remaining).toBe(2_960_000);
    expect(pool?.expiresAt).toBe('2026-10-20T00:00:00Z');
    expect(pool?.unit).toBe('MICRO_CREDIT');
  });

  it('网关不下发时, 三个键在结果对象上不存在 (缺席 ≠ 0)', async () => {
    const client = clientWithFetch((async () =>
      jsonResponse({
        code: 0,
        message: 'success',
        data: summaryPayload({
          quota: 3_000_000,
          used: 40_000,
          remaining: 2_960_000,
          unit: 'MICRO_CREDIT',
        }),
      })) as unknown as typeof fetch);

    const summary = await client.getQuotaSummary();
    const pool = summary.subscriptionPool;
    expect(pool).toBeDefined();

    // 用 in 而不是 === undefined: 「键不存在」与「键在但值为 undefined」对 JSON 往返是两回事,
    // 后者会在 JSON.stringify 后凭空消失/出现, 展示端的三选一判据就不稳。
    expect('boosterRemaining' in (pool as object)).toBe(false);
    expect('boosterCount' in (pool as object)).toBe(false);
    expect('boosterNextExpiresAt' in (pool as object)).toBe(false);

    // 正向对照: 池的既有字段照常读得到 —— 上面三条不是因为整个 subscriptionPool 没解出来。
    expect(pool?.remaining).toBe(2_960_000);
    expect(pool?.quota).toBe(3_000_000);
    expect(pool?.used).toBe(40_000);
    expect(pool?.unit).toBe('MICRO_CREDIT');
  });

  it('加油包全是永久桶时, 只有 boosterNextExpiresAt 缺席, 份额与个数仍在', async () => {
    const client = clientWithFetch((async () =>
      jsonResponse({
        code: 0,
        message: 'success',
        data: summaryPayload({
          quota: 3_000_000,
          used: 40_000,
          remaining: 2_960_000,
          unit: 'MICRO_CREDIT',
          boosterRemaining: 560_000,
          boosterCount: 1,
        }),
      })) as unknown as typeof fetch);

    const pool = (await client.getQuotaSummary()).subscriptionPool;
    expect(pool?.boosterRemaining).toBe(560_000);
    expect(pool?.boosterCount).toBe(1);
    expect('boosterNextExpiresAt' in (pool as object)).toBe(false);
  });
});
