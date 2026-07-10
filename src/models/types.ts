// models/types.ts — 模型网关域类型。
//
// 端口自 acosmi-sdk-go/types.go (v0.19.0, 1275 行)
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

  /**
   * 桌面视觉理解 sidecar 能力 (v1.2+):
   * 为 true 表示该模型适合作为桌面截图解析 sidecar — 输入 screenshot,
   * 输出结构化 UI/视觉描述, 供非多模态主模型消费 (CrabCode desktop automation /
   * computer-use 选模型时使用).
   *
   * 与 ManagedModel.inputModalities=['image'] 是正交两件事:
   *   - inputModalities 描述"模型能不能吃图片输入"
   *   - supports_desktop_visual_understanding 描述"模型是不是被运营标记为
   *     适合做桌面 UI 解析的 sidecar" (有些通用视觉模型并不擅长 UI 解析)
   *
   * 调用方不应通过模型名 substring 推断此能力; 必须读上游下发字段.
   */
  supports_desktop_visual_understanding?: boolean;

  /**
   * 图片生成能力 (v1.3+): 为 true 表示该托管模型是图片生成模型 (DALL·E / SD / 即梦 等),
   * 应通过 client.generateImage() 调用, 而非 chat(). 计量维度由上游派生为 IMAGE (按图计费)。
   */
  supports_image_generation?: boolean;

  /**
   * 视频生成能力 (v1.3+): 为 true 表示该托管模型是视频生成模型 (Sora / 可灵 / Runway 等),
   * 应通过 client.generateVideo() + pollVideoTask() 调用。计量维度派生为 VIDEO (按时长计费)。
   */
  supports_video_generation?: boolean;

  /**
   * 向量能力 (v2.9+): 为 true 表示该托管模型是向量模型 (DashScope text-embedding-v4 等),
   * 应通过 client.embeddings() 调用。
   */
  supports_embedding?: boolean;

  /**
   * 重排序能力 (v2.9+): 为 true 表示该托管模型是重排序模型 (DashScope gte-rerank-v2 / qwen3-rerank 等),
   * 应通过 client.rerank() 调用。
   */
  supports_rerank?: boolean;
}

/** 图片生成请求 (client.generateImage) */
export interface ImageGenerationRequest {
  prompt: string;
  /** 缺省 1024 */
  width?: number;
  /** 缺省 1024 */
  height?: number;
  style?: string;
}

/** 图片生成响应 */
export interface ImageGenerationResponse {
  url?: string;
  b64_json?: string;
  revised_prompt?: string;
  requestId?: string;
}

/** 视频生成请求 (client.generateVideo) */
export interface VideoGenerationRequest {
  prompt: string;
  resolution?: string;
  /** 时长 (秒) */
  duration?: number;
}

/** 视频任务响应 (创建返回 taskId; 轮询返回 status/videoUrl) */
export interface VideoTaskResponse {
  taskId: string;
  /** pending | running | completed | failed */
  status?: string;
  videoUrl?: string;
  error?: string;
  requestId?: string;
}

// ── 向量 (Embedding) / 重排序 (Rerank) (v2.9.0) ──────────────────────────────
// SDK 订阅会员经 POST /managed-models/:id/{embeddings,rerank} 调用; 仅
// capabilities.supports_embedding / supports_rerank 的托管模型可用。上游接 DashScope。

/**
 * 多模态内容片段 (v2.10+; 向量/重排序 qwen3-vl-embedding / qwen3-vl-rerank 线路)。
 * text / image / video 至少填一项; image/video 取 URL 或 base64 data URI。
 */
export interface MultimodalContent {
  /** 文本片段 */
  text?: string;
  /** 图片 (URL 或 base64 data URI) */
  image?: string;
  /** 视频 (URL); 仅多模态线路支持 */
  video?: string;
}

/** 向量请求 (client.embeddings)。文本线路 = OpenAI /v1/embeddings 标准; 多模态线路用 contents。 */
export interface EmbeddingRequest {
  /** 文本输入 (文本向量线路): 单条文本或文本数组 (批量)。多模态线路改用 contents。 */
  input?: string | string[];
  /**
   * 多模态内容 (v2.10+; qwen3-vl-embedding 线路): text/image/video 片段数组。
   * 与 input 二选一; 多模态托管模型须用 contents。
   */
  contents?: MultimodalContent[];
  /** 向量维度 (可选; DashScope text-embedding-v4 支持 2048/1536/1024/768/512/256/128/64) */
  dimensions?: number;
  /** 编码格式 (可选, 如 "float") */
  encoding_format?: string;
  /** 输出向量类型 (可选; 多模态线路, 如 "dense") */
  output_type?: string;
  /** 视频抽帧率 fps (可选; 多模态视频输入) */
  fps?: number;
  /** 是否启用多模态特征融合 (可选; 多模态线路) */
  enable_fusion?: boolean;
}

/** 单条向量结果 (OpenAI 标准)。 */
export interface EmbeddingData {
  object: string;
  index: number;
  embedding: number[];
}

/** 向量响应 (OpenAI /v1/embeddings 标准)。 */
export interface EmbeddingResponse {
  object: string;
  model: string;
  data: EmbeddingData[];
  usage: { prompt_tokens?: number; total_tokens: number };
  id?: string;
}

