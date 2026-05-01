// types.ts — 端口自 acosmi-sdk-go/types.go (v0.19.0, 1275 行)
//
// 命名约定：
//   - 字段名 = Go json tag 字面量 (wire format), 不做 camelCase 重映射
//   - mix 风格 (modelId / max_tokens / supports_thinking) 是历史 wire 设计的真实样貌
//   - 这样 JSON.parse / JSON.stringify 可直接来回, 与 Go 侧 0 偏差
//
// int64 字段用 number — JS number 安全上限 2^53, Acosmi 业务量级远低于此。
// time.Time 字段用 ISO 8601 string 形态, 与 Go json wire 一致。
// json.RawMessage 用 unknown (caller 自行 typed)。
// json.Number 用 string (避免精度丢失)。

// =============================================================================
// OAuth
// =============================================================================

/** OAuth Authorization Server 元数据 (RFC 8414) */
export interface ServerMetadata {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  revocation_endpoint: string;
  registration_endpoint: string;
  scopes_supported: string[];
}

/** OAuth token 响应 */
export interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token?: string;
  scope?: string;
}

/** 持久化 token 对 */
export interface TokenSet {
  access_token: string;
  refresh_token: string;
  /** ISO 8601 格式 */
  expires_at: string;
  scope: string;
  client_id: string;
  server_url: string;
}

/** token 是否已过期 (提前 30 秒视为过期) */
export function tokenSetIsExpired(t: TokenSet): boolean {
  const expiresAt = new Date(t.expires_at).getTime();
  return Date.now() > expiresAt - 30_000;
}

/** 动态注册响应 */
export interface ClientRegistration {
  client_id: string;
  client_secret?: string;
}

// =============================================================================
// Managed Models
// =============================================================================

/** 模型能力矩阵 — 下游通过此结构决定 UI 功能开关和 Beta Header 注入 */
export interface ModelCapabilities {
  // 思考能力
  supports_thinking: boolean;
  supports_adaptive_thinking: boolean;
  /** 交错思考 (Interleaved Thinking) */
  supports_isp: boolean;

  // 工具与搜索
  supports_web_search: boolean;
  supports_tool_search: boolean;
  supports_structured_output: boolean;

  // 推理控制
  supports_effort: boolean;
  /** 模型是否支持 thinking_level="max" 强度档 (深度思考) */
  supports_max_effort: boolean;
  /** Opus 4.6 独有 (Speed="fast") */
  supports_fast_mode: boolean;
  /** Auto 模式 (模型自主选择工具/搜索策略) */
  supports_auto_mode: boolean;

  // 上下文与缓存
  supports_1m_context: boolean;
  supports_prompt_cache: boolean;
  /** 通过 context-management beta 控制 */
  supports_cache_editing: boolean;

  // 输出控制
  /** Claude 4 内置 */
  supports_token_efficient: boolean;
  supports_redact_thinking: boolean;

  // Token 上限 (冗余但便于查询)
  max_input_tokens: number;
  max_output_tokens: number;
}

/** BucketClass 字面量常量 — V30 二轮审计 D-P1-3 修复 */
export const BucketClassCommercial = 'COMMERCIAL';
export const BucketClassGeneric = 'GENERIC';

/**
 * 用户在某 modelId 上的桶余额聚合视图 (V30 entitlement-listing).
 *
 * 多桶聚合规则 (上游 nexus-v4 计算后下发, 全部单位为 ETU):
 *   - quotaEtu / usedEtu / remainingEtu: 该 modelId 下用户全部 active 桶求和
 *   - sharedPoolEtu: 求和量中"来自通配桶"的部分 (跨模型可消耗)
 *   - bucketClass / expiresAt: 取最高优先级桶
 *   - expired: 全部桶都过期才置 true
 */
export interface BucketInfo {
  quotaEtu: number;
  usedEtu: number;
  remainingEtu: number;
  sharedPoolEtu?: number;
  expiresAt?: string;
  bucketClass: string;
  expired?: boolean;
  /** v0.19+ — GENERIC alive 桶 tokenRemaining 求和 ("免费余额", 真实可消费) */
  freeRemainingEtu: number;
  /** v0.19+ — COMMERCIAL alive 桶 tokenRemaining 求和 ("付费余额") */
  paidRemainingEtu: number;
}

