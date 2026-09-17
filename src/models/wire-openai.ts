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
  /**
   * [W-QUAD-CHAIN-20260914] 可空。按 `stream_options.include_usage: true` 的帧序, 非尾帧上为
   * null 或整个缺失, 带值的是 `[DONE]` 之前的尾帧 `{"choices":[],"usage":{...}}`;
   * 转换器同样接受 usage 与 finish_reason 同帧的形态。形状见 {@link OpenAIStreamUsage}。
   */
  usage?: OpenAIStreamUsage | null;
}

/**
 * 流式 chunk 上的 usage 对象。与同步响应的 {@link OpenAIUsage} 分开声明: 流式帧上各计数都可能
 * 缺席, 线上还带明细对象; 沿用 OpenAIUsage 等于把「三个计数一定在」的承诺强加给流式帧。
 *
 * SDK 只把 `prompt_tokens` / `completion_tokens` 搬成 `input_tokens` / `output_tokens`,
 * 与同步路径逐字相同。明细字段仅作类型声明: SDK 不映射、不做净额换算 —— usage 的语义归一只在网关。
 */
export interface OpenAIStreamUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  /** 上游输入明细 (如 `cached_tokens`); SDK 不读取 */
  prompt_tokens_details?: { cached_tokens?: number };
  /** 上游输出明细 (如 `reasoning_tokens`); SDK 不读取 */
  completion_tokens_details?: { reasoning_tokens?: number };
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
