import { describe, it, expect } from 'vitest';
import { OpenAIAdapter, AnthropicAdapter } from '../src/models/adapters/index';
import type { ModelCapabilities, ChatRequest } from '../src/models/types';

describe('model-advertised reasoning levels', () => {
  it.each(['low', 'medium', 'high', 'xhigh', 'max'])('preserves %s across both protocols', level => {
    const caps = { supports_thinking: true, supports_effort: true, supports_max_effort: true } as ModelCapabilities;
    const req = { thinking: { level }, max_tokens: 1024 } as ChatRequest;
    expect(new OpenAIAdapter().buildRequestBody(caps, req).reasoning_effort).toBe(level);
    expect(new AnthropicAdapter().buildRequestBody(caps, req).effort).toEqual({ level });
  });
});
