// adapters/openai.ts — 端口自 acosmi-sdk-go/adapter_openai.go (535 行)
//
// 用于所有非 Anthropic 厂商 (DeepSeek, DashScope, Zhipu, Moonshot, VolcEngine 等)
// SDK 只做格式转换, 厂商特定参数由 Nexus Gateway per-provider adapter 处理
//
// 关键区别:
//   - 不注入 Anthropic betas
//   - 端点后缀为 /chat (非 /anthropic)
//   - 流式使用 [DONE] 标记结束 (非 message_stop)
//   - 响应为 OpenAI choices 格式

import {
  type AnthropicContentBlock,
  type AnthropicResponse,
  type ChatContentBlock,
  type ChatRequest,
  type ChatResponse,
  type ModelCapabilities,
  type OpenAIChatResponse,
  type OpenAIStreamChunk,
  type StreamEvent,
  BusinessError,
  ThinkingHigh,
  ThinkingMax,
  ThinkingOff,
} from '../types';
import { ProviderFormat, type ProviderAdapter } from './index';

/** 实现 ProviderAdapter, 用于所有非 Anthropic 厂商 */
export class OpenAIAdapter implements ProviderAdapter {
  format(): ProviderFormat {
    return ProviderFormat.OpenAI;
  }

  endpointSuffix(): string {
    return '/chat';
  }

  /**
   * 构建 OpenAI 兼容格式请求体
   * 不注入 Anthropic betas, 扩展字段 (thinking/effort/speed) 以通用 JSON 传递
   */
  buildRequestBody(_caps: ModelCapabilities, req: ChatRequest): Record<string, unknown> {
    const body: Record<string, unknown> = {};

    // ── 消息: 直接透传 (Gateway 负责最终转换) ──
    if (req.rawMessages != null) {
      body['messages'] = req.rawMessages;
    } else if ((req.messages?.length ?? 0) > 0) {
      body['messages'] = req.messages;
    }

    body['stream'] = req.stream === true;
    if (req.max_tokens && req.max_tokens > 0) {
      body['max_tokens'] = req.max_tokens;
    }

    // ── System prompt: 透传给 Gateway ──
    if (req.system != null) {
      body['system'] = req.system;
    }

    // ── Temperature ──
    if (req.temperature != null) {
      body['temperature'] = req.temperature;
    }

    // ── Tools: 透传原始格式, Gateway adapter 负责格式转换 ──
    if (req.tools != null) {
      body['tools'] = req.tools;
    }

    // ── 扩展字段 (v0.13.0: 按 OpenAI wire format 直接翻译) ──

    // Thinking / Effort → reasoning_effort
    // OpenAI 系只有顶层 `reasoning_effort: "low"|"medium"|"high"`, 无 thinking block;
    // 能接收到 reasoning_content (GLM/DeepSeek) 作为响应, 但请求侧只能控制级别。
    const eff = resolveOpenAIReasoningEffort(req);
    if (eff !== '') {
      body['reasoning_effort'] = eff;
    }

    if (req.speed && req.speed !== '') {
      body['speed'] = req.speed;
    }

    // outputConfig → response_format
    // Anthropic 心智模型通过 system prompt + prefill 实现 JSON 模式;
    // OpenAI 有顶层 response_format, SDK 直接翻译。
    const rf = resolveOpenAIResponseFormat(req);
    if (rf) {
      body['response_format'] = rf;
    }

    if (req.metadata) {
      body['metadata'] = req.metadata;
    }

    // parallel_tool_calls 是 OpenAI 原生字段, 无歧义直接写
    if (req.parallelToolCalls != null) {
      body['parallel_tool_calls'] = req.parallelToolCalls;
    }

    // ── 不注入 Anthropic Betas ──
    // OpenAI 格式不使用 anthropic-beta header

    // ── 透传 extraBody ──
    if (req.extraBody) {
      for (const [k, v] of Object.entries(req.extraBody)) {
        body[k] = v;
      }
    }

    // ── 流式选项 ──
    if (req.stream === true) {
      body['stream_options'] = { include_usage: true };
    }

    return body;
  }