/** 大小写不敏感判定 — 与 buildBucketView (managed_model.go) EqualFold 语义对齐 */
export function bucketInfoIsCommercial(b: BucketInfo | null | undefined): boolean {
  if (!b) return false;
  return b.bucketClass.toLowerCase() === BucketClassCommercial.toLowerCase();
}

/** 托管模型 */
export interface ManagedModel {
  id: string;
  name: string;
  provider: string;
  modelId: string;
  maxTokens: number;
  isEnabled: boolean;
  pricePerMTok?: number;
  isDefault?: boolean;
  contextWindow?: number;
  capabilities: ModelCapabilities;

  /**
   * 上游 gateway 为此模型启用的请求格式列表
   * 取值: "anthropic" | "openai"
   * 空值表示上游未声明, SDK 回落 provider 硬编码分支 (向后兼容)
   */
  supported_formats?: string[];

  /**
   * 上游建议客户端优先使用的格式
   * 取值: "anthropic" | "openai"; 空值等价于 supported_formats[0]
   */
  preferred_format?: string;

  /**
   * 当前用户在此模型上的桶余额聚合 (V0.18 V30 entitlement-listing).
   *
   * 仅当调用方为非 admin 用户 (web user / desktop OAuth) 时上游才会返回此字段:
   *   - admin / X-Internal-Bypass 调用 → 缺失
   *   - 普通用户 → 非空, 含 quota/used/remaining 求和
   */
  bucketInfo?: BucketInfo;
}

// =============================================================================
// QuotaSummary — v0.19+ 账户级权益总览 (免费/付费切分)
// =============================================================================

/** 单桶视图 — QuotaSummary.freeBuckets/paidBuckets 元素 */
export interface BucketRow {
  bucketId: string;
  /** 精确桶为具体 modelId, 通配桶为 "*" */
  modelId: string;
  /** COMMERCIAL | GENERIC */
  bucketClass: string;
  tokenQuota: number;
  tokenUsed: number;
  tokenRemaining: number;
  /** 永久桶为 undefined */
  expiresAt?: string;
  expired?: boolean;
}

export function bucketRowIsCommercial(r: BucketRow | null | undefined): boolean {
  if (!r) return false;
  return r.bucketClass.toLowerCase() === BucketClassCommercial.toLowerCase();
}

/**
 * GET /api/v4/entitlements/quota-summary 返回体, 调用 client.getQuotaSummary 获取.
 *
 * 设计目的: 个人中心钱包栏一次性展示"我还有多少免费 + 多少付费"+ 各自最近到期时间.
 */
export interface QuotaSummary {
  /** GENERIC (免费/赠送) alive 桶 tokenRemaining 求和 */
  freeTotalEtu: number;
  /** COMMERCIAL (付费购买) alive 桶 tokenRemaining 求和 */
  paidTotalEtu: number;
  /** GENERIC 桶详情 (含过期, UI 列流水); 空时为空数组 */
  freeBuckets: BucketRow[];
  /** COMMERCIAL 桶详情 (含过期); 空时为空数组 */
  paidBuckets: BucketRow[];
  /** GENERIC alive 桶中最早到期; 永久桶/无 alive 时缺失 */
  nextFreeExpiresAt?: string;
  /** COMMERCIAL alive 桶中最早到期; 同上 */
  nextPaidExpiresAt?: string;
}

// =============================================================================
// Chat
// =============================================================================

/** 聊天消息 (简单文本格式, CrabClaw 使用) */
export interface ChatMessage {
  role: string;
  content: string;
}

/** Anthropic 响应内容块 */
export interface ChatContentBlock {
  type: string;
  text?: string;
  citations?: unknown;
  thinking?: string;
  signature?: string;
  data?: string;
  id?: string;
  name?: string;
  /** json.RawMessage in Go */
  input?: unknown;
  server_name?: string;
  caller?: unknown;
  tool_use_id?: string;
  content?: unknown;
  is_error?: boolean;
}

/** Anthropic 格式 token 用量 */
export interface ChatUsage {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
}

// ---------- Thinking ----------

/** 三档思考级别 (v0.9.0) */
export const ThinkingOff = 'off';
export const ThinkingHigh = 'high';
export const ThinkingMax = 'max';

