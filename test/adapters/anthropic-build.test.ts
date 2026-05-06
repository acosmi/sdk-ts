// 端口自 acosmi-sdk-go/adapter_anthropic.go 行为 — buildRequestBody 关键 case
// (Go 测试在 adapter_openai_test.go / thinking_test.go 等; TS 这里抽核心)

import { describe, it, expect } from 'vitest';
import { AnthropicAdapter, OpenAIAdapter } from '../../src/adapters/index';
import type { ChatRequest, ModelCapabilities } from '../../src/types';
import { ThinkingMax, ThinkingHigh, ThinkingOff } from '../../src/types';

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

describe('AnthropicAdapter.buildRequestBody', () => {
  const adapter = new AnthropicAdapter();

  it('基础: messages 透传 + stream 默认 false', () => {
    const req: ChatRequest = {
      messages: [{ role: 'user', content: 'hi' }],
      max_tokens: 1024,
    };
    const body = adapter.buildRequestBody(baseCaps, req);
    expect(body['messages']).toEqual(req.messages);
    expect(body['stream']).toBe(false);
    expect(body['max_tokens']).toBe(1024);
  });

  it('Thinking off → thinking={type:"disabled"}, 无 effort', () => {
    const req: ChatRequest = {
      messages: [],
      thinking: { type: 'adaptive', level: ThinkingOff },
    };
    const body = adapter.buildRequestBody(baseCaps, req);
    expect(body['thinking']).toEqual({ type: 'disabled' });
    expect(body['effort']).toBeUndefined();
  });

  it('Thinking high + supports_adaptive_thinking → adaptive + effort=high + max_tokens 至少 32K', () => {
    const caps = {
      ...baseCaps,
      supports_adaptive_thinking: true,
      supports_effort: true,
    };
    const req: ChatRequest = {
      messages: [],
      thinking: { type: 'adaptive', level: ThinkingHigh },
    };
    const body = adapter.buildRequestBody(caps, req);
    expect(body['thinking']).toEqual({ type: 'adaptive' });
    expect(body['effort']).toEqual({ level: 'high' });
    expect(body['max_tokens']).toBeGreaterThanOrEqual(32_000);
  });

  it('Thinking max + supports_max_effort → effort=max', () => {
    const caps = {
      ...baseCaps,
      supports_adaptive_thinking: true,
      supports_effort: true,
      supports_max_effort: true,
      max_output_tokens: 64_000,
    };
    const req: ChatRequest = {
      messages: [],
      thinking: { type: 'adaptive', level: ThinkingMax },
    };
    const body = adapter.buildRequestBody(caps, req);
    expect(body['effort']).toEqual({ level: 'max' });
    expect(body['max_tokens']).toBe(64_000);
  });

  it('Thinking max 但模型 !supports_max_effort → effort 降到 high', () => {
    const caps = {
      ...baseCaps,
      supports_adaptive_thinking: true,
      supports_effort: true,
      supports_max_effort: false,
    };
    const req: ChatRequest = {
      messages: [],
      thinking: { type: 'adaptive', level: ThinkingMax },
    };
    const body = adapter.buildRequestBody(caps, req);
    expect(body['effort']).toEqual({ level: 'high' });
  });

  it('Thinking + temperature 互斥 (Level 模式下 temperature 被删除)', () => {
    const caps = { ...baseCaps, supports_adaptive_thinking: true, supports_effort: true };
    const req: ChatRequest = {
      messages: [],
      thinking: { type: 'adaptive', level: ThinkingHigh },
      temperature: 0.5,
    };
    const body = adapter.buildRequestBody(caps, req);
    expect(body['temperature']).toBeUndefined();
  });

  it('rawMessages 优先于 messages', () => {
    const req: ChatRequest = {
      messages: [{ role: 'user', content: 'plain' }],
      rawMessages: [{ role: 'user', content: [{ type: 'text', text: 'rich' }] }],
    };
    const body = adapter.buildRequestBody(baseCaps, req);
    expect(body['messages']).toEqual(req.rawMessages);
  });

  it('serverTools 合入 tools 数组', () => {
    const req: ChatRequest = {
      messages: [],
      serverTools: [{ type: 'web_search_20250305', name: 'web_search', config: { max_uses: 5 } }],
    };
    const body = adapter.buildRequestBody(baseCaps, req);
    expect(Array.isArray(body['tools'])).toBe(true);
    expect((body['tools'] as Array<Record<string, unknown>>)[0]).toMatchObject({
      type: 'web_search_20250305',
      name: 'web_search',
      max_uses: 5,
    });
  });
});

describe('OpenAIAdapter.buildRequestBody', () => {
  const adapter = new OpenAIAdapter();

  it('不注入 betas', () => {
    const caps = { ...baseCaps, supports_isp: true };
    const req: ChatRequest = {
      messages: [{ role: 'user', content: 'hi' }],
    };
    const body = adapter.buildRequestBody(caps, req);
    expect(body['betas']).toBeUndefined();
  });

  it('Thinking high → reasoning_effort=high', () => {
    const req: ChatRequest = {
      messages: [],
      thinking: { type: 'adaptive', level: ThinkingHigh },
    };
    const body = adapter.buildRequestBody(baseCaps, req);
    expect(body['reasoning_effort']).toBe('high');
  });

  it('Thinking max → reasoning_effort=high (OpenAI 无 max 级别)', () => {
    const req: ChatRequest = {
      messages: [],
      thinking: { type: 'adaptive', level: ThinkingMax },
    };
    const body = adapter.buildRequestBody(baseCaps, req);
    expect(body['reasoning_effort']).toBe('high');
  });

  it('outputConfig json_schema → response_format', () => {
    const req: ChatRequest = {
      messages: [],
      outputConfig: { format: 'json_schema', schema: { type: 'object' } },
    };
    const body = adapter.buildRequestBody(baseCaps, req);
    expect(body['response_format']).toMatchObject({
      type: 'json_schema',
      json_schema: { strict: true },
    });
  });

  it('parallelToolCalls 透传', () => {
    const req: ChatRequest = { messages: [], parallelToolCalls: false };
    const body = adapter.buildRequestBody(baseCaps, req);
    expect(body['parallel_tool_calls']).toBe(false);
  });

  it('stream=true 时注入 stream_options.include_usage', () => {
    const req: ChatRequest = { messages: [], stream: true };
    const body = adapter.buildRequestBody(baseCaps, req);
    expect(body['stream_options']).toEqual({ include_usage: true });
  });
});
