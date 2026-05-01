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

import type { ManagedModel, ChatRequest, ChatResponse, StreamEvent, ModelCapabilities } from '../types';

/** 标识请求格式 */
export enum ProviderFormat {
  /** Anthropic 原生格式 */
  Anthropic = 0,
  /** OpenAI 兼容格式 */
  OpenAI = 1,
}

/** 将 ChatRequest 转换为特定格式的 adapter 接口 */
export interface ProviderAdapter {
  /** 此 adapter 使用的请求格式 */
  format(): ProviderFormat;

  /**
   * API 路径后缀
   * Anthropic: "/anthropic", OpenAI: "/chat"
   */
  endpointSuffix(): string;

  /**
   * 将 ChatRequest 转换为 HTTP body (object → JSON.stringify)
   * caps 用于条件化字段注入 (如 betas)
   */
  buildRequestBody(caps: ModelCapabilities, req: ChatRequest): Record<string, unknown>;

  /** 解析同步响应 body 为 ChatResponse */
  parseResponse(body: Uint8Array | string): ChatResponse;

  /**
   * 解析一行 SSE data 为 StreamEvent
   * 返回 { event, done }; done=true 表示流结束 ([DONE] 或 message_stop)
   */
  parseStreamLine(eventType: string, data: string): { event: StreamEvent; done: boolean };
}

// 实现 import 在文件末尾, 避免循环依赖（adapter impl 也需引用 ProviderFormat）
import { AnthropicAdapter } from './anthropic';
import { OpenAIAdapter } from './openai';

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
 *  1. preferred_format 非空 → 按其值返回 (anthropic | openai)
 *  2. supported_formats 含 "anthropic" → AnthropicAdapter
 *  3. supported_formats 含 "openai" → OpenAIAdapter
 *  4. 两字段均空 (旧上游) → 回落 provider 名硬编码 (原 getAdapter 行为)
 *
 * 这使得 dashscope / zhipu / deepseek 等 provider 的模型如果上游启用了
 * Anthropic 兼容端点, 也能走 /anthropic 路径, 不再被 provider 字符串硬编码到 /chat
 * 导致 tool_reference 400.
 */
export function getAdapterForModel(m: ManagedModel): ProviderAdapter {
  const pref = (m.preferred_format ?? '').trim().toLowerCase();
  switch (pref) {
    case 'anthropic':
      return new AnthropicAdapter();
    case 'openai':
      return new OpenAIAdapter();
  }

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
  if (hasAnthropic) return new AnthropicAdapter();
  if (hasOpenAI) return new OpenAIAdapter();

  // 旧上游未填字段: 回落到 provider 名硬编码 (向后兼容)
  return getAdapter((m.provider ?? '').toLowerCase());
}

export { AnthropicAdapter, OpenAIAdapter };