/** 标准思考最低 maxTokens — CrabCode 默认 MAX_OUTPUT_TOKENS_DEFAULT = 32_000 */
export const ThinkingHighMinMaxTokens = 32_000;
/** 深度思考回退 maxTokens — Opus 4.6 上限 128K */
export const ThinkingMaxFallbackMaxTokens = 128_000;

/** 控制模型思考行为 */
export interface ThinkingConfig {
  /** "enabled" | "disabled" | "adaptive" */
  type: string;
  /** 仅 type="enabled" 时 (旧模型回退) */
  budget_tokens?: number;
  /** 思考级别 (v0.9.0): "off" | "high" | "max" */
  level?: string;
  /** "none" | "summary" | "" (默认空=完整) */
  display?: string;
}

/** 根据三档 level 创建配置 */
export function newThinkingConfig(level: string): ThinkingConfig {
  if (level === '' || level === ThinkingOff) {
    return { type: 'disabled' };
  }
  return { type: 'adaptive', level };
}

/** 服务端工具定义 — SDK 将工具 schema 合入 API 请求的 tools 数组 */
export interface ServerTool {
  type: string;
  name: string;
  config?: Record<string, unknown>;
}

/** Server Tool 类型常量 */
export const ServerToolTypeWebSearch = 'web_search_20250305';

/** 地理位置 */
export interface GeoLoc {
  /** ISO 3166-1 alpha-2 */
  country: string;
  city?: string;
}

/** ServerTool.config 结构 (type=web_search_20250305) */
export interface WebSearchConfig {
  /** 每请求最大搜索次数, 默认 8 */
  max_uses?: number;
  /** 域名白名单 (与 blocked_domains 互斥) */
  allowed_domains?: string[];
  /** 域名黑名单 (与 allowed_domains 互斥) */
  blocked_domains?: string[];
  user_location?: GeoLoc;
}

/** 控制推理努力级别 */
export interface EffortConfig {
  /** "low" | "medium" | "high" | "max" */
  level: string;
}

/** 控制输出格式 (结构化输出) */
export interface OutputConfig {
  /** "json_schema" | "" */
  format?: string;
  schema?: unknown;
}

/**
 * 创建搜索 Server Tool 的便捷方法
 * allowed_domains 与 blocked_domains 互斥, 同时传入抛 Error
 */
export function newWebSearchTool(cfg?: WebSearchConfig | null): ServerTool {
  const st: ServerTool = {
    type: ServerToolTypeWebSearch,
    name: 'web_search',
  };
  if (cfg) {
    if ((cfg.allowed_domains?.length ?? 0) > 0 && (cfg.blocked_domains?.length ?? 0) > 0) {
      throw new Error('web search: allowed_domains and blocked_domains are mutually exclusive');
    }
    const m: Record<string, unknown> = {};
    if (cfg.max_uses && cfg.max_uses > 0) m['max_uses'] = cfg.max_uses;
    if (cfg.allowed_domains?.length) m['allowed_domains'] = cfg.allowed_domains;
    if (cfg.blocked_domains?.length) m['blocked_domains'] = cfg.blocked_domains;
    if (cfg.user_location) m['user_location'] = cfg.user_location;
    if (Object.keys(m).length > 0) st.config = m;
  }
  return st;
}

/**
 * 聊天请求
 *
 * 基础字段供 CrabClaw 使用, 扩展字段供 CrabCode 使用。
 * 所有新增字段零值不改变行为 (向后兼容)。
 *
 * 注意：扩展字段（rawMessages/system/tools/...）不会被原样 JSON.stringify,
 * 而由 buildRequestBody (adapter) 选择性序列化到请求体。
 */
export interface ChatRequest {
  // ── 基础字段 (CrabClaw 兼容) ──
  messages?: ChatMessage[];
  stream?: boolean;
  max_tokens?: number;

