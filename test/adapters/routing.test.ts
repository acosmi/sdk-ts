// 端口自 acosmi-sdk-go/adapter_test.go
//
// 双格式红线测试: getAdapterForModel 四级决策一字不差.
// 这是 P0 红线测试 — 双产品消费 SDK 的源头.

import { describe, it, expect } from 'vitest';
import { getAdapterForModel, ProviderFormat } from '../../src/adapters/index';
import type { ManagedModel } from '../../src/types';

const baseModel: Omit<ManagedModel, 'provider' | 'preferred_format' | 'supported_formats'> = {
  id: 'm1',
  name: 'm1',
  modelId: 'm1',
  maxTokens: 4096,
  isEnabled: true,
  capabilities: {
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
  },
};

describe('getAdapterForModel — 四级决策', () => {
  const cases: Array<{ name: string; model: ManagedModel; want: ProviderFormat }> = [
    {
      name: 'preferred anthropic wins over provider hardcode',
      model: { ...baseModel, provider: 'dashscope', preferred_format: 'anthropic' } as ManagedModel,
      want: ProviderFormat.Anthropic,
    },
    {
      name: 'preferred openai wins even for anthropic provider',
      model: { ...baseModel, provider: 'anthropic', preferred_format: 'openai' } as ManagedModel,
      want: ProviderFormat.OpenAI,
    },
    {
      name: 'preferred is case-insensitive',
      model: { ...baseModel, provider: 'dashscope', preferred_format: 'Anthropic' } as ManagedModel,
      want: ProviderFormat.Anthropic,
    },
    {
      name: 'supported list picks anthropic when present',
      model: { ...baseModel, provider: 'dashscope', supported_formats: ['openai', 'anthropic'] } as ManagedModel,
      want: ProviderFormat.Anthropic,
    },
    {
      name: 'supported list with only openai',
      model: { ...baseModel, provider: 'anthropic', supported_formats: ['openai'] } as ManagedModel,
      want: ProviderFormat.OpenAI,
    },
    {
      name: 'fallback to provider hardcode — anthropic',
      model: { ...baseModel, provider: 'anthropic' } as ManagedModel,
      want: ProviderFormat.Anthropic,
    },
    {
      name: 'fallback to provider hardcode — acosmi',
      model: { ...baseModel, provider: 'acosmi' } as ManagedModel,
      want: ProviderFormat.Anthropic,
    },
    {
      name: 'fallback to provider hardcode — dashscope → openai (legacy)',
      model: { ...baseModel, provider: 'dashscope' } as ManagedModel,
      want: ProviderFormat.OpenAI,
    },
  ];

  for (const tc of cases) {
    it(tc.name, () => {
      const got = getAdapterForModel(tc.model).format();
      expect(got).toBe(tc.want);
    });
  }
});

describe('endpoint suffix — 红线: Anthropic vs OpenAI 不能互串', () => {
  it('AnthropicAdapter → /anthropic', () => {
    const m: ManagedModel = { ...baseModel, provider: 'anthropic' } as ManagedModel;
    expect(getAdapterForModel(m).endpointSuffix()).toBe('/anthropic');
  });

  it('OpenAIAdapter → /chat', () => {
    const m: ManagedModel = { ...baseModel, provider: 'dashscope' } as ManagedModel;
    expect(getAdapterForModel(m).endpointSuffix()).toBe('/chat');
  });
});
