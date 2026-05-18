// model-helpers.test.ts — v1.2+ input modality + desktop visual understanding helpers
//
// 红线: 任何 modality 选择必须只看 SDK 字段, 不靠 model 名 substring.

import { describe, expect, it } from 'vitest';
import {
  findDesktopVisualUnderstandingModel,
  findFirstModelByInputModality,
  modelSupportsImageInput,
  modelSupportsInputModality,
  type ManagedModel,
  type ModelCapabilities,
} from '../src/index';

function zeroCaps(): ModelCapabilities {
  return {
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
    supports_desktop_visual_understanding: false,
  };
}

function mkModel(overrides: Partial<ManagedModel> & { id: string }): ManagedModel {
  return {
    name: overrides.id,
    provider: 'dashscope',
    modelId: overrides.id,
    maxTokens: 4096,
    isEnabled: true,
    capabilities: zeroCaps(),
    ...overrides,
  };
}

describe('modelSupportsInputModality', () => {
  it('null/undefined model → false', () => {
    expect(modelSupportsInputModality(null, 'image')).toBe(false);
    expect(modelSupportsInputModality(undefined, 'text')).toBe(false);
  });

  it('missing inputModalities → false (保守判负, 不当 unknown=支持)', () => {
    const m = mkModel({ id: 'm1' });
    expect(modelSupportsInputModality(m, 'image')).toBe(false);
    expect(modelSupportsInputModality(m, 'text')).toBe(false);
  });

  it('inputModalities=["text"] only → text true, image false', () => {
    const m = mkModel({ id: 'm1', inputModalities: ['text'] });
    expect(modelSupportsInputModality(m, 'text')).toBe(true);
    expect(modelSupportsInputModality(m, 'image')).toBe(false);
  });

  it('inputModalities=["text","image"] → both true', () => {
    const m = mkModel({ id: 'm1', inputModalities: ['text', 'image'] });
    expect(modelSupportsInputModality(m, 'text')).toBe(true);
    expect(modelSupportsInputModality(m, 'image')).toBe(true);
  });

  it('inputModalities 非数组 (脏数据) → false', () => {
    const m = mkModel({ id: 'm1' });
    (m as unknown as { inputModalities: unknown }).inputModalities = 'image';
    expect(modelSupportsInputModality(m, 'image')).toBe(false);
  });
});

describe('modelSupportsImageInput', () => {
  it('只认 inputModalities.includes("image"), 不看模型名', () => {
    expect(modelSupportsImageInput(mkModel({ id: 'gpt-4-vision-preview' }))).toBe(false);
    expect(
      modelSupportsImageInput(mkModel({ id: 'plain-text-model', inputModalities: ['image'] })),
    ).toBe(true);
  });
});

describe('findFirstModelByInputModality', () => {
  it('返回首个 enabled 且支持模态的模型 (catalog 顺序)', () => {
    const models = [
      mkModel({ id: 'a', inputModalities: ['text'] }),
      mkModel({ id: 'b', inputModalities: ['text', 'image'] }),
      mkModel({ id: 'c', inputModalities: ['text', 'image'] }),
    ];
    expect(findFirstModelByInputModality(models, 'image')?.id).toBe('b');
  });

  it('跳过 isEnabled === false', () => {
    const models = [
      mkModel({ id: 'a', inputModalities: ['image'], isEnabled: false }),
      mkModel({ id: 'b', inputModalities: ['image'] }),
    ];
    expect(findFirstModelByInputModality(models, 'image')?.id).toBe('b');
  });

  it('全部不匹配 → null', () => {
    expect(findFirstModelByInputModality([], 'image')).toBeNull();
    expect(
      findFirstModelByInputModality([mkModel({ id: 'a', inputModalities: ['text'] })], 'image'),
    ).toBeNull();
  });
});

describe('findDesktopVisualUnderstandingModel', () => {
  it('不返回 disabled 模型', () => {
    const m = mkModel({
      id: 'a',
      isEnabled: false,
      inputModalities: ['image'],
      capabilities: { ...zeroCaps(), supports_desktop_visual_understanding: true },
    });
    expect(findDesktopVisualUnderstandingModel([m])).toBeNull();
  });

  it('不返回缺 image 输入的模型 (capability=true 但 modalities 没 image)', () => {
    const m = mkModel({
      id: 'a',
      inputModalities: ['text'],
      capabilities: { ...zeroCaps(), supports_desktop_visual_understanding: true },
    });
    expect(findDesktopVisualUnderstandingModel([m])).toBeNull();
  });

  it('不返回缺 supports_desktop_visual_understanding 的普通视觉模型', () => {
    // 普通视觉模型 inputModalities 有 image 但运营没标 sidecar → 不应被当 sidecar 选
    const m = mkModel({
      id: 'plain-vision',
      inputModalities: ['text', 'image'],
      capabilities: { ...zeroCaps(), supports_desktop_visual_understanding: false },
    });
    expect(findDesktopVisualUnderstandingModel([m])).toBeNull();
  });

  it('isDefault === true 优先于 catalog 顺序', () => {
    const models = [
      mkModel({
        id: 'first-but-not-default',
        inputModalities: ['image'],
        capabilities: { ...zeroCaps(), supports_desktop_visual_understanding: true },
      }),
      mkModel({
        id: 'second-but-default',
        isDefault: true,
        inputModalities: ['image'],
        capabilities: { ...zeroCaps(), supports_desktop_visual_understanding: true },
      }),
    ];
    expect(findDesktopVisualUnderstandingModel(models)?.id).toBe('second-but-default');
  });

  it('无 isDefault 时退回 catalog 顺序第一个', () => {
    const models = [
      mkModel({
        id: 'a',
        inputModalities: ['image'],
        capabilities: { ...zeroCaps(), supports_desktop_visual_understanding: true },
      }),
      mkModel({
        id: 'b',
        inputModalities: ['image'],
        capabilities: { ...zeroCaps(), supports_desktop_visual_understanding: true },
      }),
    ];
    expect(findDesktopVisualUnderstandingModel(models)?.id).toBe('a');
  });

  it('capability undefined (老网关 payload 未带新字段) 视为 false', () => {
    const m = mkModel({ id: 'a', inputModalities: ['image'] });
    // 模拟老 payload — 删字段
    delete (m.capabilities as Partial<ModelCapabilities>).supports_desktop_visual_understanding;
    expect(findDesktopVisualUnderstandingModel([m])).toBeNull();
  });
});
