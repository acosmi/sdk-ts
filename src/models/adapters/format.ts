// adapters/format.ts — 适配器共用声明 (叶子模块)
//
// ProviderFormat / ProviderAdapter 是 AnthropicAdapter 与 OpenAIAdapter 的共同依赖。
// 本文件只允许 import 类型, 不得 import 任何适配器实现, 也不得 import ./index:
// ./index 在模块顶层实例化两个适配器, 适配器实现若从 ./index 取声明, 以包的
// 子路径入口 (adapters/openai、adapters/anthropic) 先加载实现时, 求值顺序会变成
// 实现 → ./index → 顶层 new → 类尚未定义, import 即抛错。

import type { ChatRequest, ChatResponse, StreamEvent, ModelCapabilities } from '../types';

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
