// list-models-input-modalities.test.ts — v1.2+
// 验证 listModels / listModelsWithStatus 在 ManagedModel 上保留并归一化 inputModalities,
// 以及向后兼容老 payload (无 inputModalities) 时不破坏 getModelCapabilities.

import { describe, expect, it } from 'vitest';
import { Client } from '../src/index';

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

// 上游下发的 capability 矩阵 (含 v1.2 新字段)
const capsWithSidecar = {
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
  supports_desktop_visual_understanding: true,
};

// 老 capability 矩阵 (无 v1.2 字段, 模拟老网关)
const capsLegacy = { ...capsWithSidecar };
delete (capsLegacy as Partial<typeof capsLegacy>).supports_desktop_visual_understanding;

describe('listModels — inputModalities 保真与兼容', () => {
  it('保留 camelCase inputModalities 原样', async () => {
    const client = clientWithFetch(async () =>
      jsonResponse({
        code: 0,
        message: 'success',
        data: [
          {
            id: 'm1',
            name: 'm1',
            provider: 'dashscope',
            modelId: 'm1',
            maxTokens: 4096,
            isEnabled: true,
            capabilities: capsWithSidecar,
            inputModalities: ['text', 'image'],
          },
        ],
      }),
    );

    const models = await client.listModels();
    expect(models).toHaveLength(1);
    expect(models[0].inputModalities).toEqual(['text', 'image']);
  });

  it('兼容上游 snake_case input_modalities → camelCase', async () => {
    const client = clientWithFetch(async () =>
      jsonResponse({
        code: 0,
        message: 'success',
        data: [
          {
            id: 'm1',
            name: 'm1',
            provider: 'dashscope',
            modelId: 'm1',
            maxTokens: 4096,
            isEnabled: true,
            capabilities: capsWithSidecar,
            input_modalities: ['text', 'image'],
          },
        ],
      }),
    );

    const models = await client.listModels();
    expect(models[0].inputModalities).toEqual(['text', 'image']);
  });

  it('camelCase 与 snake_case 同时存在 → camelCase 胜', async () => {
    const client = clientWithFetch(async () =>
      jsonResponse({
        code: 0,
        message: 'success',
        data: [
          {
            id: 'm1',
            name: 'm1',
            provider: 'dashscope',
            modelId: 'm1',
            maxTokens: 4096,
            isEnabled: true,
            capabilities: capsWithSidecar,
            inputModalities: ['image'],
            input_modalities: ['text'],
          },
        ],
      }),
    );

    const models = await client.listModels();
    expect(models[0].inputModalities).toEqual(['image']);
  });

  it('snake_case 数组包含非法值 → 过滤后只保留 text|image', async () => {
    const client = clientWithFetch(async () =>
      jsonResponse({
        code: 0,
        message: 'success',
        data: [
          {
            id: 'm1',
            name: 'm1',
            provider: 'dashscope',
            modelId: 'm1',
            maxTokens: 4096,
            isEnabled: true,
            capabilities: capsWithSidecar,
            input_modalities: ['text', 'audio', 'image', 'video'],
          },
        ],
      }),
    );

    const models = await client.listModels();
    expect(models[0].inputModalities).toEqual(['text', 'image']);
  });

  it('上游缺失 inputModalities → 保持 undefined, 不默认补 [text]/[image]', async () => {
    const client = clientWithFetch(async () =>
      jsonResponse({
        code: 0,
        message: 'success',
        data: [
          {
            id: 'm1',
            name: 'm1',
            provider: 'dashscope',
            modelId: 'm1',
            maxTokens: 4096,
            isEnabled: true,
            capabilities: capsWithSidecar,
          },
        ],
      }),
    );

    const models = await client.listModels();
    expect(models[0].inputModalities).toBeUndefined();
  });

  it('listModelsWithStatus 同样归一化 + 暴露 filter status header', async () => {
    const client = clientWithFetch(async () =>
      jsonResponse(
        {
          code: 0,
          message: 'success',
          data: [
            {
              id: 'm1',
              name: 'm1',
              provider: 'dashscope',
              modelId: 'm1',
              maxTokens: 4096,
              isEnabled: true,
              capabilities: capsWithSidecar,
              input_modalities: ['image'],
            },
          ],
        },
        { 'X-Entitlement-Filter-Status': 'ok' },
      ),
    );

    const { models, status } = await client.listModelsWithStatus();
    expect(status).toBe('ok');
    expect(models[0].inputModalities).toEqual(['image']);
  });

  it('老 payload (无 inputModalities + 无 supports_desktop_visual_understanding) — getModelCapabilities 仍可用', async () => {
    const client = clientWithFetch(async () =>
      jsonResponse({
        code: 0,
        message: 'success',
        data: [
          {
            id: 'legacy',
            name: 'legacy',
            provider: 'anthropic',
            modelId: 'legacy',
            maxTokens: 2048,
            isEnabled: true,
            capabilities: capsLegacy,
          },
        ],
      }),
    );

    const caps = await client.getModelCapabilities('legacy');
    // 老 payload 不带 v1.2 字段 → 透传原值 (undefined), 不报错
    expect(caps.max_input_tokens).toBe(0);
    expect(caps.supports_desktop_visual_understanding).toBeUndefined();
  });

  it('getModelCapabilities miss → zeroModelCapabilities 含 supports_desktop_visual_understanding=false', async () => {
    const client = clientWithFetch(async () =>
      jsonResponse({ code: 0, message: 'success', data: [] }),
    );

    const caps = await client.getModelCapabilities('not-exist');
    expect(caps.supports_desktop_visual_understanding).toBe(false);
  });
});
