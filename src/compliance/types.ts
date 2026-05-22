// compliance/types.ts — 跨子域共享的 compliance 公共领域类型。
//
// 本文件只放**跨多个 compliance 子域、且不专属任一子域**的类型。
// 子域专属类型在 compliance/<子域>/types.ts。
//
// 设计原则见 compliance/evidence/types.ts 顶部说明。

// =============================================================================
// 公共请求 options
// =============================================================================

/** Compliance 写操作选项；写操作不自动 retry，不自动 401 重放。 */
export interface ComplianceWriteOptions {
  /**
   * 调用方稳定的幂等键。写操作强烈建议持久化；缺省时服务端按 UUID 兜底，但调用方
   * 在重试 / 恢复时无法对账。
   */
  idempotencyKey?: string;
  signal?: AbortSignal;
}

/** 轮询参数（exponential backoff）。 */
export interface CompliancePollOptions {
  /** 总超时（ms），缺省 60s。 */
  timeoutMs?: number;
  /** 初始 interval（ms），缺省 1000。 */
  initialIntervalMs?: number;
  /** interval 倍增上限（ms），缺省 5000。 */
  maxIntervalMs?: number;
  /** 倍增系数，缺省 1.5。 */
  multiplier?: number;
  signal?: AbortSignal;
}
