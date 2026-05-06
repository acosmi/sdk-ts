// adapters/anthropic.ts — 端口自 acosmi-sdk-go/adapter_anthropic.go (228 行)
//
// Anthropic 原生格式 adapter
// 重构自 buildChatRequest 现有逻辑，功能完全等同。
// 包含 buildBetas() 调用、serverTools 合入、extraBody 透传。

import {
  type ChatRequest,
  type ChatResponse,
  type ModelCapabilities,
  type StreamEvent,
  BusinessError,
  ThinkingHighMinMaxTokens,
  ThinkingMax,
  ThinkingMaxFallbackMaxTokens,
  ThinkingOff,
} from '../types';
import { buildBetas } from '../betas';
import { ProviderFormat, type ProviderAdapter } from './index';

/** 实现 ProviderAdapter, 用于 Anthropic 原生模型 */
export class AnthropicAdapter implements ProviderAdapter {
  format(): ProviderFormat {
    return ProviderFormat.Anthropic;
  }

  endpointSuffix(): string {
    return '/anthropic';
  }

  /**
   * 构建 Anthropic 格式请求体
   * 逻辑等同于原 buildChatRequest, 包含完整的 betas/tools/serverTools/extraBody 处理
   */
  buildRequestBody(caps: ModelCapabilities, req: ChatRequest): Record<string, unknown> {
    const body: Record<string, unknown> = {};

    // 消息: rawMessages 优先于 messages
    if (req.rawMessages != null) {
      body['messages'] = req.rawMessages;
    } else if ((req.messages?.length ?? 0) > 0) {
      body['messages'] = req.messages;
    }

    body['stream'] = req.stream === true;

    if (req.max_tokens && req.max_tokens > 0) {
      body['max_tokens'] = req.max_tokens;
    }
    if (req.system != null) {
      body['system'] = req.system;
    }
    if (req.temperature != null) {
      body['temperature'] = req.temperature;
    }

    // ── Thinking + Effort 组装 ──
    if (req.thinking && req.thinking.level && req.thinking.level !== '') {
      // Level 模式: SDK 接管 thinking + effort + maxTokens
      resolveThinkingLevel(body, req, caps);
    } else {
      // 兼容模式: 调用方自己拼 (保持 v0.8.0 行为)
      if (req.thinking) {
        body['thinking'] = req.thinking;
      }
      if (req.effort) {
        body['effort'] = req.effort;
      }
    }

    if (req.metadata) {
      body['metadata'] = req.metadata;
    }

    // ── 合入 tools + serverTools ──
    const allTools: unknown[] = [];
    if (req.tools != null) {
      // tools 透传 — 在 Go 侧通过 json.Marshal+Unmarshal 实现深拷贝, TS 中我们直接拼接
      try {
        const parsed = JSON.parse(JSON.stringify(req.tools));
        if (Array.isArray(parsed)) {
          for (const t of parsed) allTools.push(t);
        }
      } catch {
        // ignore — 与 Go 侧 silent ignore 行为一致
      }
    }
    for (const st of req.serverTools ?? []) {
      const schema: Record<string, unknown> = {
        type: st.type,
        name: st.name,
      };
      if (st.config) {
        for (const [k, v] of Object.entries(st.config)) {
          schema[k] = v;
        }
      }
      allTools.push(schema);
    }
    if (allTools.length > 0) {
      body['tools'] = allTools;
    }

    // ── 推理控制 (非 Level 模式时的透传) ──
    if (req.speed && req.speed !== '') {
      body['speed'] = req.speed;
    }
    if (req.outputConfig) {
      body['output_config'] = req.outputConfig;
    }

    // ── Beta 自动组装 ──
    const betas = buildBetas(caps, req);
    if (betas.length > 0) {
      body['betas'] = betas;
    }

    // ── 透传 extraBody ──
    // 注意: extraBody 在 resolveThinkingLevel 之后执行，
    // Level 模式下 thinking / effort / max_tokens / temperature 已由 SDK 管理，
    // extraBody 中不应包含这些 key, 否则会覆盖 SDK 计算结果
    if (req.extraBody) {
      for (const [k, v] of Object.entries(req.extraBody)) {
        body[k] = v;
      }
    }

    return body;
  }

