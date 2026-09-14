// models/wire-openai.ts — OpenAI 兼容 wire-format 响应 DTO (非 Anthropic 厂商)。
//
// 端口自 acosmi-sdk-go/types.go (v0.19.0) 的 OpenAI 兼容响应类型 段。
//
// 命名约定：字段名 = Go json tag 字面量 (wire format), 不做 camelCase 重映射。

// =============================================================================
// OpenAI 兼容响应类型 (非 Anthropic 厂商)
// =============================================================================

export interface OpenAIChatResponse {
  id: string;
  /** "chat.completion" */
  object: string;
  model: string;
  choices: OpenAIChatChoice[];
  usage: OpenAIUsage;
}

export interface OpenAIChatChoice {
  index: number;
  message: OpenAIChatMessage;
  /** "stop", "tool_calls", "length" */
  finish_reason: string;
}

export interface OpenAIChatMessage {
  role: string;
  content: string;
  tool_calls?: OpenAIToolCall[];
  /** GLM/DeepSeek thinking */
  reasoning_content?: string;
}

export interface OpenAIToolCall {
  id: string;
  /** "function" */
  type: string;
  function: OpenAIFunctionCall;
}

export interface OpenAIFunctionCall {
  name: string;
  arguments: string;
}

export interface OpenAIUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

/** OpenAI SSE delta 格式 */
export interface OpenAIStreamChunk {
  id: string;
  /** "chat.completion.chunk" */
  object: string;
  /**
   * [W-QUAD-CHAIN-20260914] 可空。类型此前声明为必填, 但线上确实存在没有该字段的 data 帧
   * (网关错误契约帧、部分兼容实现的 usage-only 尾帧) —— 「类型说它一定在、运行时它不在」
   * 正是那句 `chunk.choices.length` TypeError 的来源。消费处必须先判 Array.isArray。
   */
  choices?: OpenAIStreamChoice[];
  usage?: OpenAIUsage;
}

export interface OpenAIStreamChoice {
  index: number;
  delta: OpenAIStreamDelta;
  finish_reason: string | null;
}

export interface OpenAIStreamDelta {
  role?: string;
  content?: string;
  reasoning_content?: string;
  tool_calls?: OpenAIStreamToolCall[];
}

export interface OpenAIStreamToolCall {
  index: number;
  id?: string;
  type?: string;
  function: OpenAIFunctionCall;
}
