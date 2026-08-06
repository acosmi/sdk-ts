// chat-timeout-budget.test.ts — 2026-08-06 回归闸门
//
// 事故: 生产网关当日 29 条 latency≈30000ms 的 499, 横跨 4 厂商 5 模型 (受害最重的
// 是默认主循环模型)。根因不是网络、不是上游, 而是 chat 链路把 11min 预算建在了
// 外层 AbortController 上, 却漏传给 doJSONFullRaw 的第 5 形参 —— 后者有 30s 默认值,
// 自建计时器恒先触发。v1.6.0 那次"已调整为 11min"的注释因此一天都没生效过。
//
// 本文件钉两件事:
//   1. 行为闸门 — 四条推理/生成链路在 30s 处**不得**中断, 必须活到 CHAT_REQUEST_TIMEOUT_MS
//   2. 结构闸门 — doJSONFullRaw 的**每一个**调用点默认必须显式传预算 (default-deny),
//      控制面端点要豁免必须进显式 allowlist。防的是"下一个新增端点重蹈覆辙"
//
// 断言一律用 CHAT_REQUEST_TIMEOUT_MS **符号**, 绝不抄 660000 字面量 —— 抄件断言会与
// 真源各自漂移, 看着是断言实际零覆盖。

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CHAT_REQUEST_TIMEOUT_MS, Client } from '../src';
import type { ManagedModel } from '../src/models/types';

const future = new Date(Date.now() + 3600_000).toISOString();

/** doJSONFullRaw 的内层默认值。缺显式预算时链路会被钉死在这里。 */
const INNER_DEFAULT_TIMEOUT_MS = 30_000;

/**
 * 永不响应、但在 signal abort 时 reject 的 client (模拟真实 fetch 的 AbortError)。
 * 模型缓存预热, 避免 chat 链路先撞 listModels。
 */
function hangingClient(model: Partial<ManagedModel> & { id: string }): {
  client: Client;
  aborted: () => boolean;
} {
  let sawAbort = false;
  const fetchImpl = ((_url: string | URL | Request, init?: RequestInit) =>
    new Promise<Response>((_resolve, reject) => {
      let settled = false;
      const fail = () => {
        if (settled) return;
        settled = true;
        sawAbort = true;
        reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
      };
      const sig = init?.signal as AbortSignal | undefined;
      if (sig) {
        if (sig.aborted) {
          fail();
          return;
        }
        sig.addEventListener('abort', fail, { once: true });
      }
    })) as unknown as typeof fetch;

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
      modelId: model.id,
      maxTokens: 0,
      isEnabled: true,
      ...model,
    } as ManagedModel,
  ];
  client.modelCacheTimeMs = Date.now();
  return { client, aborted: () => sawAbort };
}

/**
 * 共同判据: 推进到 30s 之后**仍未**中断 (回归发生时这里会红), 再推进到
 * CHAT_REQUEST_TIMEOUT_MS 之后必须中断 (证明预算是这一条而不是别的什么)。
 */
async function expectBudgetIsChatTimeout(
  run: () => Promise<unknown>,
  aborted: () => boolean,
): Promise<void> {
  let rejected = false;
  const p = run().catch(() => {
    rejected = true;
  });

  await vi.advanceTimersByTimeAsync(INNER_DEFAULT_TIMEOUT_MS + 5_000);
  expect(
    rejected || aborted(),
    'chat 链路在 30s 处被中断 — doJSONFullRaw 的第 5 实参又漏传了',
  ).toBe(false);

  await vi.advanceTimersByTimeAsync(
    CHAT_REQUEST_TIMEOUT_MS - INNER_DEFAULT_TIMEOUT_MS,
  );
  await p;
  expect(rejected).toBe(true);
  expect(aborted()).toBe(true);
}

describe('推理链路的真实超时预算 = CHAT_REQUEST_TIMEOUT_MS', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('chatMessages (Anthropic 格式) 活过 30s, 死在 CHAT_REQUEST_TIMEOUT_MS', async () => {
    const { client, aborted } = hangingClient({
      id: 'anthropic-model',
      preferred_format: 'anthropic',
      supported_formats: ['anthropic'],
    });
    await expectBudgetIsChatTimeout(
      () =>
        client.chatMessages('anthropic-model', {
          messages: [{ role: 'user', content: 'hi' }],
          max_tokens: 16,
        }),
      aborted,
    );
  });

  it('chatMessages (OpenAI 格式) 活过 30s, 死在 CHAT_REQUEST_TIMEOUT_MS', async () => {
    const { client, aborted } = hangingClient({
      id: 'openai-model',
      provider: 'deepseek',
      preferred_format: 'openai',
      supported_formats: ['openai'],
    });
    await expectBudgetIsChatTimeout(
      () =>
        client.chatMessages('openai-model', {
          messages: [{ role: 'user', content: 'hi' }],
          max_tokens: 16,
        }),
      aborted,
    );
  });

  it('chat() 活过 30s, 死在 CHAT_REQUEST_TIMEOUT_MS', async () => {
    const { client, aborted } = hangingClient({
      id: 'anthropic-model',
      preferred_format: 'anthropic',
      supported_formats: ['anthropic'],
    });
    await expectBudgetIsChatTimeout(
      () =>
        client.chat('anthropic-model', {
          rawMessages: [{ role: 'user', content: 'hi' }],
          max_tokens: 16,
        }),
      aborted,
    );
  });

  it('generateVideo 活过 30s, 死在 CHAT_REQUEST_TIMEOUT_MS', async () => {
    const { client, aborted } = hangingClient({ id: 'video-model' });
    await expectBudgetIsChatTimeout(
      () => client.generateVideo('video-model', { prompt: 'a cat' }),
      aborted,
    );
  });
});

