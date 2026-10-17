// quota-summary.two-pool.test.ts — 2026-10-17
//
// 立项: cloud-agent docs/audit/2026-10-17-订阅权益双池与官方价计费-根因审计与实施方案.md
//       (D-14「展示契约追加式扩展」, §4.8, §5 P5-SDK)
//
// 三方共用的契约 fixture (test/fixtures/*.json) 在这里被钉死:
//   · quota-summary.two-pool.json —— 新合同的 quota-summary 完整响应体 (含 freePool / creditUnit)
//   · quota-summary.legacy.json   —— 老合同 / 老网关: 同一份响应体去掉这两个键
//   · managed-models.two-pool.json / managed-models.legacy.json —— 目录条目带 / 不带 freePoolEligible
//
// 契约的核心是「缺席 ≠ 0」: 老合同没有 F 池, 老网关根本不认识 F 池, 两种情况 freePool 整个键都不在响应里。
// 展示端把缺席读成 0 就会给老合同用户画出一条「精选额度 0 / 已用满」的假进度条。所以这里的每条断言
// 都带正向对照, 并且「读 undefined」用 `in` 判键是否存在, 而不是只看值。

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { Client, type ManagedModel, type QuotaSummary } from '../src/index';

const future = new Date(Date.now() + 60_000).toISOString();

function loadFixture<T = unknown>(name: string): T {
  return JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8')) as T;
}

interface Envelope<T> {
  code: number;
  message: string;
  data: T;
}

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

/** 原样回放一份 fixture 文本作为网关响应体 (不经 JS 对象再序列化, 保证 SDK 读到的就是文件里的字节)。 */
function replay(fixtureName: string): typeof fetch {
  const raw = readFileSync(new URL(`./fixtures/${fixtureName}`, import.meta.url), 'utf8');
  return (async () =>
    new Response(raw, {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })) as unknown as typeof fetch;
}

const CREDIT_UNITS = ['OFFICIAL_CNY', 'COST_CNY'];

/**
 * 契约校验器: 把 P5 契约里「值域」写成可执行断言。fixture 被篡改成契约外的值时这里必须抛。
 * (类型是编译期的, 这里是运行期的 —— 网关实现 / 手改 fixture 都绕得过类型。)
 */
function assertTwoPoolContract(s: QuotaSummary): void {
  const fp = s.freePool;
  if (fp !== undefined) {
    expect(fp.unit, 'freePool.unit').toBe('MICRO_CREDIT');
    expect(Array.isArray(fp.eligibleModels), 'freePool.eligibleModels 必须是数组').toBe(true);
    for (const m of fp.eligibleModels) expect(typeof m).toBe('string');
    for (const k of ['quota', 'used', 'remaining'] as const) {
      expect(Number.isInteger(fp[k]), `freePool.${k} 必须是整数`).toBe(true);
    }
    expect(fp.quota).toBeGreaterThan(0); // 额度 0 的池不下发 (见 buildQuotaSummary 对 subscriptionPool 的同口径)
    expect(fp.remaining).toBe(fp.quota - fp.used);
    if (fp.expiresAt !== undefined) expect(Number.isNaN(Date.parse(fp.expiresAt))).toBe(false);
  }
  if (s.creditUnit !== undefined) {
    expect(CREDIT_UNITS, 'creditUnit').toContain(s.creditUnit);
  }
}

