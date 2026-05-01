// sanitize-bridge.ts — 端口自 acosmi-sdk-go/sanitize_bridge.go
//
// 主包与 sanitize 子包的胶水层。
// sanitize 子包定义了与 provider 无关的 block 处理工具, 不依赖主包;
// 本文件把 ChatRequest 这种主包类型归一化为 sanitize 能处理的 unknown[] 形态,
// 并提供 Client 级别的可配置钩子 (setDefensiveSanitize / setAutoStripEphemeralHistory).
//
// 调用时机: buildChatRequest 开头 (每次 chat/chatStream/chatMessages*).
// 未配置时零开销 (applyRequestSanitizers 首行 early-return).

import { Client } from './client';
import type { ChatRequest } from './types';
import { type MinimalSanitizeConfig, ErrHistoryTooDeep, sanitize, stripEphemeral } from './sanitize';

declare module './client' {
  interface Client {
    /**
     * 配置请求前的底线防御 (体积 / deny-list / 深度)。
     * 传空值 {} 关闭 (所有字段为零 = 禁用)。
     * 并发安全, 可在任意时间调用。
     */
    setDefensiveSanitize(cfg: MinimalSanitizeConfig): void;

    /**
     * 开启后, 每次请求前 SDK 会从 rawMessages 中剥除带 acosmi_ephemeral:true 标记的 block,
     * 并联动剥除引用已剥 tool_use 的 tool_result, 避免 provider 报 "tool_use_id 不存在".
     *
     * 标记来源: 网关在响应 content_block_start 中 in-band 注入; 消费者把上一轮 assistant
     * 回复原样拼回 history 即可触发剥离。
     */
    setAutoStripEphemeralHistory(on: boolean): void;

    /**
     * 在 buildChatRequest 开头调用, 把配置化的防御策略应用到 req。
     * 未配置时立即返回, 零开销。
     *
     * 失败时抛错 — 调用方应放弃本次请求。
     */
    applyRequestSanitizers(req: ChatRequest): void;
  }
}

Client.prototype.setDefensiveSanitize = function (this: Client, cfg: MinimalSanitizeConfig) {
  this.defensiveCfg = cfg;
};

Client.prototype.setAutoStripEphemeralHistory = function (this: Client, on: boolean) {
  this.autoStripEphemeral = on;
};

Client.prototype.applyRequestSanitizers = function (this: Client, req: ChatRequest) {
  const cfg = this.defensiveCfg;
  const strip = this.autoStripEphemeral;

  if (cfg == null && !strip) return;

  // rawMessages 分支: 归一化 → sanitize → (可选) strip → 写回
  if (req.rawMessages != null) {
    let msgs: unknown[];
    try {
      msgs = normalizeRawMessages(req.rawMessages);
    } catch (e) {
      throw new Error(
        `sanitize: normalize raw messages: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
    if (cfg) {
      msgs = sanitize(msgs, cfg);
    }
    if (strip) {
      msgs = stripEphemeral(msgs);
    }
    req.rawMessages = msgs;
    return;
  }

  // 纯 messages 分支: block 级操作不适用, 只做深度校验
  if (
    cfg &&
    (cfg.maxMessagesTurns ?? 0) > 0 &&
    (req.messages?.length ?? 0) > (cfg.maxMessagesTurns as number)
  ) {
    throw ErrHistoryTooDeep;
  }
};

/**
 * 把任意形态的 rawMessages (struct 数组 / map 数组 / unknown[]) 归一为 unknown[]。
 *
 * 已是 unknown[] (Array) 时零拷贝直接返回; 其他走一次 JSON roundtrip。
 */
function normalizeRawMessages(rm: unknown): unknown[] {
  if (Array.isArray(rm)) return rm;
  let s: unknown;
  try {
    s = JSON.parse(JSON.stringify(rm));
  } catch (e) {
    throw new Error(`raw messages: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (!Array.isArray(s)) {
    throw new Error('raw messages must be a JSON array');
  }
  return s;
}