// ============================================================================
// 结构闸门 — default-deny
// ============================================================================

/**
 * 允许沿用 doJSONFullRaw 30s 默认值的方法。**只收控制面端点** (列目录 / 查状态 /
 * 读配置), 即"不经过模型推理或生成、响应时间由网关自己决定"的那一类。
 *
 * 往这里加名字 = 声明该端点不会因上游推理而慢。加错了不会当场报错, 会在某个用户
 * 那里表现为确定性的 30s 失败 —— 所以加之前请先回答: 这个端点会不会等上游模型?
 */
const CONTROL_PLANE_METHODS_ALLOWED_TO_USE_DEFAULT_TIMEOUT = new Set([
  // 视频任务状态轮询: 只读网关自己的任务表, 不触发推理。
  'pollVideoTask',
]);

/** 提取 `this.doJSONFullRaw(` 调用的完整实参文本 (括号配平)。 */
function extractCallArgs(src: string, openParenIdx: number): string {
  let depth = 0;
  for (let i = openParenIdx; i < src.length; i++) {
    const ch = src[i];
    if (ch === '(') depth++;
    else if (ch === ')') {
      depth--;
      if (depth === 0) return src.slice(openParenIdx + 1, i);
    }
  }
  throw new Error('unbalanced parentheses after doJSONFullRaw(');
}

describe('doJSONFullRaw 调用点结构闸门', () => {
  // 本仓工作树是 CRLF。行内偏移量按 `line.length + 1` 累加, 只有先归一成 LF 才对得上,
  // 否则每过一行就漂 1 字节, 后半个文件的调用点会被截错实参 (首版就这么假红过)。
  const source = readFileSync(
    fileURLToPath(new URL('../src/core/client.ts', import.meta.url)),
    'utf8',
  ).replace(/\r\n/g, '\n');

  /** 逐行扫描, 记住最近一次方法声明, 作为每个调用点的归属。 */
  const callSites: { method: string; args: string }[] = [];
  {
    const methodDecl =
      /^ {2}(?:private |public |protected )?(?:async )?([A-Za-z_][A-Za-z0-9_]*)\s*[(<]/;
    const lines = source.split('\n');
    let offset = 0;
    let current = '<module>';
    for (const line of lines) {
      const m = methodDecl.exec(line);
      if (m) current = m[1]!;
      const callIdx = line.indexOf('this.doJSONFullRaw(');
      if (callIdx !== -1) {
        const open = offset + callIdx + 'this.doJSONFullRaw'.length;
        callSites.push({ method: current, args: extractCallArgs(source, open) });
      }
      offset += line.length + 1;
    }
  }

  it('扫描到了调用点 (判据自身不能悄悄变成零覆盖)', () => {
    expect(callSites.length).toBeGreaterThanOrEqual(8);
  });

  it('每个调用点要么显式传预算, 要么在控制面 allowlist 里', () => {
    const offenders = callSites
      .filter(c => !c.args.includes('CHAT_REQUEST_TIMEOUT_MS'))
      .map(c => c.method)
      .filter(
        m => !CONTROL_PLANE_METHODS_ALLOWED_TO_USE_DEFAULT_TIMEOUT.has(m),
      );
    expect(
      offenders,
      `这些方法用了 doJSONFullRaw 的 30s 默认值。若它们会等上游模型, 请显式传 ` +
        `CHAT_REQUEST_TIMEOUT_MS; 若确属控制面, 请加进 ` +
        `CONTROL_PLANE_METHODS_ALLOWED_TO_USE_DEFAULT_TIMEOUT 并写明理由。`,
    ).toEqual([]);
  });

  // 负向对照 —— 上面那条"无违规者"如果因为扫描器坏掉而恒绿, 是查不出来的
  // (实参截错 → 恒含/恒不含 → 断言失去意义)。这条要求"没传预算的集合"与 allowlist
  // **逐条相等**: 扫描器把谁都判成"传了"会红, 判成"都没传"也会红, allowlist 里
  // 残留一个改过名的方法同样会红。
  it('负向对照: 未传预算的调用点恰好等于 allowlist', () => {
    const withoutBudget = callSites
      .filter(c => !c.args.includes('CHAT_REQUEST_TIMEOUT_MS'))
      .map(c => c.method)
      .sort();
    expect(withoutBudget).toEqual(
      [...CONTROL_PLANE_METHODS_ALLOWED_TO_USE_DEFAULT_TIMEOUT].sort(),
    );
  });
});