describe('quota-summary 契约 fixture — 新合同 (two-pool)', () => {
  it('freePool / creditUnit 逐值透传, 读到的是文件里的那几个数', async () => {
    const fixture = loadFixture<Envelope<QuotaSummary>>('quota-summary.two-pool.json');
    let requestedPath = '';
    const inner = replay('quota-summary.two-pool.json');
    const client = clientWithFetch((async (input: RequestInfo | URL, init?: RequestInit) => {
      requestedPath = new URL(String(input)).pathname;
      return inner(input, init);
    }) as unknown as typeof fetch);

    const summary = await client.getQuotaSummary();

    expect(requestedPath).toBe('/api/v4/entitlements/quota-summary');
    expect(summary.freePool).toBeDefined();
    expect(summary.freePool?.quota).toBe(19_950_000_000);
    expect(summary.freePool?.used).toBe(500_000_000);
    expect(summary.freePool?.remaining).toBe(19_450_000_000);
    expect(summary.freePool?.expiresAt).toBe('2026-11-17T00:00:00Z');
    expect(summary.freePool?.unit).toBe('MICRO_CREDIT');
    expect(summary.freePool?.eligibleModels).toEqual([
      'deepseek-flash',
      'qwen3.7-flash',
      'ZHIPU/GLM-5.3-Flash',
    ]);
    expect(summary.creditUnit).toBe('OFFICIAL_CNY');

    // 不裁字段: SDK 交出的就是网关 data 整体 (含 subscriptionPool / windowLimits / 加油包三件套)。
    expect(summary).toEqual(fixture.data);
    assertTwoPoolContract(summary);
  });

  it('subscriptionPool 语义不变 = 付费池 P, 与 freePool 是两个独立对象', async () => {
    const client = clientWithFetch(replay('quota-summary.two-pool.json'));
    const summary = await client.getQuotaSummary();

    const p = summary.subscriptionPool;
    const f = summary.freePool;
    expect(p).toBeDefined();
    expect(f).toBeDefined();
    // 正向对照: P 的数字还是 P 的 (含加油包桶), 不是 P+F, 也不是 F。
    expect(p?.quota).toBe(44_900_000_000);
    expect(p?.remaining).toBe(40_700_000_000);
    expect(p?.unit).toBe('MICRO_CREDIT');
    expect(p?.boosterRemaining).toBe(5_000_000_000);
    expect(p).not.toBe(f);
    expect(p?.quota).not.toBe(f?.quota);
    // paidTotalEtu 仍是 alive COMMERCIAL 桶之和 = P.remaining, 一个字没动。
    expect(summary.paidTotalEtu).toBe(p?.remaining);
    // GENERIC 赠送桶是另一回事: freeTotalEtu 不等于 freePool.remaining, 也不并入它。
    expect(summary.freeTotalEtu).toBe(750_000);
    expect(summary.freeTotalEtu).not.toBe(f?.remaining);
  });

  it('窗口基准字段随同一响应原样到达 (D-13: 基准 = P + F, SDK 不做任何再计算)', async () => {
    const client = clientWithFetch(replay('quota-summary.two-pool.json'));
    const summary = await client.getQuotaSummary();
    const five = summary.windowLimits?.find((w) => w.kind === 'FIVE_HOUR');
    const weekly = summary.windowLimits?.find((w) => w.kind === 'WEEKLY');
    // fixture 里 Plus 周期: P 订阅桶 39.9B + F 19.95B = 59.85B; 5h 8% / 周 35% (加油包桶不进基准)。
    const base = 39_900_000_000 + (summary.freePool?.quota ?? 0);
    expect(base).toBe(59_850_000_000);
    expect(five?.limitCredits).toBe(Math.round(base * 0.08));
    expect(weekly?.limitCredits).toBe(Math.round(base * 0.35));
    // 缺席语义的既有字段不受影响: 周窗没有在途预占 → 键不存在, 不是 0。
    expect('inflightHeldCredits' in (weekly as object)).toBe(false);
    expect(five?.inflightHeldCredits).toBe(30_000_000);
  });
});

