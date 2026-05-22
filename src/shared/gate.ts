// shared/gate.ts — 跨域统一 gate / capability / step-up / preflight 原语。
//
// 依据：能力缺口总账 §4.4 / §6.1 / §U-6 / §9.4（Phase 0.3 shared DTO，缺口
// U-6 / R-1）。
//
// 本文件按【关注点】拆分自 §9.5 列举的 4 个 shared 文件之外 —— gate / step-up /
// preflight 是与分页 / operation / retryAdvice / principal 并列的独立关注点，
// 单独成文（§9.5 红线只禁止 `src/` 根散文件与回退巨型 types.ts，`src/shared/`
// 下按域分文件正是其要求的形态）。
//
// 仅沉淀【共享形态原语】；真实 gate / preflight 查询命名空间须待后端端点 +
// 契约就绪后落地（§9.1）。step-up 运行期能力随对外鉴权层计划本期不实施
// （用户决策 2026-05-22）—— 但 `StepUpStatus` 形态作为 `FeatureGateStatus`
// 的组成字段先行沉淀，不构成 step-up 后端的实现。

import type { OperationId } from './operation';
import type { RetryAdvice } from './retry-advice';

/**
 * 高风险 / 收费动作的 gate 状态机（§U-6）。开放联合，后端保留新增空间。
 *
 * `gates.ts`（csign workbench）拿不到能力时 fail-closed 返回 `unknown` —
 * 与本枚举的 `unknown` 一致。
 */
export type FeatureGateState =
  | 'executable' // 可执行
  | 'scope_missing' // 缺少所需 OAuth scope
  | 'not_provisioned' // 功能未开通 / 套餐未含
  | 'quota_exceeded' // 配额不足
  | 'step_up_required' // 需要 step-up 提升 token 等级
  | 'gate_closed' // 业务闸门关闭（审批 gate 等条件未就绪）
  | 'unknown' // fail-closed 兜底
  // 开放联合：`string & NonNullable<unknown>` ≡ `string & {}`（`{}` 字面量被
  // eslint ban-types 禁用，用等价写法），保留字面量补全且不拒绝未知值。
  | (string & NonNullable<unknown>);

/** 配额快照。`FeatureGateStatus.quota` 与 `BillingPreflightResult` 复用。 */
export interface GateQuota {
  /** 配额上限。 */
  limit?: number;
  /** 已用量。 */
  used?: number;
  /** 剩余量。 */
  remaining?: number;
  /** 配额单位（如 `etu` / `count`）；后端可省略。 */
  unit?: string;
}

/**
 * step-up（高风险动作二次验证）状态（§6.1）。
 *
 * 字段形态先行沉淀；step-up 发起 / 校验的【后端运行期能力】随对外鉴权层
 * 计划本期不实施。
 */
export interface StepUpStatus {
  /** 当前动作是否要求 step-up。 */
  required: boolean;
  /** 是否已满足（已完成且未过期）。 */
  satisfied: boolean;
  /** step-up 方式（如 `webauthn` / `oauth_introspection`）；后端可省略。 */
  method?: string;
  /** 满足态过期时间（ISO 8601）；未满足时省略。 */
  expiresAt?: string;
  /** 未满足 / 失败原因；满足时省略。 */
  reason?: string;
}

/**
 * gate / capability 查询结果（§U-6）。
 *
 * 高风险动作（signEnvelope / createH5SigningUrl / publishReport /
 * approveSealApproval / executeSealUse / claimLeadWithConflictOverride）执行前
 * 查询本结构，区分「可执行 / scope 缺失 / 未开通 / quota 不足 / 需 step-up /
 * gate closed」。拿不到时必须 fail-closed（`executable=false`，§2 边界 7）。
 */
export interface FeatureGateStatus {
  /** 最终是否可执行。fail-closed：拿不到能力时为 false。 */
  executable: boolean;
  /** 不可执行的具体状态。 */
  state: FeatureGateState;
  /** 缺失 / 所需 OAuth scope。 */
  requiredScopes?: string[];
  /** 是否需要 step-up。 */
  requiredStepUp?: boolean;
  /** 缺失的 entitlement / feature 标识。 */
  missingEntitlements?: string[];
  /** 配额快照。 */
  quota?: GateQuota;
  /** 人类可读原因（诊断 / 展示）。 */
  reason?: string;
  /** 失败补救建议（叠加层，见 retry-advice.ts）。 */
  retryAdvice?: RetryAdvice;
  /** 关联 operation / preflight id。 */
  operationId?: OperationId;
}

/**
 * 收费 / 高风险动作的 billing preflight 结果（§4.4 / §4.5）。
 *
 * 在动作执行【前】返回可执行性、预估扣费、所需 step-up / scopes。金额字段为
 * `string`（json.Number 端口，避免 JS number 精度损失 —— 金融安全红线）。
 */
export interface BillingPreflightResult {
  /** 是否可执行（含 quota / entitlement / gate 综合判定）。 */
  executable: boolean;
  /** 预估扣费金额；`string` 表示，避免浮点精度丢失。 */
  estimatedCharge?: string;
  /** 计费单位 / 币种（如 `etu` / `CNY`）。 */
  currency?: string;
  /** 所需 OAuth scope。 */
  requiredScopes?: string[];
  /** 是否需要 step-up。 */
  requiredStepUp?: boolean;
  /** 配额快照。 */
  quota?: GateQuota;
  /** 失败补救建议。 */
  retryAdvice?: RetryAdvice;
  /** preflight 关联 id —— 后续真实扣费动作回填以串联 hold/settle/release。 */
  preflightId?: string;
  /** 不可执行原因（诊断 / 展示）。 */
  reason?: string;
}