  /**
   * 解析 OpenAI 格式同步响应为 ChatResponse
   * 兼容 APIResponse 包装 {"code":0,"data":{...}} 和裸 OpenAI JSON 两种格式
   */
  parseResponse(bodyInput: Uint8Array | string): ChatResponse {
    const bodyStr = typeof bodyInput === 'string' ? bodyInput : new TextDecoder().decode(bodyInput);

    let raw = bodyStr;
    try {
      const wrapper = JSON.parse(bodyStr) as { code?: number; message?: string; data?: unknown };
      if (wrapper.data != null && wrapper.data !== null) {
        if ((wrapper.code ?? 0) !== 0) {
          throw new BusinessError(wrapper.code ?? 0, wrapper.message ?? '');
        }
        raw = JSON.stringify(wrapper.data);
      }
    } catch (e) {
      if (e instanceof BusinessError) throw e;
    }

    let oaiResp: OpenAIChatResponse;
    try {
      oaiResp = JSON.parse(raw) as OpenAIChatResponse;
    } catch (e) {
      throw new Error(`decode openai response: ${e instanceof Error ? e.message : String(e)}`);
    }

    return convertOpenAIToChatResponse(oaiResp);
  }

  /**
   * 解析 OpenAI SSE 行
   * [DONE] 标记流结束
   */
  parseStreamLine(eventType: string, data: string): { event: StreamEvent; done: boolean } {
    if (data === '[DONE]') {
      return { event: { event: '', data: '' }, done: true };
    }

    // 校验 chunk 是合法 JSON (与 Go 侧行为对齐)
    try {
      JSON.parse(data);
    } catch (e) {
      throw new Error(`parse openai stream chunk: ${e instanceof Error ? e.message : String(e)}`);
    }

    return { event: { event: eventType, data }, done: false };
  }
}

/**
 * 把 Anthropic 心智模型的 thinking/effort 翻译成 OpenAI `reasoning_effort` 字段值
 * 返回空串表示不设置
 */
export function resolveOpenAIReasoningEffort(req: ChatRequest): string {
  // effort 优先级最高, 因为它本身就是通用级别语义
  if (req.effort && req.effort.level !== '') {
    switch (req.effort.level) {
      case 'low':
      case 'medium':
      case 'high':
        return req.effort.level;
      case 'max':
        // OpenAI 无 max 级别, 等价最深 = high
        return 'high';
    }
  }
  // thinking.level 次之
  if (req.thinking) {
    switch (req.thinking.level) {
      case ThinkingHigh:
        return 'high';
      case ThinkingMax:
        return 'high';
      case ThinkingOff:
        return '';
    }
  }
  return '';
}

/**
 * 把 outputConfig 翻译成 OpenAI response_format
 * 返回 null 表示不设置
 */
export function resolveOpenAIResponseFormat(req: ChatRequest): Record<string, unknown> | null {
  if (!req.outputConfig) return null;
  switch (req.outputConfig.format) {
    case 'json_schema': {
      // OpenAI schema 形态: {type:"json_schema", json_schema:{schema:{...},strict:true}}
      const js: Record<string, unknown> = {};
      if (req.outputConfig.schema != null) {
        js['schema'] = req.outputConfig.schema;
      }
      js['strict'] = true;
      return {
        type: 'json_schema',
        json_schema: js,
      };
    }
    case 'json_object':
      return { type: 'json_object' };
    case '':
    case undefined:
      return null;
    default:
      // 未知 format, 原样透传, 交 Gateway 处理
      return { type: req.outputConfig.format };
  }
}

/** 将 OpenAI 同步响应转换为 ChatResponse */
function convertOpenAIToChatResponse(oai: OpenAIChatResponse): ChatResponse {
  const resp: ChatResponse = {
    id: oai.id,
    type: 'message',
    model: oai.model,
    role: 'assistant',
    content: [],
    stop_reason: '',
    usage: {
      input_tokens: oai.usage.prompt_tokens,
      output_tokens: oai.usage.completion_tokens,
    },
    tokenRemaining: -1,
    callRemaining: -1,
    modelTokenRemaining: -1,
    modelTokenRemainingETU: -1,
  };

  if (oai.choices.length > 0) {
    const choice = oai.choices[0]!;

    // finish_reason 映射
    switch (choice.finish_reason) {
      case 'stop':
        resp.stop_reason = 'end_turn';
        break;
      case 'tool_calls':
        resp.stop_reason = 'tool_use';
        break;
      case 'length':
        resp.stop_reason = 'max_tokens';
        break;
      default:
        resp.stop_reason = choice.finish_reason;
    }

    // thinking content → thinking block
    if (choice.message.reasoning_content && choice.message.reasoning_content !== '') {
      resp.content.push({
        type: 'thinking',
        thinking: choice.message.reasoning_content,
      } as ChatContentBlock);
    }

    // text content → text block
    if (choice.message.content && choice.message.content !== '') {
      resp.content.push({
        type: 'text',
        text: choice.message.content,
      } as ChatContentBlock);
    }

    // tool_calls → tool_use blocks
    for (const tc of choice.message.tool_calls ?? []) {
      resp.content.push({
        type: 'tool_use',
        id: tc.id,
        name: tc.function.name,
        // Anthropic 协议 input 是 raw JSON value; OpenAI 给的 arguments 是 string,
        // Go 侧用 json.RawMessage(arguments) 直透(原始字节). TS 我们尝试解析:
        input: tryParseJSON(tc.function.arguments),
      } as ChatContentBlock);
    }
  }

  return resp;
}

