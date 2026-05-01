// client-helpers.ts — Client 内部辅助函数
// 端口自 acosmi-sdk-go/client.go 中的: parseHTTPError / classifyTransport /
// parseStreamError / isOrderSuccess / isOrderTerminal / 安全限制常量 / SSE 行扫描器
//
// 这些函数在 Go 侧是 client.go 内部 unexported, 拆出独立文件以让 client.ts 不必再大。

import { HTTPError, NetworkError, StreamError } from './types';

// =============================================================================
// 安全限制常量 (端口自 acosmi-sdk-go/client.go 安全限制常量)
// =============================================================================

/** 50MB — 技能 ZIP 包最大下载体积 */
export const maxDownloadSize = 50 * 1024 * 1024;
/** 1MB — 错误响应体最大读取量 */
export const maxErrorBodySize = 1 * 1024 * 1024;
/** 1MB — SSE 单行最大长度 (大 JSON chunk) */
export const maxSSELineSize = 1 * 1024 * 1024;
/** 模型列表缓存有效期 (ms) */
export const modelCacheTTLMs = 5 * 60 * 1000;
/** V29 系数缓存 (TTL 8s) */
export const coefCacheTTLMs = 8 * 1000;

// =============================================================================
// HTTP 错误解析
// =============================================================================

/**
 * 解析 HTTP 错误响应体，兼容 Anthropic 和 OpenAI 错误格式
 * Anthropic: {"type":"error","error":{"type":"...","message":"..."}}
 * OpenAI:    {"error":{"message":"...","type":"...","code":"..."}}
 * 通用回退: HTTP {status}: {body}
 */
export function parseHTTPError(statusCode: number, body: Uint8Array | string): HTTPError {
  return parseHTTPErrorWithHeader(statusCode, body, null);
}

/**
 * 同 parseHTTPError 但额外解析 Retry-After 头到 HTTPError.retryAfter.
 * retry policy 用此字段做指数退避降级.
 */
export function parseHTTPErrorWithHeader(
  statusCode: number,
  body: Uint8Array | string,
  header: Headers | null,
): HTTPError {
  const bodyStr = typeof body === 'string' ? body : new TextDecoder().decode(body);

  let retryAfter = 0;
  if (header) {
    const ra = header.get('Retry-After');
    if (ra) {
      const sec = parseInt(ra, 10);
      if (!isNaN(sec) && sec > 0) retryAfter = sec;
    }
  }

  if (bodyStr.length === 0) {
    return new HTTPError(statusCode, { retryAfter });
  }

  let type = '';
  let message = '';
  try {
    const obj = JSON.parse(bodyStr);
    if (obj && typeof obj === 'object') {
      const errObj = (obj as { error?: unknown }).error;
      if (errObj && typeof errObj === 'object') {
        const e = errObj as { message?: unknown; type?: unknown };
        if (typeof e.message === 'string') message = e.message;
        if (typeof e.type === 'string') type = e.type;
      }
    }
  } catch {
    // 非 JSON, body 原样保留
  }

  return new HTTPError(statusCode, { type, message, retryAfter, body: bodyStr });
}

// =============================================================================
// 网络错误分类
// =============================================================================

/**
 * 包装 fetch 抛出的 err 为 NetworkError, 便于 retry policy 判定.
 *
 * 分类规则:
 *   - AbortError 由 ctx.signal 触发 → Timeout=true
 *   - "fetch failed" / "ECONNRESET" / "EOF" / "broken pipe" → EOF=true
 *   - 其他: Timeout/EOF 都 false (不重试)
 */
export function classifyTransport(op: string, urlStr: string, err: unknown): NetworkError {
  const ne = new NetworkError(op, urlStr, err);
  if (err instanceof Error) {
    // AbortError (fetch + AbortController)
    if (err.name === 'AbortError') {
      ne.timeout = true;
      return ne;
    }
    // Node fetch undici cause
    const cause = (err as Error & { cause?: { code?: string; name?: string } }).cause;
    if (cause) {
      if (cause.code === 'UND_ERR_CONNECT_TIMEOUT' || cause.code === 'UND_ERR_HEADERS_TIMEOUT' || cause.code === 'ETIMEDOUT') {
        ne.timeout = true;
        return ne;
      }
      if (cause.code === 'ECONNRESET' || cause.code === 'EPIPE' || cause.code === 'ECONNREFUSED' || cause.code === 'EAI_AGAIN') {
        ne.eof = true;
        return ne;
      }
    }
    const msg = err.message;
    if (msg.includes('EOF') || msg.includes('connection reset') || msg.includes('broken pipe')) {
      ne.eof = true;
    }
  }
  return ne;
}