  // ── 完整请求控制 (CrabCode 扩展) ── 不直接 JSON 序列化, 由 buildRequestBody 处理
  /** 复杂消息体 (含 content blocks / 多模态), 非 nil 时优先于 messages */
  rawMessages?: unknown;
  /** string 或 ContentBlock[] */
  system?: unknown;
  /** 标准工具定义 (Tool[]) */
  tools?: unknown;
  temperature?: number;
  thinking?: ThinkingConfig;
  metadata?: Record<string, string>;
  /** 显式 beta (SDK 自动合并) */
  betas?: string[];
  /** 服务端工具 (buildRequestBody 合入 tools 数组) */
  serverTools?: ServerTool[];
  /** "" | "fast" (Fast Mode) */
  speed?: string;
  effort?: EffortConfig;
  outputConfig?: OutputConfig;
  /** 任意扩展字段 (buildRequestBody 合入请求体) */
  extraBody?: Record<string, unknown>;

  /**
   * v0.13.0: OpenAI wire format 原生字段。AnthropicAdapter 忽略,
   * OpenAIAdapter 按 OpenAI 规范序列化。
   *
   * 对应 OpenAI `parallel_tool_calls` 顶层字段, undefined = 不设置 (沿用上游默认 true)。
   */
  parallelToolCalls?: boolean;
}

// ---------- Web Search Sources ----------

/** 联网搜索结果来源 (与后端 adk/stream_helpers.go SourceItem 对齐) */
export interface WebSearchSource {
  title: string;
  url: string;
  snippet?: string;
}

/** 搜索来源事件 (从 SSE "sources" 事件解析) */
export interface SourcesEvent {
  sources: WebSearchSource[];
  session_id?: string;
}

/**
 * 从 StreamEvent 中解析搜索来源
 * 返回 null 表示该事件不是 sources 类型
 */
export function parseSourcesEvent(ev: StreamEvent): SourcesEvent | null {
  let wrapper: { type?: string; sources?: WebSearchSource[]; session_id?: string };
  try {
    wrapper = JSON.parse(ev.data);
  } catch {
    return null;
  }
  if (wrapper.type !== 'sources' && ev.event !== 'sources') {
    return null;
  }
  if (!wrapper.sources || wrapper.sources.length === 0) {
    return null;
  }
  return { sources: wrapper.sources, session_id: wrapper.session_id };
}

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
  choices: OpenAIStreamChoice[];
  usage?: OpenAIUsage;
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

// =============================================================================
// ChatResponse / AnthropicResponse
// =============================================================================

/**
 * 同步聊天响应 (Anthropic format, v0.4.1)
 *
 * tokenRemaining / callRemaining / modelTokenRemaining* 不在 wire JSON 中, 由 client 从 Header 填充。
 * 哨兵 -1 表示服务端未返回。
 */
export interface ChatResponse {
  id: string;
  type: string;
  model: string;
  role: string;
  content: ChatContentBlock[];
  stop_reason: string;
  usage: ChatUsage;
  /** -1 表示服务端未返回 */
  tokenRemaining: number;
  callRemaining: number;
  modelTokenRemaining: number;
  modelTokenRemainingETU: number;
}

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

// =============================================================================
// SSE Stream
// =============================================================================

/**
 * SSE 流式事件
 *
 * v0.11.0 新增 blockIndex/blockType/ephemeral 三字段 (in-band content block 元数据)。
 * 零值等价 v0.10.0 行为, 未识别的事件三字段全部零值。
 */
export interface StreamEvent {
  event: string;
  data: string;
  /** 对齐 Anthropic content_block_start/delta/stop 的 index 字段 */
  blockIndex?: number;
  /** 由 content_block_start 解析得到, delta/stop 从 index→type 映射查出 */
  blockType?: string;
  /** 网关标记此 block 下一轮不应回传 */
  ephemeral?: boolean;
}

/**
 * 流式结算事件 (从 settled SSE 事件解析)
 * 包含本次请求的 token 消耗及结算后的剩余余额
 */
export interface StreamSettlement {
  requestId: string;
  consumeStatus: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  /** 结算后剩余 token (-1 表示服务端未返回) */
  tokenRemaining: number;
  /** 结算后剩余调用次数 (-1 表示服务端未返回) */
  callRemaining: number;
}