function tryParseJSON(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}

// ============================================================================
// OpenAI → Anthropic 响应转换 (供 ChatMessages 使用)
// ============================================================================

/**
 * 解析 OpenAI 格式响应并转换为 AnthropicResponse
 * 用于 chatMessagesOpenAI 方法, 使 Hub 层无需感知 provider 差异
 */
export function parseOpenAIResponseToAnthropic(raw: string | Uint8Array): AnthropicResponse {
  const rawStr = typeof raw === 'string' ? raw : new TextDecoder().decode(raw);

  let data = rawStr;
  try {
    const wrapper = JSON.parse(rawStr) as { code?: number; message?: string; data?: unknown };
    if (wrapper.data != null && wrapper.data !== null) {
      if ((wrapper.code ?? 0) !== 0) {
        throw new BusinessError(wrapper.code ?? 0, wrapper.message ?? '');
      }
      data = JSON.stringify(wrapper.data);
    }
  } catch (e) {
    if (e instanceof BusinessError) throw e;
  }

  let oaiResp: OpenAIChatResponse;
  try {
    oaiResp = JSON.parse(data) as OpenAIChatResponse;
  } catch (e) {
    throw new Error(`decode openai response: ${e instanceof Error ? e.message : String(e)}`);
  }

  const resp: AnthropicResponse = {
    id: oaiResp.id,
    type: 'message',
    role: 'assistant',
    content: [],
    model: oaiResp.model,
    stop_reason: '',
    usage: {
      input_tokens: oaiResp.usage.prompt_tokens,
      output_tokens: oaiResp.usage.completion_tokens,
    },
  };

  if (oaiResp.choices.length > 0) {
    const choice = oaiResp.choices[0]!;

    switch (choice.finish_reason) {
      case 'stop':
        resp.stop_reason = 'end_turn';
        break;
      case 'tool_calls':
        resp.stop_reason = 'tool_use';
        break;
      case 'length':
        resp.stop_reason = 'max_tokens';
        break;
      default:
        resp.stop_reason = choice.finish_reason;
    }

    if (choice.message.reasoning_content && choice.message.reasoning_content !== '') {
      resp.content.push({
        type: 'thinking',
        thinking: choice.message.reasoning_content,
      } as AnthropicContentBlock);
    }

    if (choice.message.content && choice.message.content !== '') {
      resp.content.push({
        type: 'text',
        text: choice.message.content,
      } as AnthropicContentBlock);
    }

    for (const tc of choice.message.tool_calls ?? []) {
      resp.content.push({
        type: 'tool_use',
        id: tc.id,
        name: tc.function.name,
        input: tryParseJSON(tc.function.arguments),
      } as AnthropicContentBlock);
    }
  }

  return resp;
}

// ============================================================================
// OpenAI SSE → Anthropic 事件转换器 (供 chatMessagesStreamInternal 使用)
// ============================================================================

/**
 * 将 OpenAI SSE chunks 转换为 Anthropic 兼容的 StreamEvent
 * 有状态: 跨 chunk 追踪 block 索引
 */
export class OpenAIStreamConverter {
  private messageStarted = false;
  private thinkingStarted = false;
  private thinkingStopped = false;
  private textStarted = false;
  /** OpenAI tool_call index → Anthropic block index */
  private toolBlockIndex = new Map<number, number>();
  private blockIndex = 0;

