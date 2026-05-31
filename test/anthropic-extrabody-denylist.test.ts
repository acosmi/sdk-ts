// anthropic-extrabody-denylist.test.ts — D-3 (P3-3)
//
// extraBody 不得覆盖 SDK 管理字段 (thinking / effort / max_tokens / temperature / betas),
// 同时仍可透传非管理字段。

import { describe, it, expect, vi, afterEach } from 'vitest';
import { AnthropicAdapter } from '../src/models/adapters/index';
import type { ChatRequest, ModelCapabilities } from '../src/models/types';
import { ThinkingHigh } from '../src/models/types';

const baseCaps: ModelCapabilities = {
  supports_thinking: false,
  supports_adaptive_thinking: false,
  supports_isp: false,
  supports_web_search: false,
  supports_tool_search: false,
  supports_structured_output: false,
  supports_effort: false,
  supports_max_effort: false,
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

describe('AnthropicAdapter extraBody denylist (D-3)', () => {
  const adapter = new AnthropicAdapter();

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('extraBody 不能覆盖 SDK 管理的 thinking / max_tokens / effort, 但能透传自定义键', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const caps = { ...baseCaps, supports_adaptive_thinking: true, supports_effort: true };

    // Level=high → SDK 计算 thinking=adaptive, effort=high, max_tokens≥32K
    const req: ChatRequest = {
      messages: [],
      thinking: { type: 'adaptive', level: ThinkingHigh },
      extraBody: {
        // 这些都是 SDK 管理字段 — 必须被忽略
        thinking: { type: 'disabled' },
        max_tokens: 1,
        effort: { level: 'low' },
        // 非管理字段 — 必须透传
        custom_flag: 'kept',
      },
    };

    const body = adapter.buildRequestBody(caps, req);

    // 管理字段保持 SDK 计算值, 未被 extraBody 覆盖
    expect(body['thinking']).toEqual({ type: 'adaptive' });
    expect(body['effort']).toEqual({ level: 'high' });
    expect(body['max_tokens'] as number).toBeGreaterThanOrEqual(32_000);
    expect(body['max_tokens']).not.toBe(1);

    // 自定义键正常透传
    expect(body['custom_flag']).toBe('kept');

    // 被忽略的 key 应有告警
    expect(warn).toHaveBeenCalled();
    const warned = warn.mock.calls.map((c) => String(c[0])).join('\n');
    expect(warned).toContain('thinking');
    expect(warned).toContain('max_tokens');
    expect(warned).toContain('effort');
  });

  it('extraBody 不能覆盖 temperature 与 betas', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    // supports_prompt_cache → SDK 自动组装一个 beta (prompt-caching-scope), 故 body.betas 非空。
    const caps = { ...baseCaps, supports_prompt_cache: true };

    const req: ChatRequest = {
      messages: [],
      temperature: 0.2, // SDK 写入的 temperature
      extraBody: {
        temperature: 0.99,
        betas: ['attacker-injected-beta'],
        another_custom: 42,
      },
    };

    const body = adapter.buildRequestBody(caps, req);

    // temperature 保持 SDK 写入值 (未被 0.99 覆盖)
    expect(body['temperature']).toBe(0.2);
    // SDK 计算的 betas 仍在, 且未被 extraBody 注入的值覆盖
    expect(Array.isArray(body['betas'])).toBe(true);
    expect(body['betas']).not.toContain('attacker-injected-beta');
    // 非管理键透传
    expect(body['another_custom']).toBe(42);
  });

  it('无管理字段冲突时 extraBody 完全透传 (正当用途保留)', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const req: ChatRequest = {
      messages: [],
      max_tokens: 256,
      extraBody: { foo: 'bar', nested: { a: 1 } },
    };
    const body = adapter.buildRequestBody(baseCaps, req);
    expect(body['foo']).toBe('bar');
    expect(body['nested']).toEqual({ a: 1 });
    expect(body['max_tokens']).toBe(256);
  });
});
