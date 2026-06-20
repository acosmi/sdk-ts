// compliance/status.ts — 合规域稳定 API 契约（前端可见的最小集合）。
//
// 设计原则：
//   - SDK / 插件 / SaaS 不感知下游履约通道材料或内部流水字段。
//     本文件只暴露面向用户的状态/错误码语义。
//   - 本文件导出的错误码常量是 **SDK 内部 symbolic key**，不是 Java 服务端的 wire 错误码。
//     Java 后端通过 ErrorCodeConstants 暴露的是 1-031-xxx-xxx 数值码；wire 上读到的是
//     {code: number, message: string}。前端要做分类判断时，使用 `compliance/errors.ts`
//     的 `classifyComplianceError(BusinessError)` 拿到 ComplianceErrorInfo.key，
//     再按本文件的 symbolic 常量 switch。本文件常量字面量供 SDK 内部分支判断与文档使用，
//     不是服务端 wire 字段。
//   - 业务入口在后端层关闭时，前端拿到 ENVELOPE_GATE_CLOSED / PROVIDER_NOT_CONFIGURED
//     必须展示"功能未开放"，不得自行重试或绕过。

/**
 * Compliance envelope 稳定业务状态。
 *
 * 字面量与 Java `EnvelopeStatusEnum` 的 `name()` 一致（这是 enum，是 wire 上的实际
 * 字符串）；前端按这些字符串分支展示文案。
 */
export type ComplianceEnvelopeStatus =
  | 'DRAFT'
  | 'CONTRACT_READY'
  | 'APPROVED'
  | 'SIGN_PENDING'
  | 'PENDING_EVIDENCE'         // provider 报告成功 / callback 已到，但本地证据链尚未就绪 — 不可承诺扣费
  | 'PENDING_RECONCILIATION'   // provider unknown/retrying / 本地 verify 失败 — 进入人工对账
  | 'SUCCESS'
  | 'FAILED'
  | 'CANCELED';

/** Compliance 用印审批稳定状态。 */
export type ComplianceSealApprovalStatus =
  | 'DRAFT'
  | 'SUBMITTED'
  | 'APPROVED'
  | 'REJECTED'
  | 'CANCELED'
  | 'USED'
  | 'EXPIRED';

/** Provider 业务状态（前端可见的脱敏视图，不暴露下游内部字段）。 */
export type ComplianceProviderStatus =
  | 'pending'
  | 'success'
  | 'failed'
  | 'unknown'      // 不可承诺扣费；客户必须等查询/对账完成
  | 'retrying';    // 不可承诺扣费

/**
 * 计费 / 履约的对外稳定状态视图。distribution compliance-billing 内部 API
 * (quote/reserve/commit/cancel/reconcile) 不暴露给前端 — 前端只能看见这 4 个语义。
 */
export type ComplianceBillingDisplayStatus =
  | 'reserved'                  // 已预占，待 provider 成功 + 本地验证
  | 'committed'                 // 已确认扣费
  | 'canceled'                  // 已取消
  | 'pending_reconciliation';   // 等待人工对账，扣费状态未确认

// ===========================================================================
// 错误码（字面量与 Java ErrorCodeConstants 一致）
// ===========================================================================

/** 高风险动作 step-up — 重新做 OAuth introspection 或重新登录，提升 token 等级后再尝试。 */
export const ErrComplianceStepUpRequired = 'COMPLIANCE_STEP_UP_REQUIRED';

/** envelope 闸门关闭 — 审批 gate 等条件未同时就绪，前端展示"功能开放中"。 */
export const ErrEnvelopeGateClosed = 'ENVELOPE_GATE_CLOSED';

/** 履约 provider 未配置 — 受控环境材料缺失时业务路径会一致拒绝，不要前端重试。 */
export const ErrProviderNotConfigured = 'PROVIDER_NOT_CONFIGURED';

/** Provider 返回 unknown / retrying — 客户必须等待对账，前端展示"处理中（人工核对）"。 */
export const ErrProviderUnknownNoRetry = 'PROVIDER_REQUEST_UNKNOWN_NO_RETRY';

