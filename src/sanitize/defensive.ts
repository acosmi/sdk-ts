// sanitize/defensive.ts — 端口自 acosmi-sdk-go/sanitize/defensive.go

import type { BlockType } from './types';
import type { MinimalSanitizeConfig } from './config';
import { ErrHistoryTooDeep, SizeError } from './config';
import { dropBlocks } from './history';

/**
 * 对已经解析为 unknown[] 的 messages 做底线防御: 深度校验 +
 * 体积校验 + deny-list 剥除 + tool_use_id 联动剥除 tool_result。
 *
 * 入参形态: messages 的每个元素预期是 object (含 role / content); content 为 string (plain text)
 * 或 unknown[] (block 数组)。形态异常的元素原样透传, 不抛错。
 *
 * 通过返回新 messages (可能 block 数组被缩减); 早失败抛错 (调用方应放弃本次请求)。
 */
export function sanitize(messages: unknown[], cfg: MinimalSanitizeConfig): unknown[] {
  if ((cfg.maxMessagesTurns ?? 0) > 0 && messages.length > (cfg.maxMessagesTurns as number)) {
    throw ErrHistoryTooDeep;
  }

  // 体积校验: 先扫一遍, 任何违规直接早失败 (不修改 messages)
  if ((cfg.maxImageBytes ?? 0) > 0 || (cfg.maxVideoBytes ?? 0) > 0 || (cfg.maxPDFBytes ?? 0) > 0) {
    checkMediaSizes(messages, cfg);
  }

  // deny-list 剥除 + tool_use_id 联动
  if (cfg.permanentDenyBlocks && cfg.permanentDenyBlocks.length > 0) {
    const denySet = new Set<string>();
    for (const bt of cfg.permanentDenyBlocks) denySet.add(bt as string);
    messages = dropBlocks(messages, (b) => {
      const t = (b as Record<string, unknown>)['type'];
      return typeof t === 'string' && denySet.has(t);
    });
  }

  return messages;
}

/**
 * 遍历所有 block, 对 base64 内联 image/video/document 类型校验解码后字节数。
 * URL 版无法本地量体积, 跳过 (交网关把关)。违规直接抛 SizeError。
 */
function checkMediaSizes(messages: unknown[], cfg: MinimalSanitizeConfig): void {
  for (const msg of messages) {
    if (!isPlainObject(msg)) continue;
    const content = msg['content'];
    if (!Array.isArray(content)) continue;
    for (const raw of content) {
      if (!isPlainObject(raw)) continue;
      const bt = raw['type'];
      if (typeof bt !== 'string') continue;

      let limit = 0;
      switch (bt as BlockType) {
        case 'image':
          limit = cfg.maxImageBytes ?? 0;
          break;
        case 'video':
          limit = cfg.maxVideoBytes ?? 0;
          break;
        case 'document':
          limit = cfg.maxPDFBytes ?? 0;
          break;
        default:
          continue;
      }
      if (limit <= 0) continue;

      const data = extractBase64Data(raw);
      if (data === '') continue; // URL 版或形态异常, 跳过
      const actual = base64DecodedLen(data);
      if (actual > limit) {
        throw new SizeError(bt as BlockType, actual, limit);
      }
    }
  }
}

/**
 * 从 Anthropic block 结构中抽 base64 data 字段。
 *
 * 形态:
 *   image:    {source:{type:"base64", data:"..."}}
 *   video:    {source:{type:"base64", data:"..."}}
 *   document: {source:{type:"base64", data:"..."}}
 *
 * 若是 URL 版 (source.type="url") 或缺字段, 返回 ""。
 */
function extractBase64Data(block: Record<string, unknown>): string {
  const src = block['source'];
  if (!isPlainObject(src)) return '';
  if (src['type'] !== 'base64') return '';
  const dataRaw = src['data'];
  if (typeof dataRaw !== 'string') return '';
  let data: string = dataRaw;
  // 防御性: 某些上游把 "data:image/jpeg;base64,..." 整串塞进 data,
  // 虽非标准但兜底去掉前缀, 保证字节数估算正确。
  const i = data.indexOf('base64,');
  if (i >= 0) {
    data = data.slice(i + 'base64,'.length);
  }
  return data;
}

/** Go base64.StdEncoding.DecodedLen 等价: ceil(n*3/4) 减去 padding */
function base64DecodedLen(b64: string): number {
  // Go 的 DecodedLen(n) = (n / 4) * 3 - paddingCount
  const n = b64.length;
  let pad = 0;
  if (n >= 1 && b64[n - 1] === '=') pad++;
  if (n >= 2 && b64[n - 2] === '=') pad++;
  return Math.floor((n * 3) / 4) - pad;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