describe('quota-summary 契约 fixture — 老合同 / 老网关 (legacy)', () => {
  it('freePool 与 creditUnit 的键根本不存在 (缺席 ≠ 0)', async () => {
    const client = clientWithFetch(replay('quota-summary.legacy.json'));
    const summary = await client.getQuotaSummary();

    // 用 in 而不是 === undefined: 「键不存在」与「键在但值是 undefined」对 JSON 往返是两回事。
    expect('freePool' in summary).toBe(false);
    expect('creditUnit' in summary).toBe(false);
    expect(summary.freePool).toBeUndefined();
    expect(summary.creditUnit).toBeUndefined();

    // 逐个字段证明「不是被读成 0」: 任何一个数值读法都必须是 undefined, 不是 0 / NaN。
    expect(summary.freePool?.quota).toBeUndefined();
    expect(summary.freePool?.used).toBeUndefined();
    expect(summary.freePool?.remaining).toBeUndefined();
    expect(summary.freePool?.eligibleModels).toBeUndefined();
    expect(summary.freePool?.quota ?? null).not.toBe(0);
    expect(summary.freePool).not.toEqual({ quota: 0, used: 0, remaining: 0 });

    // 正向对照: legacy 响应本身是完整可读的 —— 上面不是因为整个响应没解出来。
    expect(summary.subscriptionPool?.quota).toBe(44_900_000_000);
    expect(summary.subscriptionPool?.unit).toBe('MICRO_CREDIT');
    expect(summary.windowLimits).toHaveLength(2);
    assertTwoPoolContract(summary);
  });

  it('legacy 与 two-pool 只差 freePool / creditUnit 两个键 (追加式: 其余字段逐值相同)', () => {
    const twoPool = loadFixture<Envelope<Record<string, unknown>>>('quota-summary.two-pool.json');
    const legacy = loadFixture<Envelope<Record<string, unknown>>>('quota-summary.legacy.json');

    const stripped = { ...twoPool.data };
    delete stripped.freePool;
    delete stripped.creditUnit;
    // 老客户端读新响应: 把新键拿掉之后必须与老响应逐值相同 —— 既有字段的语义一个都没挪。
    expect(stripped).toEqual(legacy.data);
    expect(Object.keys(twoPool.data).filter((k) => !(k in legacy.data)).sort()).toEqual([
      'creditUnit',
      'freePool',
    ]);
  });

  it('只有 creditUnit 而没有 freePool 也成立 (老合同在新网关上: COST_CNY, 无 F)', async () => {
    const legacyOnNewGateway = loadFixture<Envelope<QuotaSummary>>('quota-summary.legacy.json');
    legacyOnNewGateway.data.creditUnit = 'COST_CNY';
    const client = clientWithFetch((async () =>
      new Response(JSON.stringify(legacyOnNewGateway), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })) as unknown as typeof fetch);

    const summary = await client.getQuotaSummary();
    expect(summary.creditUnit).toBe('COST_CNY');
    expect(summary.freePool).toBeUndefined();
    expect('freePool' in summary).toBe(false);
    assertTwoPoolContract(summary);
  });
});

describe('契约校验器自身 (篡改 → 必红)', () => {
  const tampered = (mutate: (d: QuotaSummary) => void): QuotaSummary => {
    const d = loadFixture<Envelope<QuotaSummary>>('quota-summary.two-pool.json').data;
    mutate(d);
    return d;
  };

  it('freePool.unit 不是 MICRO_CREDIT', () => {
    const s = tampered((d) => {
      (d.freePool as unknown as { unit: string }).unit = 'CREDIT';
    });
    expect(() => assertTwoPoolContract(s)).toThrow();
  });

  it('creditUnit 是未知值', () => {
    const s = tampered((d) => {
      (d as unknown as { creditUnit: string }).creditUnit = 'USD';
    });
    expect(() => assertTwoPoolContract(s)).toThrow();
  });

  it('eligibleModels 不是字符串数组', () => {
    const s = tampered((d) => {
      (d.freePool as unknown as { eligibleModels: unknown }).eligibleModels = 'deepseek-flash';
    });
    expect(() => assertTwoPoolContract(s)).toThrow();
  });

  it('remaining 对不上 quota - used', () => {
    const s = tampered((d) => {
      (d.freePool as { remaining: number }).remaining = 1;
    });
    expect(() => assertTwoPoolContract(s)).toThrow();
  });

  it('把 legacy 当成「有 freePool」来读必红 (读到 undefined 而不是对象)', () => {
    const legacy = loadFixture<Envelope<QuotaSummary>>('quota-summary.legacy.json').data;
    // 这条就是「错误的展示端」的行为: 假定 freePool 一定存在。契约断言要把它抓出来。
    expect(() => {
      expect(legacy.freePool, 'legacy 不应有 freePool').toBeDefined();
    }).toThrow();
  });

  it('空数组 eligibleModels 合法, 且与缺席不同', () => {
    const s = tampered((d) => {
      (d.freePool as { eligibleModels: string[] }).eligibleModels = [];
    });
    expect(() => assertTwoPoolContract(s)).not.toThrow();
    expect(s.freePool?.eligibleModels).toEqual([]);
    expect(s.freePool?.eligibleModels).not.toBeUndefined();
  });
});

