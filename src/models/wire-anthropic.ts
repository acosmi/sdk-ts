// models/wire-anthropic.ts — Anthropic wire-format 响应 DTO。
//
// 端口自 acosmi-sdk-go/types.go (v0.19.0) 的 AnthropicResponse 段。
//
// 命名约定：字段名 = Go json tag 字面量 (wire format), 不做 camelCase 重映射。

/**
 * Anthropic 内容块
 * 覆盖: text / thinking / redacted_thinking / tool_use / tool_result /
 *       server_tool_use / mcp_tool_use / mcp_tool_result
 */
export interface AnthropicContentBlock {
  type: string;
  text?: string;
  /** tool_use / server_tool_use / mcp_tool_use block ID */
  id?: string;
  /** tool_use function name */
  name?: string;
  /** tool_use arguments (json.RawMessage) */
  input?: unknown;
  /** thinking block content */
  thinking?: string;

  /** text — web_search 搜索引用 */
  citations?: unknown;
  /** thinking — Anthropic 签名 (后续请求必须回传) */
  signature?: string;
  /** redacted_thinking — base64 编码的被审查思考内容 */
  data?: string;
  /** server_tool_use / mcp_tool_use / mcp_tool_result — 服务端工具来源 */
  server_name?: string;
  /** mcp_tool_use — MCP 调用者上下文 */
  caller?: unknown;
  /** tool_result / mcp_tool_result — 工具执行结果 */
  tool_use_id?: string;
  content?: unknown;
  is_error?: boolean;
}

/** Anthropic token 用量 */
export interface AnthropicUsage {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
}

/**
 * Anthropic 原生格式同步响应
 * POST /managed-models/:id/anthropic 返回此格式 (无 response.Success 包装)
 */
export interface AnthropicResponse {
  id: string;
  /** "message" */
  type: string;
  /** "assistant" */
  role: string;
  content: AnthropicContentBlock[];
  model: string;
  stop_reason: string;
  stop_sequence?: string | null;
  usage: AnthropicUsage;
}

/** 提取所有 text 类型内容块的文本，拼接返回 */
export function anthropicResponseTextContent(r: AnthropicResponse): string {
  const parts: string[] = [];
  for (const b of r.content) {
    if (b.type === 'text' && b.text) parts.push(b.text);
  }
  return parts.join('');
}

/** 提取所有 thinking 类型内容块的文本，拼接返回 */
export function anthropicResponseThinkingContent(r: AnthropicResponse): string {
  const parts: string[] = [];
  for (const b of r.content) {
    if (b.type === 'thinking' && b.thinking) parts.push(b.thinking);
  }
  return parts.join('');
}

/** 返回所有 tool_use 类型的内容块 */
export function anthropicResponseToolUseBlocks(r: AnthropicResponse): AnthropicContentBlock[] {
  return r.content.filter((b) => b.type === 'tool_use');
}
