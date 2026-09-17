// adapters/index.ts — 端口自 acosmi-sdk-go/adapter.go (v0.19.0)
//
// SDK 层按上游托管模型元数据选路:
//   preferred_format == "anthropic" → AnthropicAdapter → POST /managed-models/:id/anthropic
//   preferred_format == "openai"    → OpenAIAdapter    → POST /managed-models/:id/chat
//
// 旧上游若未返回 preferred_format / supported_formats, SDK 才回落到 provider 名称:
//   provider == "anthropic" / "acosmi" → AnthropicAdapter
//   其他 provider                       → OpenAIAdapter
//
// SDK 只负责: 格式路由 + 请求结构转换 + 响应结构转换
// 厂商特定协议差异 (endpoint/auth/region/字段裁剪) 由 Nexus Gateway Profile 处理
//
// ============================================================================
// 红线 (双产品消费): AnthropicAdapter + OpenAIAdapter 等地位, 不可合并/降级
// ============================================================================

import type { ManagedModel } from '../types';
// ProviderFormat / ProviderAdapter 定义在叶子模块 ./format; 适配器实现只从那里取,
// 不回引本文件 (本文件顶层实例化适配器, 回引会让子路径入口在类定义前执行 new)。
import type { ProviderAdapter } from './format';
import { AnthropicAdapter } from './anthropic';
import { OpenAIAdapter } from './openai';

export { ProviderFormat, type ProviderAdapter } from './format';

/** 按 provider 名称映射 adapter */
const adapterRegistry: Record<string, ProviderAdapter> = {
  anthropic: new AnthropicAdapter(),
  /** Acosmi 自有模型走 Anthropic 格式 */
  acosmi: new AnthropicAdapter(),
};

/** 非 Anthropic 厂商的默认 adapter */
const defaultOpenAIAdapter: ProviderAdapter = new OpenAIAdapter();

/**
 * 根据 provider 返回对应的 adapter (v0.5.0 遗留 API, 向后兼容)
 * 新代码应使用 getAdapterForModel
 */
export function getAdapter(provider: string): ProviderAdapter {
  const a = adapterRegistry[provider.toLowerCase()];
  if (a) return a;
  return defaultOpenAIAdapter;
}

/**
 * 按 ManagedModel 的 preferred_format / supported_formats 选择 adapter
 *
 * 决策顺序:
 *  1. preferred_format 非空 **且** 该格式在 supported_formats 内 (或 supported_formats 未声明)
 *     → 按其值返回 (anthropic | openai)
 *  2. supported_formats 含 "anthropic" → AnthropicAdapter
 *  3. supported_formats 含 "openai" → OpenAIAdapter
 *  4. 两字段均空 (旧上游) → 回落 provider 名硬编码 (原 getAdapter 行为)
 *
 * 这使得 dashscope / zhipu / deepseek 等 provider 的模型如果上游启用了
 * Anthropic 兼容端点, 也能走 /anthropic 路径, 不再被 provider 字符串硬编码到 /chat
 * 导致 tool_reference 400.
 *
 * [格式一致性护栏 2026-05-29] preferred_format 仅在确被 supported_formats 收录时才采信:
 * 防止上游元数据漂移 (preferred_format=anthropic 但 supported_formats=[openai]) 把 SDK
 * 路由到模型并不支持的格式端点 (撞 /anthropic "未绑定 Anthropic" 4xx)。这是网关侧
 * "同 model_id 双 profile 选行" 根因修复在 SDK 侧的同构护栏。
 */
export function getAdapterForModel(m: ManagedModel): ProviderAdapter {
  let hasAnthropic = false;
  let hasOpenAI = false;
  for (const f of m.supported_formats ?? []) {
    switch (f.trim().toLowerCase()) {
      case 'anthropic':
        hasAnthropic = true;
        break;
      case 'openai':
        hasOpenAI = true;
        break;
    }
  }
  const declared = hasAnthropic || hasOpenAI;

  const pref = (m.preferred_format ?? '').trim().toLowerCase();
  switch (pref) {
    case 'anthropic':
      if (!declared || hasAnthropic) return new AnthropicAdapter();
      break;
    case 'openai':
      if (!declared || hasOpenAI) return new OpenAIAdapter();
      break;
  }

  if (hasAnthropic) return new AnthropicAdapter();
  if (hasOpenAI) return new OpenAIAdapter();

  // 旧上游未填字段: 回落到 provider 名硬编码 (向后兼容)
  return getAdapter((m.provider ?? '').toLowerCase());
}

export { AnthropicAdapter, OpenAIAdapter };
export { OpenAIStreamConverter, newOpenAIStreamConverter } from './openai';
