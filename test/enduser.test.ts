// enduser.test.ts — v1.6.0 endUserId 注入 + SSE 注释行 + 校验 helper

import { describe, it, expect } from 'vitest';
import { AnthropicAdapter, OpenAIAdapter } from '../src/models/adapters/index';
import type { ChatRequest, ModelCapabilities } from '../src/models/types';
import {
  validateEndUserId,
  isSSECommentLine,
  maxEndUserIdLength,
} from '../src/models/enduser';

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

describe('validateEndUserId', () => {
  it.each([
    ['', null],
    ['user_123-abc', null],
    ['ABC', null],
    ['a'.repeat(maxEndUserIdLength), null],
  ])('合法: %s', (input, expected) => {
    expect(validateEndUserId(input)).toBe(expected);
  });

  it.each([
    ['a'.repeat(maxEndUserIdLength + 1), /length/],
    ['u:1', /invalid char/],
    ['u.1', /invalid char/],
    ['u/1', /invalid char/],
    ['u 1', /invalid char/],
    ['用户', /invalid char/],
  ])('拒绝: %s', (input, pattern) => {
    const err = validateEndUserId(input);
    expect(err).not.toBeNull();
    expect(err!).toMatch(pattern);
  });
});

describe('isSSECommentLine', () => {
  it('识别 ": keep-alive" / ":" / ":ping"', () => {
    expect(isSSECommentLine(': keep-alive')).toBe(true);
    expect(isSSECommentLine(':')).toBe(true);
    expect(isSSECommentLine(':ping')).toBe(true);
  });
  it('不识别 data: / event: / 空行', () => {
    expect(isSSECommentLine('data: hi')).toBe(false);
    expect(isSSECommentLine('event: foo')).toBe(false);
    expect(isSSECommentLine('')).toBe(false);
  });
});

describe('OpenAIAdapter.buildRequestBody — endUserId 顶层注入', () => {
  const a = new OpenAIAdapter();

  it('endUserId 写入顶层 body[user_id]', () => {
    const req: ChatRequest = {
      messages: [{ role: 'user', content: 'hi' }],
      endUserId: 'user-abc-123',
    };
    const body = a.buildRequestBody(baseCaps, req);
    expect(body['user_id']).toBe('user-abc-123');
  });

  it('endUserId 优先于 extraBody[user_id]', () => {
    const req: ChatRequest = {
      messages: [{ role: 'user', content: 'hi' }],
      endUserId: 'winner',
      extraBody: { user_id: 'loser' },
    };
    const body = a.buildRequestBody(baseCaps, req);
    expect(body['user_id']).toBe('winner');
  });

  it('endUserId 为空 → 不注入 user_id 字段', () => {
    const req: ChatRequest = { messages: [{ role: 'user', content: 'hi' }] };
    const body = a.buildRequestBody(baseCaps, req);
    expect(body['user_id']).toBeUndefined();
  });
});

describe('AnthropicAdapter.buildRequestBody — endUserId 合并到 metadata', () => {
  const a = new AnthropicAdapter();

  it('endUserId → metadata.user_id 嵌套', () => {
    const req: ChatRequest = {
      messages: [{ role: 'user', content: 'hi' }],
      endUserId: 'user-xyz',
    };
    const body = a.buildRequestBody(baseCaps, req);
    expect(body['metadata']).toBeDefined();
    const meta = body['metadata'] as Record<string, unknown>;
    expect(meta['user_id']).toBe('user-xyz');
  });

  it('caller metadata[user_id] 优先于 endUserId', () => {
    const req: ChatRequest = {
      messages: [{ role: 'user', content: 'hi' }],
      endUserId: 'from-end-user-id',
      metadata: { user_id: 'from-metadata' },
    };
    const body = a.buildRequestBody(baseCaps, req);
    const meta = body['metadata'] as Record<string, unknown>;
    expect(meta['user_id']).toBe('from-metadata');
  });

  it('保留 caller metadata 其他键', () => {
    const req: ChatRequest = {
      messages: [{ role: 'user', content: 'hi' }],
      endUserId: 'uid-1',
      metadata: { trace_id: 't-42' },
    };
    const body = a.buildRequestBody(baseCaps, req);
    const meta = body['metadata'] as Record<string, unknown>;
    expect(meta['trace_id']).toBe('t-42');
    expect(meta['user_id']).toBe('uid-1');
  });

  it('endUserId 为空 + metadata 也为空 → 不注入 metadata 字段', () => {
    const req: ChatRequest = { messages: [{ role: 'user', content: 'hi' }] };
    const body = a.buildRequestBody(baseCaps, req);
    expect(body['metadata']).toBeUndefined();
  });
});
