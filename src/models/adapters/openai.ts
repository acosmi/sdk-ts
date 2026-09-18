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

import { type AnthropicContentBlock, type AnthropicResponse } from '../wire-anthropic';
import {
  type OpenAIChatResponse,
  type OpenAIStreamChunk,
  type OpenAIStreamDelta,
} from '../wire-openai';
import {
  type ChatContentBlock,
  type ChatRequest,
  type ChatResponse,
  type ModelCapabilities,
  type StreamEvent,
  ThinkingHigh,
  ThinkingMax,
  ThinkingOff,
} from '../types';
import { BusinessError } from '../../shared/errors';
import { ProviderFormat, type ProviderAdapter } from './format';

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
    const eff = resolveOpenAIReasoningEffort(req, _caps.supports_max_effort);
    if (eff !== '') {
      body['reasoning_effort'] = eff;
    }
    if (_caps.supports_thinking && req.thinking?.level === ThinkingOff) {
      body['thinking'] = { type: 'disabled' };
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

    // ── v1.6.0: endUserId → 顶层 body["user_id"] (OpenAI wire 形态) ──
    // 优先级最高: 在 extraBody 之后写入, 即便 caller 通过 extraBody["user_id"] 自填,
    // 显式 endUserId 仍胜出 (单一真相, 避免双写歧义)。
    // 网关 sanitizer 仍会做最终校验与权限决断, 此处仅负责字段位置正确。
    if (req.endUserId && req.endUserId !== '') {
      body['user_id'] = req.endUserId;
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
export function resolveOpenAIReasoningEffort(req: ChatRequest, supportsMax = false): string {
  // effort 优先级最高, 因为它本身就是通用级别语义
  if (req.effort && req.effort.level !== '') {
    switch (req.effort.level) {
      case 'low':
      case 'medium':
      case 'high':
      case 'xhigh':
        return req.effort.level;
      case 'max':
        // OpenAI 无 max 级别, 等价最深 = high
        return supportsMax ? 'max' : 'high';
    }
  }
  // thinking.level 次之
  if (req.thinking) {
    switch (req.thinking.level) {
      case 'low':
      case 'medium':
      case 'xhigh':
        return req.thinking.level;
      case ThinkingHigh:
        return 'high';
      case ThinkingMax:
        return supportsMax ? 'max' : 'high';
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
    // [W-SDK-OPENAI-PARITY] 缺 usage 的响应按 0 计数, 而不是让 `oai.usage.prompt_tokens`
    // 抛 TypeError 把整条响应打死 —— 上游不计量是常见形态, 正文照样是有效的。
    // 与 Go 侧同名函数逐字同语义 (那里 Usage 是值类型, 缺席即零值)。
    usage: {
      input_tokens: oai.usage?.prompt_tokens ?? 0,
      output_tokens: oai.usage?.completion_tokens ?? 0,
    },
    tokenRemaining: -1,
    callRemaining: -1,
    modelTokenRemaining: -1,
    modelTokenRemainingETU: -1,
  };

  // [W-SDK-OPENAI-PARITY] 缺 choices 的响应按空数组处理, 而不是让 `oai.choices.length`
  // 抛 TypeError —— 那会连 id / model / usage 这些确实到手的字段一起丢掉。判据用
  // Array.isArray 而不是 `?.length`, 与同文件流式路径的 choices 守卫取同一个表达式。
  if (Array.isArray(oai.choices) && oai.choices.length > 0) {
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
    // [W-SDK-OPENAI-PARITY] 同 convertOpenAIToChatResponse: 缺 usage 按 0 计数, 不抛。
    // 两处都要改 —— 只改一处等于「非流式路径修好了一半」, 而两条路径是同一族上游响应。
    usage: {
      input_tokens: oaiResp.usage?.prompt_tokens ?? 0,
      output_tokens: oaiResp.usage?.completion_tokens ?? 0,
    },
  };

  // [W-SDK-OPENAI-PARITY] 同 convertOpenAIToChatResponse: 缺 choices 按空数组处理, 不抛。
  // 两处都要改 —— 只改一处等于「非流式路径修好了一半」, 而两条路径是同一族上游响应。
  if (Array.isArray(oaiResp.choices) && oaiResp.choices.length > 0) {
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

/** 收尾 message_delta 上的 usage。只含与非流式路径相同的两个键; 缺席的键表示上游没给, 不是 0。 */
interface StreamMessageUsage {
  input_tokens?: number;
  output_tokens?: number;
}

/**
 * [W-QUAD-CHAIN-20260914] 读出一帧流式 chunk 上的 usage 对象, 搬成收尾 message_delta 的 usage 形态。
 *
 * 字段映射与同文件非流式路径 (`convertOpenAIToChatResponse` / `parseOpenAIResponseToAnthropic`)
 * 逐字相同: 只搬 `prompt_tokens → input_tokens`、`completion_tokens → output_tokens`。
 * `cached_tokens` / `reasoning_tokens` 等明细刻意不映射, 也不做 `prompt_tokens − cached` 之类的
 * 净额换算 —— usage 的语义归一只住在网关, SDK 只做格式搬运。某个计数缺失或不是有限数时不写对应键。
 *
 * 帧上没有 usage 对象 (缺失 / null / 非对象) 返回 null: 调用方据此区分「这帧没带 usage」与
 * 「带了 usage 但计数都缺席」(后者返回空对象, 仍算见过 usage)。
 */
function readStreamUsage(chunk: OpenAIStreamChunk): StreamMessageUsage | null {
  const raw: unknown = chunk.usage;
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return null;
  }
  const { prompt_tokens: promptTokens, completion_tokens: completionTokens } = raw as {
    prompt_tokens?: unknown;
    completion_tokens?: unknown;
  };
  const usage: StreamMessageUsage = {};
  if (typeof promptTokens === 'number' && Number.isFinite(promptTokens)) {
    usage.input_tokens = promptTokens;
  }
  if (typeof completionTokens === 'number' && Number.isFinite(completionTokens)) {
    usage.output_tokens = completionTokens;
  }
  return usage;
}

/**
 * 将 OpenAI SSE chunks 转换为 Anthropic 兼容的 StreamEvent
 * 有状态: 跨 chunk 追踪 block 索引
 */
export class OpenAIStreamConverter {
  private messageStarted = false;
  private thinkingStarted = false;
  private thinkingStopped = false;
  /** thinking block 打开时占用的 Anthropic block index — 关闭时必须用它, 不能用
   *  可能已被 text/tool 推进的 this.blockIndex (否则 content_block_stop 索引错配)。 */
  private thinkingBlockIndex = 0;
  private textStarted = false;
  /** OpenAI tool_call 键 → Anthropic block index。键正常是 `tc.index`；上游省略
   *  index 时退化为 `id:<tool_call_id>`，两者都没有时沿用上一个键（见
   *  {@link resolveToolKey}）。 */
  private toolBlockIndex = new Map<string | number, number>();
  private blockIndex = 0;
  /** 每个 tool block 已发出的 `partial_json` 累积，用于识别「每片重发全量参数」
   *  的上游（见 tool_calls 分支的累计判别）。 */
  private toolArgsAccum = new Map<string | number, string>();
  /** 上一次解析出的 tool 键，供缺 index 且缺 id 的后续增量沿用。 */
  private lastToolKey: string | number | null = null;
  /** 已发出 message_delta/message_stop，避免 finish_reason、usage 尾帧、`[DONE]` 与
   *  {@link flush} 重复收口 —— 整条流恰好一个 message_stop。 */
  private messageClosed = false;
  /** 已为仍打开的块发出 content_block_stop。与 {@link messageClosed} 分开记：块在
   *  finish_reason 帧上就关，message_delta/message_stop 却可能推迟到之后的帧。 */
  private blocksClosed = false;
  /** [W-QUAD-CHAIN-20260914] finish_reason 已到、但 message_delta/message_stop 因等待
   *  usage 尾帧而推迟时记下的 stop_reason；没有推迟中的收尾时为 null。 */
  private pendingStopReason: string | null = null;
  /** [W-QUAD-CHAIN-20260914] 最近一次带 usage 对象的帧搬出的 usage（后到覆盖先到）；
   *  整条流从未出现 usage 对象时为 null，收尾 message_delta 据此不写 usage 键。 */
  private usage: StreamMessageUsage | null = null;

  /**
   * 解析一条 tool_call delta 归属的块键。
   *
   * OpenAI 流式规范里 `index` 是必填，但兼容实现常有省略。此前这里直接用
   * `tc.index` 做 Map 键：两个都省略 index 的 tool_call 会共用键 `undefined`，
   * 于是只开一个块、两段参数拼进同一条 `partial_json` 流，产出 `{…}{…}` 这种
   * 必然非法的 JSON。这里按「index → id → 沿用上一个」三级降级，让至少一种
   * 稳定标识生效。
   */
  private resolveToolKey(tc: { index?: number; id?: string }): string | number {
    if (typeof tc.index === 'number' && Number.isFinite(tc.index)) {
      this.lastToolKey = tc.index;
      return tc.index;
    }
    if (typeof tc.id === 'string' && tc.id !== '') {
      const key = `id:${tc.id}`;
      this.lastToolKey = key;
      return key;
    }
    if (this.lastToolKey !== null) return this.lastToolKey;
    this.lastToolKey = 0;
    return 0;
  }

  /**
   * 关闭仍打开的 text / thinking / tool 块（整条流只关一次）。
   *
   * 由 `finish_reason` 分支与 `[DONE]` 分支共用：上游断流或只发 `[DONE]` 而不发
   * `finish_reason` 时，此前一个 `content_block_stop` 都不会发，下游拿到的是一个
   * 永不闭合的 tool_use 块。
   *
   * [W-QUAD-CHAIN-20260914] 此前关块与 message_delta/message_stop 是同一个方法里同一时刻
   * 的事；usage 尾帧要求收尾推迟，于是拆成本方法与 {@link emitMessageEnd} 两段，各自防重。
   */
  private closeContentBlocks(events: StreamEvent[]): void {
    if (this.blocksClosed) return;
    this.blocksClosed = true;

    if (this.textStarted) {
      events.push({
        event: 'content_block_stop',
        data: JSON.stringify({ type: 'content_block_stop', index: this.blockIndex }),
      });
      this.textStarted = false;
    } else if (this.thinkingStarted && !this.thinkingStopped) {
      // 用 thinkingBlockIndex 关 — thinking-only 流末尾若有 tool block 推进过
      // blockIndex, 这里仍要用 thinking 自己打开时记下的 index, 否则错配。
      this.thinkingStopped = true;
      events.push({
        event: 'content_block_stop',
        data: JSON.stringify({ type: 'content_block_stop', index: this.thinkingBlockIndex }),
      });
    }
    for (const idx of this.toolBlockIndex.values()) {
      events.push({
        event: 'content_block_stop',
        data: JSON.stringify({ type: 'content_block_stop', index: idx }),
      });
    }
  }

  /**
   * 发出 message_delta + message_stop，整条流只发一次；同时清掉推迟中的收尾。
   *
   * 见过 usage 对象就把它放进 message_delta：usage 必须出现在唯一的 message_stop 之前，
   * message_stop 之后下游已无处安放用量。整条流从未出现 usage 对象时不写 usage 键 ——
   * 缺席表示「上游没给」，不是 0。
   */
  private emitMessageEnd(events: StreamEvent[], stopReason: string): void {
    if (this.messageClosed) return;
    this.messageClosed = true;
    this.pendingStopReason = null;

    const messageDelta: {
      type: 'message_delta';
      delta: { stop_reason: string };
      usage?: StreamMessageUsage;
    } = { type: 'message_delta', delta: { stop_reason: stopReason } };
    if (this.usage !== null) {
      messageDelta.usage = this.usage;
    }
    events.push({ event: 'message_delta', data: JSON.stringify(messageDelta) });
    events.push({
      event: 'message_stop',
      data: JSON.stringify({ type: 'message_stop' }),
    });
  }

  /**
   * 将一行 OpenAI SSE data 转换为零或多个 Anthropic 格式 StreamEvent
   * 返回 { events, done }
   */
  convert(data: string): { events: StreamEvent[]; done: boolean } {
    if (data === '[DONE]') {
      // 上游可能在 `[DONE]` 之前不发 finish_reason（部分兼容实现、以及被中断的
      // 流）。此前这里直接返回空事件，已打开的块永不闭合，下游只能靠超时收场。
      const events: StreamEvent[] = [];
      if (this.pendingStopReason !== null) {
        // [W-QUAD-CHAIN-20260914] finish_reason 已到而 usage 尾帧始终没来：流已声明结束，
        // 推迟的收尾不能再等（块已在 finish_reason 帧上关过）。
        this.emitMessageEnd(events, this.pendingStopReason);
      } else if (this.messageStarted) {
        this.closeContentBlocks(events);
        this.emitMessageEnd(events, 'end_turn');
      }
      return { events, done: true };
    }

    let chunk: OpenAIStreamChunk;
    try {
      chunk = JSON.parse(data);
    } catch (e) {
      throw new Error(`parse openai stream chunk: ${e instanceof Error ? e.message : String(e)}`);
    }

    const events: StreamEvent[] = [];
    // [W-QUAD-CHAIN-20260914] usage 必须在「没有 choices 就返回」之前读: include_usage 的尾帧
    // 恰恰是 `{"choices":[],"usage":{...}}`。此前先判 choices 再返回, 尾帧整帧丢弃,
    // OpenAI 线每个回合的 usage 恒为 0。
    const frameUsage = readStreamUsage(chunk);
    if (frameUsage !== null) {
      this.usage = frameUsage; // 后到覆盖先到
    }

    // [W-QUAD-CHAIN-20260914] 纵深防御: 同一条流里可能出现**没有 choices 的 data 帧**
    // (网关错误契约帧、usage 尾帧)。此前这里直接解引用, 任何这类帧都会变成一句与真因无关的
    // TypeError, 把诊断信息彻底摧毁。正确的错误分流在 client.ts 的 SSE 事件名判断处; 这里
    // 只负责「不把自己炸掉」, 以及 usage 尾帧到达时补发推迟中的收尾。不带 usage 的这类帧零事件。
    if (!Array.isArray(chunk.choices) || chunk.choices.length === 0) {
      if (frameUsage !== null && this.pendingStopReason !== null) {
        this.emitMessageEnd(events, this.pendingStopReason);
      }
      return { events, done: false };
    }
    const choice = chunk.choices[0]!;
    // [W-SDK-OPENAI-PARITY] 与上面的 choices 守卫同一档纵深防御: 兼容实现会发
    // `{"choices":[{"index":0}]}` 这种空心 choice (只声明「第 0 路还在」而本帧无增量)。
    // 此前三处直接读 `choice.delta.*`, 第一处就是 `reasoning_content` —— 一个 TypeError
    // 撕开整条 for-await 链, 整个回合失败。缺席按空 delta 处理: 三个分支各自的空值判断
    // 会让它零事件通过, finish_reason / usage 仍照常处理。
    const delta: OpenAIStreamDelta = choice.delta ?? {};

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
    if (delta.reasoning_content && delta.reasoning_content !== '') {
      if (!this.thinkingStarted) {
        // [W-SDK-OPENAI-PARITY] 关闭仍打开的 text 块 (镜像 text / tool_calls 两个分支)。
        // chunk 顺序 content → reasoning_content 时, text 块仍开着且 blockIndex 未推进;
        // 不在此关闭并递增, thinking 的 content_block_start 会与 text 撞同一个 index 0,
        // 而 closeContentBlocks 的 `textStarted / else if thinking` 分支只关得掉其中一个 ——
        // 另一个块永不闭合。三个分支必须两两互关, 才有「同一时刻至多一个非 tool 块打开」这条不变量。
        if (this.textStarted) {
          const stopJSON = JSON.stringify({
            type: 'content_block_stop',
            index: this.blockIndex,
          });
          events.push({ event: 'content_block_stop', data: stopJSON });
          this.blockIndex++;
          this.textStarted = false;
        }
        this.thinkingStarted = true;
        this.thinkingBlockIndex = this.blockIndex; // 记下 thinking 占用的 index
        const blockJSON = JSON.stringify({
          type: 'content_block_start',
          index: this.blockIndex,
          content_block: { type: 'thinking', thinking: '' },
        });
        events.push({ event: 'content_block_start', data: blockJSON });
      }
      const deltaJSON = JSON.stringify({
        type: 'content_block_delta',
        index: this.thinkingBlockIndex,
        delta: { type: 'thinking_delta', thinking: delta.reasoning_content },
      });
      events.push({ event: 'content_block_delta', data: deltaJSON });
    }

    // text delta (content)
    if (delta.content && delta.content !== '') {
      // 关闭 thinking block (如果有) — 用 thinkingBlockIndex 关, 不用可能已推进的 blockIndex
      if (this.thinkingStarted && !this.thinkingStopped) {
        this.thinkingStopped = true;
        const stopJSON = JSON.stringify({
          type: 'content_block_stop',
          index: this.thinkingBlockIndex,
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
        delta: { type: 'text_delta', text: delta.content },
      });
      events.push({ event: 'content_block_delta', data: deltaJSON });
    }

    // tool_calls delta
    for (const tc of delta.tool_calls ?? []) {
      // 上游给的 tool_call 未必带 `function`：OpenAI 流式规范允许后续增量只带
      // `{index}`。此前这里直接读 `tc.function.name` / `tc.function.arguments`，
      // 那种上游会抛 TypeError 撕开整条 for-await 链，整个回合失败。
      const fn = tc.function as { name?: string; arguments?: unknown } | undefined;
      const toolKey = this.resolveToolKey(tc);
      if (!this.toolBlockIndex.has(toolKey)) {
        // 关闭仍打开的 thinking block (镜像 text 分支): chunk 顺序 reasoning_content →
        // tool_calls (中间无 content text delta) 时, thinking 仍开着且 blockIndex 未推进,
        // 若不在此关闭并递增, tool block 会与 thinking 撞 index 0。用 thinkingBlockIndex 关。
        if (this.thinkingStarted && !this.thinkingStopped) {
          this.thinkingStopped = true;
          const stopJSON = JSON.stringify({
            type: 'content_block_stop',
            index: this.thinkingBlockIndex,
          });
          events.push({ event: 'content_block_stop', data: stopJSON });
          this.blockIndex++;
        }
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
        this.toolBlockIndex.set(toolKey, this.blockIndex);
        const blockJSON = JSON.stringify({
          type: 'content_block_start',
          index: this.blockIndex,
          content_block: {
            type: 'tool_use',
            id: tc.id,
            name: fn?.name,
            input: {},
          },
        });
        events.push({ event: 'content_block_start', data: blockJSON });
        this.blockIndex++; // 递增, 为下一个 tool_call block 预留索引
      }
      if (fn?.arguments !== undefined && fn.arguments !== null && fn.arguments !== '') {
        // `arguments` 按 OpenAI 规范是 string，但部分兼容实现直接给对象。此前原样
        // 塞进 `partial_json`，下游 `input += delta.partial_json` 会拼出
        // "[object Object]"。这里统一成字符串，语义不变。
        const rawArgs =
          typeof fn.arguments === 'string' ? fn.arguments : JSON.stringify(fn.arguments);

        // 累计 vs 增量判别：部分上游每个 chunk 重发**全量**参数而非增量。此前无条件
        // 累加，会拼出 `{"a":1}{"a":1}{"a":1}` 这种必然非法的 JSON。判据取最保守的
        // 一种：新片严格以已累积内容为前缀**且**更长时，才认为上游在重发全量，只发
        // 差值。真增量流里某一片恰好等于「此前全部内容的延长」概率可忽略。
        const accum = this.toolArgsAccum.get(toolKey) ?? '';
        let emit = rawArgs;
        if (accum !== '' && rawArgs.length > accum.length && rawArgs.startsWith(accum)) {
          emit = rawArgs.slice(accum.length);
          this.toolArgsAccum.set(toolKey, rawArgs);
        } else {
          this.toolArgsAccum.set(toolKey, accum + rawArgs);
        }

        if (emit !== '') {
          const idx = this.toolBlockIndex.get(toolKey)!;
          const deltaJSON = JSON.stringify({
            type: 'content_block_delta',
            index: idx,
            delta: {
              type: 'input_json_delta',
              partial_json: emit,
            },
          });
          events.push({ event: 'content_block_delta', data: deltaJSON });
        }
      }
    }

    // finish_reason: 关闭所有 block; message_delta + message_stop 视 usage 是否已到, 立即发或推迟
    if (choice.finish_reason != null && choice.finish_reason !== '') {
      // stop_reason 映射。`content_filter` 等未列出的值刻意保持原样透传而不是压成
      // `end_turn` —— 把内容审查拦截伪装成正常结束会让下游无从分辨。同文件的
      // `convertOpenAIToChatResponse` 一直是原样透传，这里跟它对齐。
      let stopReason: string;
      switch (choice.finish_reason) {
        case 'tool_calls':
          stopReason = 'tool_use';
          break;
        case 'length':
          stopReason = 'max_tokens';
          break;
        case 'stop':
          stopReason = 'end_turn';
          break;
        default:
          stopReason = choice.finish_reason;
      }
      // 只认第一个 finish_reason: 收尾已发出或已推迟时, 后到的 finish_reason 不改写 stop_reason。
      if (!this.messageClosed && this.pendingStopReason === null) {
        this.closeContentBlocks(events);
        if (this.usage !== null) {
          // usage 已在本帧或更早的帧到达: 一次发出带 usage 的收尾
          this.emitMessageEnd(events, stopReason);
        } else {
          // [W-QUAD-CHAIN-20260914] include_usage 的标准帧序里 finish_reason 帧先于 usage 尾帧。
          // 此刻收尾, message_delta 只能不带 usage, 之后到的 usage 已无处安放 —— 于是推迟到
          // usage 帧 / `[DONE]` / EOF (flush) 三者先到者。块照常在这一帧关闭。
          this.pendingStopReason = stopReason;
        }
      }
    }

    // [W-QUAD-CHAIN-20260914] 推迟收尾期间到达的带 choices 帧若携带 usage, 同样立即补发。
    if (frameUsage !== null && this.pendingStopReason !== null) {
      this.emitMessageEnd(events, this.pendingStopReason);
    }

    return { events, done: false };
  }

  /**
   * 流在**没有** `[DONE]` 的情况下结束 (EOF) 时, 由驱动方在读循环结束后调用一次。
   *
   * 只补发「finish_reason 已到、仅因等待 usage 尾帧而推迟」的 message_delta + message_stop。
   * 从未收到 finish_reason 的流是被截断的流, 这里刻意**不**替它伪造正常结束 —— 一个
   * `end_turn` 的 message_stop 会把被截断的回答当成完整回答交给下游。
   * 已经收口 (usage 帧 / `[DONE]` / 上一次 flush) 后再调用返回空数组, 不会发出第二个 message_stop。
   */
  flush(): StreamEvent[] {
    const events: StreamEvent[] = [];
    if (this.pendingStopReason !== null) {
      this.emitMessageEnd(events, this.pendingStopReason);
    }
    return events;
  }
}

export function newOpenAIStreamConverter(): OpenAIStreamConverter {
  return new OpenAIStreamConverter();
}