/** 从 settled 类型的 StreamEvent 中解析结算信息. 不是 settled 类型则返回 null. */
export function parseSettlement(ev: StreamEvent): StreamSettlement | null {
  if (ev.event !== 'settled' && ev.event !== 'pending_settle') {
    return null;
  }
  let s: Partial<StreamSettlement>;
  try {
    s = JSON.parse(ev.data);
  } catch {
    return null;
  }
  return {
    requestId: s.requestId ?? '',
    consumeStatus: s.consumeStatus ?? '',
    inputTokens: s.inputTokens ?? 0,
    outputTokens: s.outputTokens ?? 0,
    totalTokens: s.totalTokens ?? 0,
    tokenRemaining: s.tokenRemaining ?? -1,
    callRemaining: s.callRemaining ?? -1,
  };
}

// =============================================================================
// Entitlements
// =============================================================================

/** 权益余额 (聚合) */
export interface EntitlementBalance {
  totalTokenQuota: number;
  totalTokenUsed: number;
  totalTokenRemaining: number;
  totalCallQuota: number;
  totalCallUsed: number;
  totalCallRemaining: number;
  activeEntitlements: number;
}

/** 单条权益明细 */
export interface EntitlementItem {
  id: string;
  type: string;
  status: string;
  tokenQuota: number;
  tokenUsed: number;
  tokenRemaining: number;
  callQuota: number;
  callUsed: number;
  callRemaining: number;
  expiresAt?: string;
  sourceId?: string;
  sourceType?: string;
  remark?: string;
  createdAt: string;
}

/** 详细余额 (含每条权益明细) */
export interface BalanceDetail {
  totalTokenQuota: number;
  totalTokenUsed: number;
  totalTokenRemaining: number;
  totalCallQuota: number;
  totalCallUsed: number;
  totalCallRemaining: number;
  activeEntitlements: number;
  entitlements: EntitlementItem[];
}

/** 核销记录 */
export interface ConsumeRecord {
  id: string;
  entitlementId: string;
  requestId: string;
  modelId?: string;
  tokensConsumed: number;
  status: string;
  createdAt: string;
}

/** 核销记录分页响应 */
export interface ConsumeRecordPage {
  records: ConsumeRecord[];
  total: number;
  page: number;
  pageSize: number;
}

// =============================================================================
// V29 Per-Model Bucket
// =============================================================================

/**
 * 单桶视图 (用户多桶 hero / 模型切换提示用)
 *
 * 字段名仍叫 ETU 但 T3 死代码清除后 = raw token (V29 系数管理已退役)。
 */
export interface ModelBucket {
  bucketId: string;
  entitlementId: string;
  /** "*" = 通配 */
  modelId: string;
  /** COMMERCIAL / GENERIC */
  bucketClass: string;
  tokenQuota: number;
  tokenUsed: number;
  tokenRemaining: number;
  callQuota: number;
  callUsed: number;
  callRemaining: number;
  allowedModelsJson?: string;
}

/** GetByModel 响应; primaryBucket 在 bucketId 为空时表示无可用桶。 */
export interface ModelByQuotaResponse {
  modelId: string;
  /** 折算后剩余 (调度判定用) */
  etuRemaining: number;
  /** 反系数估算的原始 token (UI 展示用) */
  rawTokenRemaining: number;
  hasQuota: boolean;
  primaryBucket?: ModelBucket;
}

/** 单条模型系数 (SDK TTL 8s 缓存源) */
export interface ModelCoefficient {
  modelId: string;
  tenantId: string;
  inputCoef: number;
  outputCoef: number;
  cacheReadCoef: number;
  cacheCreationCoef: number;
  version: number;
  effectiveAt: string;
}

// =============================================================================
// Token Packages (商城)
// =============================================================================

/** 流量包商品。price 用 string (Go json.Number) 避免浮点精度丢失。 */
export interface TokenPackage {
  id: string;
  name: string;
  description?: string;
  tokenQuota: number;
  callQuota?: number;
  price: string;
  validDays: number;
  isEnabled: boolean;
  sortOrder?: number;
}

/** 订单。amount 用 string (Go json.Number) 避免精度丢失。 */
export interface Order {
  id: string;
  packageId: string;
  packageName?: string;
  amount: string;
  status: string;
  payUrl?: string;
  createdAt: string;
}

/** 订单状态 */
export interface OrderStatus {
  orderId: string;
  status: string;
}

/** 下单请求 */
export interface PayPayload {
  payMethod?: string;
}