describe('托管模型目录 — freePoolEligible (三态: true / false / 缺席)', () => {
  it('two-pool: 逐条读到网关给的值, freeTier / locked 语义不动', async () => {
    const client = clientWithFetch(replay('managed-models.two-pool.json'));
    const models: ManagedModel[] = await client.listModels();
    const byId = new Map(models.map((m) => [m.modelId, m]));

    expect(byId.get('deepseek-flash')?.freePoolEligible).toBe(true);
    expect(byId.get('ZHIPU/GLM-5.3-Flash')?.freePoolEligible).toBe(true);
    expect(byId.get('qwen3.8-max')?.freePoolEligible).toBe(false);
    expect(byId.get('kimi-k3')?.freePoolEligible).toBe(false);

    // freeTier 与 freePoolEligible 是两套集合, 并存且互不派生:
    expect(byId.get('deepseek-flash')?.freeTier).toBe(true);
    expect(byId.get('ZHIPU/GLM-5.3-Flash')?.freeTier).toBe(false);
    expect(byId.get('kimi-k3')?.locked).toBe(true);
    expect(byId.get('qwen3.8-max')?.minPlanTier).toBe(1);
  });

  it('two-pool: freePoolEligible 与 quota-summary.freePool.eligibleModels 同源一致', async () => {
    const catalog = loadFixture<Envelope<ManagedModel[]>>('managed-models.two-pool.json').data;
    const summary = loadFixture<Envelope<QuotaSummary>>('quota-summary.two-pool.json').data;
    const fromCatalog = catalog
      .filter((m) => m.freePoolEligible === true)
      .map((m) => m.modelId)
      .sort();
    const fromSummary = [...(summary.freePool?.eligibleModels ?? [])].sort();
    // 目录里 true 的集合必须是 eligibleModels 的子集 (目录可以只展示一部分模型, 不可多出)。
    for (const id of fromCatalog) expect(fromSummary).toContain(id);
    expect(fromCatalog).toEqual(['ZHIPU/GLM-5.3-Flash', 'deepseek-flash']);
  });

  it('legacy: freePoolEligible 缺席 → undefined, 不是 false', async () => {
    const client = clientWithFetch(replay('managed-models.legacy.json'));
    const models = await client.listModels();
    expect(models).toHaveLength(4);
    for (const m of models) {
      expect('freePoolEligible' in m).toBe(false);
      expect(m.freePoolEligible).toBeUndefined();
      // 展示端的唯一正确判据: === true 才画「精选」角标; 老网关一个都不画, 而不是全画或全不画「普通」。
      expect(m.freePoolEligible === true).toBe(false);
      expect(m.freePoolEligible === false).toBe(false);
    }
    // 正向对照: 其余门控字段照常读到。
    expect(models.find((m) => m.modelId === 'deepseek-flash')?.freeTier).toBe(true);
    expect(models.find((m) => m.modelId === 'kimi-k3')?.locked).toBe(true);
  });

  it('includeLocked(picker=1) 全集路径同样透传 freePoolEligible', async () => {
    let requested = '';
    const inner = replay('managed-models.two-pool.json');
    const client = clientWithFetch((async (input: RequestInfo | URL, init?: RequestInit) => {
      requested = String(input);
      return inner(input, init);
    }) as unknown as typeof fetch);

    const models = await client.listModels(undefined, { includeLocked: true });
    expect(new URL(requested).search).toBe('?picker=1');
    expect(models.find((m) => m.modelId === 'kimi-k3')?.freePoolEligible).toBe(false);
    expect(models.find((m) => m.modelId === 'deepseek-flash')?.freePoolEligible).toBe(true);
  });

  it('legacy 与 two-pool 目录只差 freePoolEligible 一个键', () => {
    const two = loadFixture<Envelope<Record<string, unknown>[]>>('managed-models.two-pool.json').data;
    const legacy = loadFixture<Envelope<Record<string, unknown>[]>>('managed-models.legacy.json').data;
    const stripped = two.map((m) => {
      const c = { ...m };
      delete c.freePoolEligible;
      return c;
    });
    expect(stripped).toEqual(legacy);
  });
});
