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

  // 2.14.0 翻转 (2026-08-02): 本用例此前断言 snake 分支把 ['text','audio','image','video']
  // 裁成 ['text','image'] —— 那是在钉住一个缺陷。模态值域归网关目录所有 (2026-06-20 起
  // 'video' 已是合法值), SDK 端按一份硬编码已知集裁剪, 等于替调用方悄悄删掉目录真值;
  // 而 camel 分支从不裁剪, 两分支语义分裂。线上 wire 恒为 camelCase, 所以这个过滤器
  // 从未真正执行 —— 它只是把错误语义写进了契约。现在两分支一律对称透传。
  it('snake_case 数组原样透传, 包括本版本还不认识的模态标签', async () => {
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
            // 'video' = 网关既定合法值; 'audio' = 本版本尚未认识的标签。
            // 两者都必须原样到达调用方。
            input_modalities: ['text', 'audio', 'image', 'video'],
          },
        ],
      }),
    );

    const models = await client.listModels();
    expect(models[0].inputModalities).toEqual(['text', 'audio', 'image', 'video']);
  });

  it('snake_case 数组里的非字符串元素被剔除 (畸形值, 与模态白名单无关)', async () => {
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
            input_modalities: ['text', 42, null, 'image', { v: 1 }],
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
