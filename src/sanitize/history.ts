// sanitize/history.ts — 端口自 acosmi-sdk-go/sanitize/history.go

import { EphemeralMarkerField } from './types';

/** 判定一个 block 是否应被剥除 */
export type BlockPredicate = (block: Record<string, unknown>) => boolean;

/**
 * 按 pred 从 messages 中剥除 block, 并联动剥除对应的 tool_result (user 轮)。
 *
 * 收敛两步: 先扫收集 droppedToolUseIDs, 再整体剥; 这样顺序不影响正确性
 * (即使 tool_result 在 tool_use 之前出现也能捕获)。
 *
 * 不修改入参 messages 中任何 map 的 key, 只重构数组。
 * 未被修改的 message 保持原引用 (零拷贝优化)。
 */
export function dropBlocks(messages: unknown[], pred: BlockPredicate): unknown[] {
  const droppedToolUseIDs = collectDroppedToolUseIDs(messages, pred);

  const out: unknown[] = [];
  for (const msg of messages) {
    if (!isPlainObject(msg)) {
      out.push(msg);
      continue;
    }
    const content = msg['content'];
    if (!Array.isArray(content)) {
      out.push(msg);
      continue;
    }

    const { kept, changed } = filterBlocks(content, pred, droppedToolUseIDs);
    if (!changed) {
      out.push(msg);
      continue;
    }

    // content 空了的消息整条丢弃 (assistant 本轮全是 ephemeral 块;
    // 或 user 轮全是联动剥的 tool_result)。避免产生空消息让 provider 报错。
    if (kept.length === 0) {
      continue;
    }

    // 浅拷贝 msg, 只改 content, 避免污染调用方数据。
    const newMsg: Record<string, unknown> = { ...msg };
    newMsg['content'] = kept;
    out.push(newMsg);
  }
  return out;
}

/** 第一遍扫描, 仅收集"本次被 pred 命中的 tool_use 类 block 的 id", 以便联动剥 tool_result。 */
function collectDroppedToolUseIDs(messages: unknown[], pred: BlockPredicate): Set<string> {
  const ids = new Set<string>();
  for (const msg of messages) {
    if (!isPlainObject(msg)) continue;
    const content = msg['content'];
    if (!Array.isArray(content)) continue;
    for (const raw of content) {
      if (!isPlainObject(raw)) continue;
      if (!pred(raw)) continue;
      const t = raw['type'];
      if (typeof t !== 'string') continue;
      if (t === 'tool_use' || t === 'server_tool_use' || t === 'mcp_tool_use') {
        const id = raw['id'];
        if (typeof id === 'string' && id !== '') ids.add(id);
      }
    }
  }
  return ids;
}

/**
 * 对单条消息的 content 数组剥除 pred 命中的 block, 以及
 * tool_use_id 在 droppedToolUseIDs 中的 tool_result。返回 (新数组, 是否变更)。
 */
function filterBlocks(
  content: unknown[],
  pred: BlockPredicate,
  droppedToolUseIDs: Set<string>,
): { kept: unknown[]; changed: boolean } {
  const kept: unknown[] = [];
  let changed = false;
  for (const raw of content) {
    if (!isPlainObject(raw)) {
      kept.push(raw);
      continue;
    }
    if (pred(raw)) {
      changed = true;
      continue;
    }
    // 联动剥 tool_result / mcp_tool_result (仅当 tool_use_id 命中)
    if (droppedToolUseIDs.size > 0) {
      const t = raw['type'];
      if (t === 'tool_result' || t === 'mcp_tool_result') {
        const id = raw['tool_use_id'];
        if (typeof id === 'string' && id !== '' && droppedToolUseIDs.has(id)) {
          changed = true;
          continue;
        }
      }
    }
    kept.push(raw);
  }
  return { kept, changed };
}

/**
 * 从 messages 中剥除带 acosmi_ephemeral:true 标记的 block, 以及对应的 tool_result。
 *
 * 硬豁免: thinking / redacted_thinking 块永不剥, 即使携带 ephemeral 标记。
 *
 * 理由: Anthropic extended thinking + tool_use 续轮场景下, 上游强制要求
 * assistant 历史中保留原始 thinking 块, 否则返回:
 *   "The content[].thinking in the thinking mode must be passed back to the API."
 *
 * 历史污染防御: 即使旧版网关 / 历史响应里 thinking 块带了 ephemeral=true,
 * 客户端在调用 stripEphemeral 时也不应剥除。网关侧 anthropic preset 已停止注入此标记,
 * 本豁免兜底历史会话与第三方调用方两类已污染场景。
 */
export function stripEphemeral(messages: unknown[]): unknown[] {
  return dropBlocks(messages, (b) => {
    const t = b['type'];
    if (t === 'thinking' || t === 'redacted_thinking') {
      return false; // 硬豁免, 不可被 ephemeral 标记覆盖
    }
    const v = b[EphemeralMarkerField];
    return v === true;
  });
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
