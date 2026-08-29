// list-models-thinking-levels.test.ts — v2.18+
// 验证 listModels / listModelsWithStatus 对 ManagedModel.thinking_levels 原样透传:
// 全档 / 子集 / 空数组 / 缺失四态, 且 [] 与 undefined 不可互换。
//
// 档位字面量从真源符号 (ThinkingOff/High/Max) 取, 不手抄字符串 —— 抄件断言在真源改名后
// 仍会绿, 等于零覆盖。

import { describe, expect, it } from 'vitest';
import { Client, ThinkingHigh, ThinkingMax, ThinkingOff } from '../src/index';

const future = new Date(Date.now() + 60_000).toISOString();

function clientWithFetch(fetchImpl: typeof fetch): Client {
  const c = new Client({ serverURL: 'https://nexus.test', fetchImpl });
  c.tokens = {
    access_token: 'token-1',
    refresh_token: 'refresh-1',
    expires_at: future,
    scope: 'ai',
    client_id: 'client-1',
    server_url: 'https://nexus.test',
  };
  return c;
}

function jsonResponse(data: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

const caps = {
  supports_thinking: true,
  supports_adaptive_thinking: false,
  supports_isp: false,
  supports_web_search: false,
  supports_tool_search: false,
  supports_structured_output: false,
  supports_effort: true,
  supports_max_effort: true,
  supports_fast_mode: false,
  supports_auto_mode: false,
  supports_1m_context: false,
  supports_prompt_cache: false,
  supports_cache_editing: false,
  supports_token_efficient: false,
  supports_redact_thinking: false,
  max_input_tokens: 0,
  max_output_tokens: 0,
};

/** 造一行 catalog payload; extra 里放本用例关心的可选字段 */
function modelRow(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'm1',
    name: 'm1',
    provider: 'anthropic',
    modelId: 'm1',
    maxTokens: 4096,
    isEnabled: true,
    capabilities: caps,
    ...extra,
  };
}

function clientReturning(extra: Record<string, unknown>, headers?: Record<string, string>): Client {
  return clientWithFetch(async () =>
    jsonResponse(
      { code: 0, message: 'success', data: [modelRow(extra)] },
      headers,
    ),
  );
}

describe('listModels — thinking_levels 原样透传与三态语义', () => {
  it('全档 [off, high, max] 原样可读', async () => {
    const client = clientReturning({
      thinking_levels: [ThinkingOff, ThinkingHigh, ThinkingMax],
    });

    const models = await client.listModels();
    expect(models).toHaveLength(1);
    expect(models[0].thinking_levels).toEqual([ThinkingOff, ThinkingHigh, ThinkingMax]);
  });

  it('子集 (仅 off/high) 不被补齐成全档', async () => {
    const client = clientReturning({ thinking_levels: [ThinkingOff, ThinkingHigh] });

    const models = await client.listModels();
    // supports_max_effort=true 也不得让 SDK 替网关补出 'max' —— 能力矩阵与
    // 「此刻真能选哪几档」是正交两件事, 后者只由 thinking_levels 回答。
    expect(models[0].thinking_levels).toEqual([ThinkingOff, ThinkingHigh]);
    expect(models[0].thinking_levels).not.toContain(ThinkingMax);
    expect(models[0].capabilities.supports_max_effort).toBe(true);
  });

  it('空数组 = 该模型没有思考档, 保持 [] 不塌成 undefined', async () => {
    const client = clientReturning({ thinking_levels: [] });

    const models = await client.listModels();
    expect(models[0].thinking_levels).toEqual([]);
    expect(models[0].thinking_levels).toBeDefined();
  });

  it('上游缺失 (旧网关) → 保持 undefined, 不默认补 [] 也不推档', async () => {
    const client = clientReturning({});

    const models = await client.listModels();
    expect(models[0].thinking_levels).toBeUndefined();
  });

  it('listModelsWithStatus 同样透传, 且不影响 filter status header', async () => {
    const client = clientReturning(
      { thinking_levels: [ThinkingHigh, ThinkingMax] },
      { 'X-Entitlement-Filter-Status': 'ok' },
    );

    const { models, status } = await client.listModelsWithStatus();
    expect(status).toBe('ok');
    expect(models[0].thinking_levels).toEqual([ThinkingHigh, ThinkingMax]);
  });

  it('与 inputModalities 归一化共存 — 新字段不误伤既有 snake→camel 归一', async () => {
    const client = clientReturning({
      input_modalities: ['text', 'image'],
      thinking_levels: [ThinkingOff, ThinkingHigh, ThinkingMax],
    });

    const models = await client.listModels();
    expect(models[0].inputModalities).toEqual(['text', 'image']);
    expect(models[0].thinking_levels).toEqual([ThinkingOff, ThinkingHigh, ThinkingMax]);
  });
});