// =============================================================================
// Stream Error 解析
// =============================================================================

/**
 * 从 failed/error 事件 JSON 中提取结构化错误.
 *
 * 兼容三种 schema (按优先级):
 *
 *  1. acosmi managed-model 协议 ("event: failed"):
 *     {errorCode, stage, error: <string>, message, retryable}
 *
 *  2. Anthropic 协议扩展 ("event: error", v0.14.1 起):
 *     {type:"error", error:{type, message}, errorCode, retryable, message, stage}
 *
 *  3. Anthropic 标准纯净格式 (老网关 / 官方上游直返):
 *     {type:"error", error:{type, message}}
 */
export function parseStreamError(data: string): StreamError {
  let payload: {
    errorCode?: string;
    stage?: string;
    error?: unknown;
    message?: string;
    retryable?: boolean;
  };
  try {
    payload = JSON.parse(data);
  } catch {
    return new StreamError({ rawError: data });
  }

  let code = payload.errorCode ?? '';
  const stage = payload.stage ?? '';
  let message = payload.message ?? '';
  const retryable = payload.retryable ?? false;
  let rawError = '';

  if (payload.error != null) {
    if (typeof payload.error === 'string') {
      rawError = payload.error;
    } else if (typeof payload.error === 'object') {
      const errObj = payload.error as { type?: string; message?: string };
      rawError = JSON.stringify(payload.error);
      // 私有 message 字段空时, 用 Anthropic error.message 兜底
      if (message === '' && errObj.message) message = errObj.message;
      // errorCode 空 + Anthropic error.type 非空时, 兜底用 type 作 code
      if (code === '' && errObj.type) code = errObj.type;
    }
  }

  return new StreamError({ code, stage, message, rawError, retryable });
}

// =============================================================================
// Order 状态判定
// =============================================================================

export function isOrderSuccess(status: string): boolean {
  switch (status) {
    case 'PAID':
    case 'SUCCESS':
    case 'COMPLETED':
      return true;
  }
  return false;
}

export function isOrderTerminal(status: string): boolean {
  switch (status) {
    case 'PAID':
    case 'SUCCESS':
    case 'COMPLETED':
    case 'FAILED':
    case 'CANCELLED':
    case 'CLOSED':
    case 'EXPIRED':
    case 'REFUNDED':
      return true;
  }
  return false;
}

// =============================================================================
// SSE 行迭代器
// =============================================================================

/**
 * 把 fetch Response.body (ReadableStream) 转成异步行迭代器
 * 替代 Go bufio.Scanner.
 *
 * 1MB 单行硬上限 (与 maxSSELineSize 对齐) — 超长行抛错.
 */
export async function* iterSSELines(
  body: ReadableStream<Uint8Array>,
  maxLineBytes = maxSSELineSize,
): AsyncGenerator<string, void, void> {
  const reader = body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buf = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });

      let nlIdx: number;
      while ((nlIdx = buf.indexOf('\n')) >= 0) {
        let line = buf.slice(0, nlIdx);
        buf = buf.slice(nlIdx + 1);
        // 去除 \r (CRLF)
        if (line.endsWith('\r')) line = line.slice(0, -1);
        yield line;
      }
      if (buf.length > maxLineBytes) {
        throw new Error(`SSE line exceeds ${maxLineBytes} bytes`);
      }
    }
    // 处理最后一行 (无结尾 \n)
    buf += decoder.decode(); // flush
    if (buf.length > 0) {
      if (buf.endsWith('\r')) buf = buf.slice(0, -1);
      if (buf !== '') yield buf;
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // ignore
    }
  }
}

// =============================================================================
// Body limit reader — 替代 Go io.LimitReader
// =============================================================================

/** 读取 ReadableStream 但限制最大字节数, 超限丢弃尾部 */
export async function readLimited(body: ReadableStream<Uint8Array>, maxBytes: number): Promise<Uint8Array> {
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (total + value.byteLength > maxBytes) {
        const remain = maxBytes - total;
        if (remain > 0) chunks.push(value.subarray(0, remain));
        break;
      }
      chunks.push(value);
      total += value.byteLength;
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // ignore
    }
  }
  // 拼接
  let len = 0;
  for (const c of chunks) len += c.byteLength;
  const out = new Uint8Array(len);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.byteLength;
  }
  return out;
}

/** 读取 ReadableStream + decode utf8, 限制最大字节数 */
export async function readLimitedText(
  body: ReadableStream<Uint8Array>,
  maxBytes: number,
): Promise<string> {
  const buf = await readLimited(body, maxBytes);
  return new TextDecoder('utf-8').decode(buf);
}
