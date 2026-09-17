// 子路径入口加载顺序回归
//
// package.json exports 公开了 ./adapters/openai 与 ./adapters/anthropic 两个子路径。
// 以它们为模块图里第一个加载的模块时, 适配器实现若经 ./index 取共用声明,
// ./index 顶层的 new AnthropicAdapter() / new OpenAIAdapter() 会在类定义之前执行,
// import 即抛错 (2.19.3 已发布产物同形; 根入口先加载 ./index, 不受影响)。
//
// 每个用例先 vi.resetModules() 清空模块注册表, 再动态 import 子路径模块,
// 保证它是全新模块图里第一个被求值的适配器模块, 不经根入口或 ./index 预先加载。

import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('adapter subpath entries evaluated as the first module', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('adapters/openai: OpenAIAdapter can be constructed', async () => {
    const mod = await import('../../src/models/adapters/openai');
    const adapter = new mod.OpenAIAdapter();
    const { ProviderFormat } = await import('../../src/models/adapters/format');
    expect(adapter.format()).toBe(ProviderFormat.OpenAI);
    expect(adapter.endpointSuffix()).toBe('/chat');
  });

  it('adapters/anthropic: AnthropicAdapter can be constructed', async () => {
    const mod = await import('../../src/models/adapters/anthropic');
    const adapter = new mod.AnthropicAdapter();
    const { ProviderFormat } = await import('../../src/models/adapters/format');
    expect(adapter.format()).toBe(ProviderFormat.Anthropic);
    expect(adapter.endpointSuffix()).toBe('/anthropic');
  });
});