// =============================================================================
// Wallet (钱包)
// =============================================================================

/** 钱包统计。金额使用 string (Go json.Number) 避免浮点精度丢失 (金融安全) */
export interface WalletStats {
  balance: string;
  monthlyConsumption: string;
  monthlyRecharge: string;
  transactionCount: number;
}

/** 交易记录 */
export interface Transaction {
  id: string;
  type: string;
  amount: string;
  remark?: string;
  createdAt: string;
}

// =============================================================================
// Skill Store
// =============================================================================

export interface SkillStoreItem {
  id: string;
  pluginId: string;
  key: string;
  name: string;
  description: string;
  icon: string;
  category: string;
  inputSchema: string;
  outputSchema: string;
  timeout: number;
  retryCount: number;
  retryDelay: number;
  version: string;
  totalCalls: number;
  avgDurationMs: number;
  successRate: number;
  isEnabled: boolean;
  securityLevel: string;
  securityScore: number;
  scope: string;
  status: string;
  downloadCount: number;
  readme: string;
  tags: string[];
  author: string;
  publisherId: string;
  isPublished: boolean;
  pluginName: string;
  pluginIcon: string;
  updatedAt: string;
  visibility?: string;
  certificationStatus?: string;
  source?: string;
}

/** 技能商店搜索参数 (非 wire 类型, 用于 client 方法参数) */
export interface SkillStoreQuery {
  category?: string;
  keyword?: string;
  tag?: string;
}

/** 技能统计概览 */
export interface SkillSummary {
  installed: number;
  created: number;
  total: number;
  storeAvailable: number;
}

/** 技能商店分页浏览响应 */
export interface SkillBrowseResponse {
  items: SkillStoreItem[];
  total: number;
  page: number;
  pageSize: number;
}

/**
 * 技能商店列表项（轻量，仅含浏览所需字段）
 * 配合服务端 fields=minimal 参数使用，响应体积缩减 90%+
 */
export interface SkillStoreListItem {
  id: string;
  key: string;
  name: string;
  description: string;
  icon: string;
  category: string;
  version: string;
  author: string;
  downloadCount: number;
  tags: string[];
  certificationStatus?: string;
  visibility?: string;
  source?: string;
  updatedAt: string;
}

/** 技能商店轻量浏览响应 */
export interface SkillBrowseListResponse {
  items: SkillStoreListItem[];
  total: number;
  page: number;
  pageSize: number;
}

/** 技能认证状态响应 */
export interface CertificationStatus {
  skillId: string;
  certificationStatus: string;
  certifiedAt?: number;
  securityLevel?: string;
  securityScore: number;
  report?: unknown;
}

// =============================================================================
// Skill Generator
// =============================================================================

export interface GenerateSkillRequest {
  purpose: string;
  examples?: string[];
  inputHints?: string;
  outputHints?: string;
  category?: string;
  language?: string;
}

export interface GenerateSkillResult {
  skillName: string;
  skillKey: string;
  description: string;
  skillMd: string;
  inputSchema: string;
  outputSchema: string;
  testCases: string[];
  readme: string;
  category: string;
  tags: string[];
  timeout: number;
}

export interface OptimizeSkillRequest {
  skillName: string;
  description?: string;
  inputSchema?: string;
  outputSchema?: string;
  readme?: string;
  aspects?: string[];
}

export interface OptimizeSkillResult {
  optimizedSkill: GenerateSkillResult;
  changes: string[];
  score: number;
}

// =============================================================================
// Unified Tools
// =============================================================================

export interface ToolView {
  id: string;
  key: string;
  name: string;
  description: string;
  icon: string;
  category: string;
  inputSchema: string;
  outputSchema: string;
  timeout: number;
  isEnabled: boolean;
  provider?: ToolProvider;
}

export interface ToolProvider {
  id: string;
  name: string;
  icon: string;
  sourceType: string;
  mcpEndpoint?: string;
  isEnabled: boolean;
}

export interface ToolListResponse {
  skills: ToolView[];
  total: number;
}

// =============================================================================
// Errors (类型化)
// =============================================================================

/** 下载限流错误 (429) */
export class RateLimitError extends Error {
  retryAfter: string;
  raw: string;