  /**
   * 将一行 OpenAI SSE data 转换为零或多个 Anthropic 格式 StreamEvent
   * 返回 { events, done }
   */
  convert(data: string): { events: StreamEvent[]; done: boolean } {
    if (data === '[DONE]') {
      return { events: [], done: true };
    }

    let chunk: OpenAIStreamChunk;
    try {
      chunk = JSON.parse(data);
    } catch (e) {
      throw new Error(`parse openai stream chunk: ${e instanceof Error ? e.message : String(e)}`);
    }

    const events: StreamEvent[] = [];
    if (chunk.choices.length === 0) {
      return { events, done: false };
    }
    const choice = chunk.choices[0]!;

    // 首个 chunk: 发送 message_start
    if (!this.messageStarted) {
      this.messageStarted = true;
      const msgJSON = JSON.stringify({
        type: 'message_start',
        message: {
          id: chunk.id,
          type: 'message',
          role: 'assistant',
          content: [],
          model: '',
        },
      });
      events.push({ event: 'message_start', data: msgJSON });
    }

    // thinking delta (reasoning_content)
    if (choice.delta.reasoning_content && choice.delta.reasoning_content !== '') {
      if (!this.thinkingStarted) {
        this.thinkingStarted = true;
        const blockJSON = JSON.stringify({
          type: 'content_block_start',
          index: this.blockIndex,
          content_block: { type: 'thinking', thinking: '' },
        });
        events.push({ event: 'content_block_start', data: blockJSON });
      }
      const deltaJSON = JSON.stringify({
        type: 'content_block_delta',
        index: this.blockIndex,
        delta: { type: 'thinking_delta', thinking: choice.delta.reasoning_content },
      });
      events.push({ event: 'content_block_delta', data: deltaJSON });
    }

    // text delta (content)
    if (choice.delta.content && choice.delta.content !== '') {
      // 关闭 thinking block (如果有)
      if (this.thinkingStarted && !this.thinkingStopped) {
        this.thinkingStopped = true;
        const stopJSON = JSON.stringify({
          type: 'content_block_stop',
          index: this.blockIndex,
        });
        events.push({ event: 'content_block_stop', data: stopJSON });
        this.blockIndex++;
      }
      if (!this.textStarted) {
        this.textStarted = true;
        const blockJSON = JSON.stringify({
          type: 'content_block_start',
          index: this.blockIndex,
          content_block: { type: 'text', text: '' },
        });
        events.push({ event: 'content_block_start', data: blockJSON });
      }
      const deltaJSON = JSON.stringify({
        type: 'content_block_delta',
        index: this.blockIndex,
        delta: { type: 'text_delta', text: choice.delta.content },
      });
      events.push({ event: 'content_block_delta', data: deltaJSON });
    }

    // tool_calls delta
    for (const tc of choice.delta.tool_calls ?? []) {
      if (!this.toolBlockIndex.has(tc.index)) {
        // 关闭 text block (如果有)
        if (this.textStarted) {
          const stopJSON = JSON.stringify({
            type: 'content_block_stop',
            index: this.blockIndex,
          });
          events.push({ event: 'content_block_stop', data: stopJSON });
          this.blockIndex++;
          this.textStarted = false;
        }
        this.toolBlockIndex.set(tc.index, this.blockIndex);
        const blockJSON = JSON.stringify({
          type: 'content_block_start',
          index: this.blockIndex,
          content_block: {
            type: 'tool_use',
            id: tc.id,
            name: tc.function.name,
            input: {},
          },
        });
        events.push({ event: 'content_block_start', data: blockJSON });
        this.blockIndex++; // 递增, 为下一个 tool_call block 预留索引
      }
      if (tc.function.arguments && tc.function.arguments !== '') {
        const idx = this.toolBlockIndex.get(tc.index)!;
        const deltaJSON = JSON.stringify({
          type: 'content_block_delta',
          index: idx,
          delta: {
            type: 'input_json_delta',
            partial_json: tc.function.arguments,
          },
        });
        events.push({ event: 'content_block_delta', data: deltaJSON });
      }
    }

    // finish_reason: 关闭所有 block + message_delta + message_stop
    if (choice.finish_reason != null && choice.finish_reason !== '') {
      // 关闭可能仍打开的 block
      if (this.textStarted) {
        const stopJSON = JSON.stringify({
          type: 'content_block_stop',
          index: this.blockIndex,
        });
        events.push({ event: 'content_block_stop', data: stopJSON });
      } else if (this.thinkingStarted && !this.thinkingStopped) {
        const stopJSON = JSON.stringify({
          type: 'content_block_stop',
          index: this.blockIndex,
        });
        events.push({ event: 'content_block_stop', data: stopJSON });
      }
      // 关闭 tool blocks
      for (const idx of this.toolBlockIndex.values()) {
        const stopJSON = JSON.stringify({
          type: 'content_block_stop',
          index: idx,
        });
        events.push({ event: 'content_block_stop', data: stopJSON });
      }

      // stop_reason 映射
      let stopReason = 'end_turn';
      switch (choice.finish_reason) {
        case 'tool_calls':
          stopReason = 'tool_use';
          break;
        case 'length':
          stopReason = 'max_tokens';
          break;
      }

      const deltaJSON = JSON.stringify({
        type: 'message_delta',
        delta: { stop_reason: stopReason },
      });
      events.push({ event: 'message_delta', data: deltaJSON });

      const stopJSON = JSON.stringify({ type: 'message_stop' });
      events.push({ event: 'message_stop', data: stopJSON });
    }

    return { events, done: false };
  }
}

export function newOpenAIStreamConverter(): OpenAIStreamConverter {
  return new OpenAIStreamConverter();
}
