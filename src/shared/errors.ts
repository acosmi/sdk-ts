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