  constructor(message: string, retryAfter: string, raw: string) {
    super(message);
    this.name = 'RateLimitError';
    this.retryAfter = retryAfter;
    this.raw = raw;
  }
}

/**
 * API 业务层错误 (HTTP 200 但 code != 0)
 * tk-dist 代理透传 yudao 响应, HTTP 状态码为 200, 业务错误在 JSON code 字段
 */
export class BusinessError extends Error {
  code: number;

  constructor(code: number, message: string) {
    super(`API error (code=${code}): ${message}`);
    this.name = 'BusinessError';
    this.code = code;
  }
}

/**
 * 订单到达非成功终态 (FAILED/CANCELLED/CLOSED/EXPIRED/REFUNDED)
 * waitForPayment 在订单终态为非成功时抛此错误
 */
export class OrderTerminalError extends Error {
  orderId: string;
  status: string;

  constructor(orderId: string, status: string) {
    super(`order ${orderId} terminated: ${status}`);
    this.name = 'OrderTerminalError';
    this.orderId = orderId;
    this.status = status;
  }
}

/**
 * 模型缓存未命中且 listModels 刷新后仍未找到。
 *
 * 历史上 getCachedModel miss 时硬返 ManagedModel{provider:"anthropic"} 占位,
 * 导致未预热场景下的 chat 请求按 AnthropicAdapter 编码, 被发到错误端点。
 * v0.13.x 改为 miss → listModels 自动刷新一次; 仍 miss → 抛此错误。
 */
export class ModelNotFoundError extends Error {
  modelId: string;

  constructor(modelId: string) {
    super(`managed model "${modelId}" not found (list models to refresh cache, or verify model id)`);
    this.name = 'ModelNotFoundError';
    this.modelId = modelId;
  }
}

/**
 * 结构化 HTTP 非 2xx 错误.
 *
 * 用 instanceof 提取:
 *   try { ... } catch (e) {
 *     if (e instanceof HTTPError && e.statusCode === 429) { ... }
 *   }
 */
export class HTTPError extends Error {
  statusCode: number;
  /** anthropic.error.type / openai.error.type, 缺失为空 */
  type: string;
  /** Retry-After 头解析的秒数, 0 表示未提供或解析失败 */
  retryAfter: number;
  /** 原始响应体 (截断到 maxErrorBodySize) */
  body: string;

  constructor(statusCode: number, opts: { type?: string; message?: string; retryAfter?: number; body?: string } = {}) {
    let msg: string;
    if (opts.type) {
      msg = `HTTP ${statusCode}: [${opts.type}] ${opts.message ?? ''}`;
    } else if (opts.message) {
      msg = `HTTP ${statusCode}: ${opts.message}`;
    } else if (opts.body) {
      msg = `HTTP ${statusCode}: ${opts.body}`;
    } else {
      msg = `HTTP ${statusCode}`;
    }
    super(msg);
    this.name = 'HTTPError';
    this.statusCode = statusCode;
    this.type = opts.type ?? '';
    this.retryAfter = opts.retryAfter ?? 0;
    this.body = opts.body ?? '';
  }
}

/**
 * 结构化网络层错误 (传输失败, 区别于上游业务错误).
 *
 * 包装 fetch 抛出的错误 — 含 timeout / EOF / connection refused / DNS 失败等.
 * retry policy: isTimeout / isEOF 任一为 true → 默认可重试.
 */
export class NetworkError extends Error {
  /** 操作描述, e.g. "POST /v1/messages" */
  op: string;
  /** 请求 URL (脱敏后) */
  url: string;
  override cause?: unknown;
  timeout: boolean;
  eof: boolean;

  constructor(op: string, url: string, cause: unknown, opts: { timeout?: boolean; eof?: boolean } = {}) {
    const causeMsg = cause instanceof Error ? cause.message : cause != null ? String(cause) : 'network error';
    super(`${op} ${url}: ${causeMsg}`);
    this.name = 'NetworkError';
    this.op = op;
    this.url = url;
    this.cause = cause;
    this.timeout = opts.timeout ?? false;
    this.eof = opts.eof ?? false;
  }

  isTimeout(): boolean {
    return this.timeout;
  }

  isEOF(): boolean {
    return this.eof;
  }
}

