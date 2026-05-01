// sanitize/types.ts — 端口自 acosmi-sdk-go/sanitize/types.go
//
// Provider 无关的 content-block 防御性处理。
// 职责边界:
//   - SDK 层: 只做所有下游 provider 都不可能接受的底线剥除 + 早失败
//   - Gateway 层: 按 provider preset 精细剥除 (不在本包内)

/** Anthropic content block 类型 (请求 + 响应 + ephemeral) */
export type BlockType =
  | 'text'
  | 'image'
  | 'video'
  | 'document'
  | 'search_result'
  | 'thinking'
  | 'redacted_thinking'
  | 'tool_use'
  | 'tool_result'
  | 'tool_reference'
  | 'server_tool_use'
  | 'web_search_tool_result'
  | 'code_execution_tool_result'
  | 'mcp_tool_use'
  | 'mcp_tool_result'
  | 'container_upload';

export const BlockText: BlockType = 'text';
export const BlockImage: BlockType = 'image';
export const BlockVideo: BlockType = 'video';
export const BlockDocument: BlockType = 'document';
export const BlockSearchResult: BlockType = 'search_result';
export const BlockThinking: BlockType = 'thinking';
export const BlockRedactedThinking: BlockType = 'redacted_thinking';
export const BlockToolUse: BlockType = 'tool_use';
export const BlockToolResult: BlockType = 'tool_result';
export const BlockToolReference: BlockType = 'tool_reference';
export const BlockServerToolUse: BlockType = 'server_tool_use';
export const BlockWebSearchToolResult: BlockType = 'web_search_tool_result';
export const BlockCodeExecutionToolResult: BlockType = 'code_execution_tool_result';
export const BlockMCPToolUse: BlockType = 'mcp_tool_use';
export const BlockMCPToolResult: BlockType = 'mcp_tool_result';
export const BlockContainerUpload: BlockType = 'container_upload';

/** 流式响应 delta 类型 (与 BlockType 正交) */
export type DeltaType =
  | 'text_delta'
  | 'input_json_delta'
  | 'thinking_delta'
  | 'signature_delta'
  | 'citations_delta';

export const DeltaText: DeltaType = 'text_delta';
export const DeltaInputJSON: DeltaType = 'input_json_delta';
export const DeltaThinking: DeltaType = 'thinking_delta';
export const DeltaSignature: DeltaType = 'signature_delta';
export const DeltaCitations: DeltaType = 'citations_delta';

/**
 * 网关在 block JSON 中注入的 in-band 标记字段名。
 * 存在且值为 true 时代表该 block 不应回传下一轮。
 *
 * 选择 in-band 标记而非独立 SSE 事件的理由:
 *   - 零缓冲 / 零顺序依赖 / 零延迟
 *   - history 剥离天然可做
 */
export const EphemeralMarkerField = 'acosmi_ephemeral';
