// shared/api-response.ts — nexus-v4 / yudao 标准 API 响应包装。
//
// 端口自 acosmi-sdk-go/types.go (v0.19.0) 的 API Response Wrapper 段。

import { BusinessError } from './errors';

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