/**
 * 流式失败事件的结构化表示。
 *
 * 由 gateway 的 `managed_model_stream_failed` 事件解析得到。客户端可通过
 * instanceof 提取并按 code/retryable 决策。
 */
export class StreamError extends Error {
  /** 例: "empty_response" / "rate_limit" / "overloaded" / "" */
  code: string;
  /** 例: "provider" / "settlement" */
  stage: string;
  /** 用户友好提示 (中文); 历史字段, 与 rawError 区分 */
  userMessage: string;
  /** gateway 原始 error 字符串 */
  rawError: string;
  /** 客户端是否值得重试 */
  retryable: boolean;

  constructor(opts: { code?: string; stage?: string; message?: string; rawError?: string; retryable?: boolean } = {}) {
    const code = opts.code ?? '';
    const stage = opts.stage ?? '';
    const userMessage = opts.message ?? '';
    const rawError = opts.rawError ?? '';
    const retryable = opts.retryable ?? false;

    const body = rawError !== '' ? rawError : userMessage;
    const msg = stage !== '' ? `stream failed: ${stage}: ${body}` : `stream failed: ${body}`;
    super(msg);
    this.name = 'StreamError';
    this.code = code;
    this.stage = stage;
    this.userMessage = userMessage;
    this.rawError = rawError;
    this.retryable = retryable;
  }
}

// =============================================================================
// API Response Wrapper
// =============================================================================

/** nexus-v4 标准响应。兼容 yudao 格式 (msg) 和 nexus-v4 格式 (message) */
export interface APIResponse<T> {
  code: number;
  message?: string;
  msg?: string;
  data: T;
}

/** 优先返回 message, 降级到 msg (兼容 yudao 透传) */
export function apiResponseGetMessage<T>(r: APIResponse<T>): string {
  return r.message ?? r.msg ?? '';
}

/** 检查业务层错误码 — code != 0 时抛 BusinessError */
export function apiResponseBusinessError<T>(r: APIResponse<T>): BusinessError | null {
  if (r.code !== 0) {
    return new BusinessError(r.code, apiResponseGetMessage(r));
  }
  return null;
}

/** yudao 分页响应格式 (tk-dist 代理透传) */
export interface YudaoPageResult<T> {
  list: T[];
  total: number;
}

// =============================================================================
// Notifications
// =============================================================================

/** 单条通知 */
export interface Notification {
  id: string;
  title: string;
  content: string;
  /** system | billing | security | task | commission | entitlement */
  type: string;
  isRead: boolean;
  createdAt: string;
}

/** 分页通知列表 */
export interface NotificationList {
  list: Notification[];
  unreadCount: number;
  total: number;
  page: number;
  pageSize: number;
}

/** 未读通知计数 */
export interface NotificationUnreadCount {
  unreadCount: number;
}

/** 通知偏好 (按类型+渠道) */
export interface NotificationPreference {
  typeCode: string;
  channelInApp: boolean;
  channelEmail: boolean;
  channelSms: boolean;
  channelPush: boolean;
}

/** 推送设备注册 */
export interface DeviceRegistration {
  /** android | ios | harmony */
  platform: string;
  token: string;
  appVersion: string;
}

// =============================================================================
// WebSocket 类型 (forward-declared 这里, 实现在 ws.ts)
// =============================================================================

/** 服务端推送事件 */
export interface WSEvent {
  type: string;
  topic?: string;
  /** json.RawMessage in Go */
  data?: unknown;
  connId?: string;
  timestamp?: string;
  message?: string;
}

/**
 * 从 WSEvent 中解析通知
 * 返回 null 表示该事件不是系统通知
 */
export function parseNotificationEvent(ev: WSEvent): Notification | null {
  if (ev.type !== 'event' || ev.topic !== 'system') {
    return null;
  }
  if (ev.data == null) return null;
  let n: Notification;
  try {
    // ev.data 在 wire 上是 raw JSON, 但 JSON.parse 接收 string;
    // 接收方反序列化时可能已经是对象。两种形态都接住:
    if (typeof ev.data === 'string') {
      n = JSON.parse(ev.data);
    } else {
      n = ev.data as Notification;
    }
  } catch {
    return null;
  }
  if (!n.id) return null;
  return n;
}