  /**
   * 解析 Anthropic 格式同步响应
   * 兼容 APIResponse 包装 {"code":0,"data":{...}} 和裸 Anthropic JSON 两种格式
   */
  parseResponse(bodyInput: Uint8Array | string): ChatResponse {
    const bodyStr = typeof bodyInput === 'string' ? bodyInput : new TextDecoder().decode(bodyInput);

    // 尝试 APIResponse 包装
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
      // 非 JSON 或无 wrapper 格式 — 用原始 bodyStr
    }

    let resp: ChatResponse;
    try {
      resp = JSON.parse(raw) as ChatResponse;
    } catch (e) {
      throw new Error(
        `decode anthropic response: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
    resp.tokenRemaining = -1;
    resp.callRemaining = -1;
    resp.modelTokenRemaining = -1;
    resp.modelTokenRemainingETU = -1;
    return resp;
  }

  /**
   * 解析 Anthropic SSE 行
   *
   * Anthropic 原生协议无 [DONE] (message_stop 后上游关闭连接),
   * 但 Nexus Gateway 的 ChatStream 路径会追加 [DONE] 哨兵, 此处一并处理。
   */
  parseStreamLine(eventType: string, data: string): { event: StreamEvent; done: boolean } {
    if (data === '[DONE]') {
      return { event: { event: '', data: '' }, done: true };
    }
    return { event: { event: eventType, data }, done: false };
  }
}

/**
 * 根据 ThinkingConfig.level 自动组装请求参数
 *
 * off  → thinking=disabled, 不设 effort, 不动 maxTokens
 * high → thinking=adaptive, effort=high, maxTokens 至少 32K
 * max  → thinking=adaptive, effort=max, maxTokens 拉到模型上限
 *
 * 旧模型不支持 adaptive 时, 回退到 enabled + budget_tokens = maxTokens - 1
 */
export function resolveThinkingLevel(
  body: Record<string, unknown>,
  req: ChatRequest,
  caps: ModelCapabilities,
): void {
  const level = req.thinking?.level ?? '';

  // ── off ──
  if (level === ThinkingOff) {
    body['thinking'] = { type: 'disabled' };
    return;
  }

  // ── 模型不支持任何形式的 thinking → 不动 maxTokens, 直接返回 ──
  if (!caps.supports_adaptive_thinking && !caps.supports_thinking) {
    return;
  }

  // ── 确定 maxTokens ──
  let maxTokens = req.max_tokens ?? 0;
  if (maxTokens <= 0) {
    maxTokens = ThinkingHighMinMaxTokens;
  }

  if (level === ThinkingMax) {
    let modelMax = caps.max_output_tokens;
    if (modelMax <= 0) modelMax = ThinkingMaxFallbackMaxTokens;
    if (maxTokens < modelMax) maxTokens = modelMax;
  } else {
    if (maxTokens < ThinkingHighMinMaxTokens) maxTokens = ThinkingHighMinMaxTokens;
  }
  body['max_tokens'] = maxTokens;

  // ── thinking ──
  // adaptive 优先 (Claude 4.x); 旧模型回退 enabled + full budget
  if (caps.supports_adaptive_thinking) {
    const thinking: Record<string, unknown> = { type: 'adaptive' };
    if (req.thinking?.display) thinking['display'] = req.thinking.display;
    body['thinking'] = thinking;
  } else if (caps.supports_thinking) {
    let budget = maxTokens - 1;
    if (budget < 1024) budget = 1024;
    const thinking: Record<string, unknown> = {
      type: 'enabled',
      budget_tokens: budget,
    };
    if (req.thinking?.display) thinking['display'] = req.thinking.display;
    body['thinking'] = thinking;
  }

  // ── effort ──
  // 仅支持 effort 的模型发送此参数
  if (caps.supports_effort) {
    let effortLevel = 'high';
    if (level === ThinkingMax && caps.supports_max_effort) {
      effortLevel = 'max';
    }
    body['effort'] = { level: effortLevel };
  }

  // ── API 约束: thinking 与 temperature 互斥 ──
  delete body['temperature'];
}
