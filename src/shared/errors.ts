// shared/errors.ts — 跨域类型化错误。
//
// 端口自 acosmi-sdk-go/types.go (v0.19.0) 的 Errors 段。

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
  /** 后端业务机器码 (响应体顶层 errorCode, e.g. "WINDOW_LIMIT_EXCEEDED"); 缺失为 undefined */
  errorCode?: string;
  /** 窗口限额场景: 触发的滚动窗口档位 (FIVE_HOUR = 5 小时 / WEEKLY = 7 天); 缺失为 undefined */
  windowKind?: 'FIVE_HOUR' | 'WEEKLY';
  /** 窗口限额场景: 预计恢复时间 (ISO-8601 UTC); 缺失为 undefined */
  windowResetAt?: string;

  constructor(
    statusCode: number,
    opts: {
      type?: string;
      message?: string;
      retryAfter?: number;
      body?: string;
      errorCode?: string;
      windowKind?: 'FIVE_HOUR' | 'WEEKLY';
      windowResetAt?: string;
    } = {},
  ) {
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
    this.errorCode = opts.errorCode;
    this.windowKind = opts.windowKind;
    this.windowResetAt = opts.windowResetAt;
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
// 窗口限额 (WINDOW_LIMIT_EXCEEDED) 识别
// =============================================================================

/** HTTP 路径窗口限额机器码 — 响应体顶层 errorCode / message 文案子串 (后端契约冻结值)。 */
const windowLimitErrorCode = 'WINDOW_LIMIT_EXCEEDED';
/** 流式路径窗口限额 code — agent-run SSE error 事件用小写蛇形 (与 HTTP errorCode 大小写不同)。 */
const windowLimitStreamCode = 'window_limit_exceeded';

/**
 * 判断错误是否为窗口限额拒绝 (5 小时 / 7 天滚动窗口 credit 用量达上限)。
 * 结构化 errorCode 优先, message/body 子串防御兜底 (后端部署版本错位期:
 * 旧网关只在 message 文案里带 "(WINDOW_LIMIT_EXCEEDED)" 而无顶层 errorCode)。
 *
 * 仅识别 HTTP 非 2xx 路径抛出的 HTTPError (/chat OpenAI 网关形态与 /anthropic
 * Anthropic 形态皆可)。流式场景 (agent-run SSE error 事件 / managed-model
 * failed 事件) 的 code 是小写 "window_limit_exceeded" 且产物不是 HTTPError,
 * 用伴生函数 isWindowLimitStreamError 判断。
 */
export function isWindowLimitError(err: unknown): err is HTTPError {
  if (!(err instanceof HTTPError)) return false;
  if (err.errorCode === windowLimitErrorCode) return true;
  // 防御兜底: 旧版后端无顶层 errorCode, 机器码只存活在 message 文案 / body 原串。
  return err.message.includes(windowLimitErrorCode) || err.body.includes(windowLimitErrorCode);
}

/**
 * isWindowLimitError 的流式伴生判断 — 面向 SSE error 事件产物
 * (StreamError / AgentRunStreamError / 裸 AgentRunErrorPayload) 的结构化鸭子判断。
 *
 * 入参形态跨三种且互无公共基类, 故返回 boolean 而非 type guard:
 * `code === "window_limit_exceeded"` 优先; message / userMessage / rawError
 * 含 "WINDOW_LIMIT_EXCEEDED" 子串防御兜底 (Anthropic 形态流错误事件只有
 * rate_limit_error type + 文案内机器码的部署错位期)。
 */
export function isWindowLimitStreamError(err: unknown): boolean {
  if (err == null || typeof err !== 'object') return false;
  const e = err as { code?: unknown; message?: unknown; userMessage?: unknown; rawError?: unknown };
  if (e.code === windowLimitStreamCode) return true;
  // 防御兜底 (后端部署版本错位期): 机器码只出现在文案 / 原始错误串。
  for (const field of [e.message, e.userMessage, e.rawError]) {
    if (typeof field === 'string' && field.includes(windowLimitErrorCode)) return true;
  }
  return false;
}