/** callback 不能直接确认扣费 — 后端守门，前端无需处理，记录到审计日志展示即可。 */
export const ErrBillingCallbackCannotCommit = 'BILLING_CALLBACK_CANNOT_COMMIT';

/** provider 成功但本地未验证通过，不允许扣费。 */
export const ErrBillingCommitRequiresLocalVerify = 'BILLING_COMMIT_REQUIRES_LOCAL_VERIFY';

/** distribution compliance-billing 必须 S2S — 前端误调用时拿到该错误码，禁止 retry。 */
export const ErrBillingS2sForbidden = 'BILLING_S2S_FORBIDDEN';

/** 审批 gate 各类失败语义（前端展示"审批中 / 审批已用 / 审批失效"）。 */
export const ErrSealApprovalNotApproved = 'SEAL_APPROVAL_STATE_NOT_APPROVED';
export const ErrSealApprovalExpired = 'SEAL_APPROVAL_EXPIRED';
export const ErrSealApprovalNonceUsed = 'SEAL_APPROVAL_NONCE_USED';
export const ErrSealApprovalContractHashMismatch = 'SEAL_APPROVAL_CONTRACT_HASH_MISMATCH';
export const ErrSealApprovalSealMismatch = 'SEAL_APPROVAL_SEAL_MISMATCH';
export const ErrSealApprovalLocationMismatch = 'SEAL_APPROVAL_LOCATION_MISMATCH';
export const ErrSealApprovalTransactorMismatch = 'SEAL_APPROVAL_TRANSACTOR_MISMATCH';

/** 用印重复消费防护 — 前端遇到该错误必须刷新审批单状态，不允许"换一次 nonce 再试"。 */
export const ErrSealUseAlreadyConsumed = 'SEAL_USE_ALREADY_CONSUMED';

/** 该错误码联合用于前端选择性展示文案；非穷举式 enum，后端保留新增空间。 */
export type ComplianceClientErrorCode =
  | typeof ErrComplianceStepUpRequired
  | typeof ErrEnvelopeGateClosed
  | typeof ErrProviderNotConfigured
  | typeof ErrProviderUnknownNoRetry
  | typeof ErrBillingCallbackCannotCommit
  | typeof ErrBillingCommitRequiresLocalVerify
  | typeof ErrBillingS2sForbidden
  | typeof ErrSealApprovalNotApproved
  | typeof ErrSealApprovalExpired
  | typeof ErrSealApprovalNonceUsed
  | typeof ErrSealApprovalContractHashMismatch
  | typeof ErrSealApprovalSealMismatch
  | typeof ErrSealApprovalLocationMismatch
  | typeof ErrSealApprovalTransactorMismatch
  | typeof ErrSealUseAlreadyConsumed;

/**
 * 判定一个错误码是否属于"需要前端引导用户重新认证/审批"的高级语义，
 * 而不是简单 retry。这类错误前端不允许在 UI 层做自动重试。
 */
export function isComplianceTerminalError(code: string): boolean {
  switch (code) {
    case ErrEnvelopeGateClosed:
    case ErrProviderNotConfigured:
    case ErrProviderUnknownNoRetry:
    case ErrBillingCallbackCannotCommit:
    case ErrBillingCommitRequiresLocalVerify:
    case ErrBillingS2sForbidden:
    case ErrSealApprovalNonceUsed:
    case ErrSealApprovalExpired:
    case ErrSealApprovalContractHashMismatch:
    case ErrSealApprovalSealMismatch:
    case ErrSealApprovalLocationMismatch:
    case ErrSealApprovalTransactorMismatch:
    case ErrSealUseAlreadyConsumed:
      return true;
    default:
      return false;
  }
}

/**
 * "是否允许在 UI 上呈现为'扣费已确认'"的判定。
 * provider 状态为 unknown / retrying / pending 时一律不展示为已确认。
 */
export function isBillingConfirmable(
  providerStatus: ComplianceProviderStatus | undefined,
  billingStatus: ComplianceBillingDisplayStatus | undefined,
): boolean {
  return providerStatus === 'success' && billingStatus === 'committed';
}
