// stream-meta.ts — 端口自 acosmi-sdk-go/stream_meta.go
//
// Anthropic SSE 事件的 content block 元数据解析。
// 把 content_block_start 中的 index / type / acosmi_ephemeral 记入 blockTypeMap,
// 供 delta/stop 查表回填 StreamEvent 的 blockIndex / blockType / ephemeral 三字段。
//
// 设计要点:
//   - in-band 标记: ephemeral 随 content_block_start 的 JSON payload 到达,
//     无需独立 SSE 事件, 零额外缓冲, 零顺序依赖, 零延迟。
//   - 惰性解析: 只对 3 种 content_block_* 事件解 JSON, 其他事件跳过。
//   - 单流 map: 由单 async iterator 拥有 (SSE 扫描循环), 无锁。stop 后删表项, 防长流累积。

/** SDK 为单个 content block 缓存的元数据 */
export interface BlockMeta {
  type: string;
  ephemeral: boolean;
}

/**
 * 按 Anthropic SSE 事件类型解析 data, 更新 blockTypeMap, 返回 [index, type, ephemeral]。
 *
 * 仅当事件为 content_block_start / content_block_delta / content_block_stop
 * 时返回非空 type; 其他事件返回空 type, 调用方据此判别是否填充 StreamEvent 元数据字段。
 */
export function extractAnthropicBlockMeta(
  eventType: string,
  data: string,
  blockTypeMap: Map<number, BlockMeta>,
): [number, string, boolean] {
  switch (eventType) {
    case 'content_block_start': {
      let payload: { index?: number; content_block?: { type?: string; acosmi_ephemeral?: boolean } };
      try {
        payload = JSON.parse(data);
      } catch {
        return [0, '', false];
      }
      const index = payload.index ?? 0;
      const meta: BlockMeta = {
        type: payload.content_block?.type ?? '',
        ephemeral: payload.content_block?.acosmi_ephemeral ?? false,
      };
      blockTypeMap.set(index, meta);
      return [index, meta.type, meta.ephemeral];
    }
    case 'content_block_delta': {
      let payload: { index?: number };
      try {
        payload = JSON.parse(data);
      } catch {
        return [0, '', false];
      }
      const index = payload.index ?? 0;
      const meta = blockTypeMap.get(index);
      return [index, meta?.type ?? '', meta?.ephemeral ?? false];
    }
    case 'content_block_stop': {
      let payload: { index?: number };
      try {
        payload = JSON.parse(data);
      } catch {
        return [0, '', false];
      }
      const index = payload.index ?? 0;
      const meta = blockTypeMap.get(index);
      blockTypeMap.delete(index);
      return [index, meta?.type ?? '', meta?.ephemeral ?? false];
    }
    default:
      return [0, '', false];
  }
}