/** 重排序查询 (v2.10+): 文本字符串, 或多模态 {text|image}。 */
export type RerankQuery = string | { text?: string; image?: string };
/** 重排序候选文档 (v2.10+): 文本字符串, 或多模态 {text|image|video}。 */
export type RerankDocument = string | MultimodalContent;

/** 重排序请求 (client.rerank)。统一扁平契约, 网关内部按模型线路转换。 */
export interface RerankRequest {
  /** 查询: 文本字符串 (文本线路), 或多模态 {text|image} (qwen3-vl-rerank 线路) */
  query: RerankQuery;
  /** 候选文档: 文本字符串数组, 或多模态 {text|image|video} 对象数组 */
  documents: RerankDocument[];
  /** 返回前 N 条 (可选; 缺省返回全部) */
  top_n?: number;
  /** 是否在结果中回传文档原文 (可选, 缺省 false) */
  return_documents?: boolean;
  /** 排序指令 (可选; 仅 OpenAI 兼容线路支持, 原生线路忽略) */
  instruct?: string;
  /** 视频抽帧率 fps (可选; 多模态视频文档) */
  fps?: number;
}

/** 单条重排序结果。 */
export interface RerankResult {
  /** 文档在原 documents 数组中的下标 */
  index: number;
  /** 相关性得分 (越高越相关) */
  relevance_score: number;
  /** 文档原文 (仅 return_documents=true 时存在) */
  document?: string;
}

/** 重排序响应。 */
export interface RerankResponse {
  results: RerankResult[];
  usage: { total_tokens: number };
  model?: string;
}

/**
 * 模型可接收的用户输入模态 (v1.2+).
 *
 * - 'text': 文本输入
 * - 'image': 截图 / 图片输入 (多模态)
 *
 * ManagedModel.inputModalities 包含 'image' 才允许向该模型直接发图;
 * 缺失字段时调用方应保守按 text-only / unknown 处理.
 */
export type InputModality = 'text' | 'image';

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
  /** @deprecated 公开 /managed-models 端点不返回此字段 (最小暴露原则); 仅 admin 响应或历史端口残留, listModels() 结果中恒为 undefined。 */
  pricePerMTok?: number;
  /** @deprecated 公开 /managed-models 端点不返回此字段 (最小暴露原则); 仅 admin 响应或历史端口残留, listModels() 结果中恒为 undefined。 */
  isDefault?: boolean;
  contextWindow?: number;
  capabilities: ModelCapabilities;

  /** P1 商品化档位门控: 0=FREE..4=ULTRA。前端模型选择器按用户档位过滤。 */
  minPlanTier?: number;
  /** 该模型能否在 C 端对话 (ADK 托管运行时) 使用; false 时选择器应过滤。 */
  chatRuntimeSupported?: boolean;
  /** 模型默认绑定的工具 ID 列表。 */
  defaultToolIds?: string[];
  /** 该模型对当前用户档位是否被限制策略锁定 (limit_policy allowedModels 不含)。true=展示但置灰+升级引导。enforced 关/解析失败=false。 */
  locked?: boolean;
  /** 是否属于"免费会员可用"分区 (FREE 档 allowedModels 内)。与当前用户档位无关 (仅分类)。 */
  freeTier?: boolean;

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

  /**
   * 模型可接收的用户输入模态 (v1.2+, CrabCode desktop automation / computer-use 选模型用).
   *
   * 取值: 'text' | 'image' 的子集. 'image' 表示模型可直接接收 screenshot/image 输入.
   *
   * 兼容上游字段名 input_modalities (snake_case) — listModels 在写缓存前会做归一化.
   *
   * **缺失语义**: 上游未下发时该字段为 undefined, 调用方必须保守按 text-only / unknown
   * 处理, 严禁默认假设支持 image. 同样严禁用模型名 substring 反推 modality.
   */
  inputModalities?: InputModality[];
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

/** 滚动窗口限额状态 — QuotaSummary.windowLimits 元素 */
export interface WindowLimitStatus {
  /** 窗口档位: FIVE_HOUR = 5 小时滚动窗口, WEEKLY = 7 天滚动窗口 */
  kind: 'FIVE_HOUR' | 'WEEKLY';
  /** 窗口内 credit 用量上限 */
  limitCredits: number;
  /** 窗口内已用 credit */
  usedCredits: number;
  /** 预计恢复时间 (ISO-8601 UTC); 窗口内无用量时为 null / 缺失 */
  resetAt?: string | null;
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
  /** 滚动窗口限额状态 (5 小时 / 7 天); 后端未启用窗口限额时字段整个缺失 */
  windowLimits?: WindowLimitStatus[];
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

  /**
   * v1.6.0: 业务侧终端用户 id, 跨 provider 通用语义 (不绑死 DeepSeek)。
   * 仅当 caller 拥有 scope=endusr.set 时网关采信; 否则被网关 sanitizer 校验/覆盖。
   * 约束: 长度 ≤ 512, 字符集 [a-zA-Z0-9_-]+, 禁止包含用户隐私信息。
   * 二选一:
   *   OpenAI wire → 序列化为顶层 body["user_id"]
   *   Anthropic wire → 合并到 body["metadata"]["user_id"]; caller metadata 显式键优先, 不被覆盖
   */
  endUserId?: string;
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
// ChatResponse
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
