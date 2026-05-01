// retry.ts — 端口自 acosmi-sdk-go/retry.go
// L6 (2026-04-27, v0.15): SDK 内置 retry policy
//
// 设计目标:
//   1. GET 类查询 (skill-store/models/balance) 默认 2x retry, 稳定性提升
//   2. POST 类业务 (chat/messages/upload) 默认 0 retry — 计费安全红线 (双扣保护)
//   3. Stream 路径强制 maxAttempts=1 — 流式 SSE 已部分写出, 重试 = 双 token 重复消息
//   4. 401 refresh 与 retry 互斥 — refresh 是 inner loop, 不算 attempt
//   5. AbortSignal aborted 立即返回 — 用户 abort 不重试
//   6. StreamError 显式排除 — V2 P0 SSE 中段错误不可重试
//
// 与类型化错误协作:
//   - HTTPError 5xx/429 → 默认可重试
//   - NetworkError isTimeout()/isEOF() → 默认可重试
//   - 其他 → 不重试

import { HTTPError, NetworkError, StreamError } from './types';

/** 表示一次 retry 评估的请求快照 — 仅供 SafeToRetry 闸门使用 */
export interface RetryRequestInfo {
  method: string;
  url: string;
}

/**
 * 配置 SDK 重试行为.
 *
 * undefined 字段使用 DefaultRetryPolicy 对应字段; null/undefined RetryPolicy 自身禁用重试.
 */
export interface RetryPolicy {
  /** 总尝试次数 (含首次). 1 = 不重试; 默认 2. */
  maxAttempts?: number;
  /** 首次重试退避时长 (毫秒). 默认 200. */
  backoffMs?: number;
  /** 退避最大值 (指数增长封顶, 毫秒). 默认 2000. */
  backoffMaxMs?: number;
  /** 指数倍数. 默认 2.0. */
  backoffMul?: number;

  /**
   * 错误层闸门: 是否值得重试.
   * 默认 defaultRetryable: HTTPError 5xx/429, NetworkError Timeout/EOF, 排除 StreamError.
   */
  onRetryable?: (err: unknown) => boolean;

  /**
   * 请求层闸门 (计费安全核心): 当前请求是否值得重试.
   * 默认 defaultSafeToRetry: GET/HEAD/OPTIONS true, 其他 false.
   * chat/messages/upload POST → 默认 false 兜底, 双扣绝不发生.
   */
  safeToRetry?: (req: RetryRequestInfo) => boolean;
}

/**
 * 安全默认值.
 *
 * 计费安全红线: safeToRetry 默认 POST=false → chat/messages 用户 0 行为变化.
 * GET 类查询 (skill-store/models/balance) 自动得 2x 稳定性.
 */
export const DefaultRetryPolicy: Required<Omit<RetryPolicy, never>> = {
  maxAttempts: 2,
  backoffMs: 200,
  backoffMaxMs: 2000,
  backoffMul: 2.0,
  onRetryable: defaultRetryable,
  safeToRetry: defaultSafeToRetry,
};

/**
 * 计费安全闸门.
 *
 * 仅以下 method 视为幂等:
 *   - GET / HEAD / OPTIONS: 天然幂等
 *
 * POST/PUT/DELETE/PATCH 默认 false (双扣保护). 调用方需要 GET 类 POST 重试可自定义 safeToRetry.
 */
export function defaultSafeToRetry(req: RetryRequestInfo): boolean {
  switch (req.method.toUpperCase()) {
    case 'GET':
    case 'HEAD':
    case 'OPTIONS':
      return true;
  }
  return false;
}

/**
 * 错误层闸门.
 *
 * 显式排除 (优先级最高):
 *   - StreamError: V2 P0 SSE 中段错误, 流已部分写出, 重试 = 双 token + 重复消息
 *   - AbortSignal aborted: 用户主动 abort, 重试无意义 (TS 中由调用方在 onRetryable 之前检查)
 *
 * 视为可重试:
 *   - HTTPError 5xx 或 429
 *   - NetworkError isTimeout() 或 isEOF()
 *
 * 其他 (如 4xx 业务错误 / DNS 失败 / BusinessError): 不重试
 */
export function defaultRetryable(err: unknown): boolean {
  if (err == null) return false;
  if (err instanceof StreamError) return false;
  if (err instanceof HTTPError) {
    return err.statusCode >= 500 || err.statusCode === 429;
  }
  if (err instanceof NetworkError) {
    return err.isTimeout() || err.isEOF();
  }
  return false;
}

/** 实际生效策略 (undefined → DefaultRetryPolicy 兜底; 字段缺失填默认值) */
export function effectivePolicy(p: RetryPolicy | null | undefined): Required<RetryPolicy> | null {
  if (p == null) return null; // 显式禁用
  const out: Required<RetryPolicy> = {
    maxAttempts: p.maxAttempts && p.maxAttempts > 0 ? p.maxAttempts : DefaultRetryPolicy.maxAttempts,
    backoffMs: p.backoffMs && p.backoffMs > 0 ? p.backoffMs : DefaultRetryPolicy.backoffMs,
    backoffMaxMs:
      p.backoffMaxMs && p.backoffMaxMs > 0 ? p.backoffMaxMs : DefaultRetryPolicy.backoffMaxMs,
    backoffMul: p.backoffMul && p.backoffMul > 0 ? p.backoffMul : DefaultRetryPolicy.backoffMul,
    onRetryable: p.onRetryable ?? defaultRetryable,
    safeToRetry: p.safeToRetry ?? defaultSafeToRetry,
  };
  return out;
}

/** Retry-After 头的硬上限 — 防止恶意服务器返回 Retry-After: 999999 卡死 */
const retryAfterUpperBoundMs = 60_000;

/**
 * 计算第 attempt 次重试的退避时长 (毫秒, attempt 从 0 起).
 * 优先级: HTTPError.retryAfter (上限 60s) > 指数退避 (backoffMs * backoffMul^attempt, 封顶 backoffMaxMs)
 */
export function computeBackoff(p: Required<RetryPolicy>, attempt: number, err: unknown): number {
  if (err instanceof HTTPError && err.retryAfter > 0) {
    const ms = err.retryAfter * 1000;
    return Math.min(ms, retryAfterUpperBoundMs);
  }
  let d = p.backoffMs;
  for (let i = 0; i < attempt; i++) {
    d = d * p.backoffMul;
    if (d > p.backoffMaxMs) return p.backoffMaxMs;
  }
  return d;
}
