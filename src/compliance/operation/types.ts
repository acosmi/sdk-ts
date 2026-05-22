// compliance/operation/types.ts — SDK-safe compliance capability + operation
// projection 公共领域类型。
//
// 设计原则见 compliance/evidence/types.ts 顶部说明。
//
// 对接后端 compliance gateway S2 / G2 契约（gap-register U-5 / U-6）：
//   - `GET /compliance/capabilities`         → CapabilityVO[]
//   - `GET /compliance/operations/page`      → PageResult<OperationPageItem>
//   - `GET /compliance/operations/{id}`      → OperationDetail
//
// `state` 字段【复用】跨域 shared 的 `FeatureGateState`（不另造同名近似类型，
// 见 saas-sdk-backend-capability-gap-register §9.4 勘误）。

import type { PageRequest } from '../../shared/pagination';
import type { FeatureGateState } from '../../shared/gate';

// =============================================================================
// Capability（feature gate 能力查询，gap-register U-6）
// =============================================================================

/**
 * 单个 compliance 高风险 / 收费动作的能力闸门视图。对应后端 G2 `CapabilityVO`。
 *
 * 后端为每个动作返回一条：`signEnvelope` / `createH5SigningUrl` /
 * `publishReport` / `approveSealApproval` / `executeSealUse` / `createSeal`。
 *
 * 拿不到能力时调用方必须 fail-closed（视为 `executable=false`）。`state` 复用
 * 跨域 {@link FeatureGateState} 开放联合——后端保留新增空间。
 */
export interface ComplianceCapability {
  /** 动作标识（如 `signEnvelope` / `publishReport`）。 */
  action: string;
  /** 该动作当前是否可执行。fail-closed：拿不到能力时按 false 处理。 */
  executable: boolean;
  /**
   * 不可执行的具体状态。后端取值：`executable` / `scope_missing` /
   * `not_provisioned` / `step_up_required` / `gate_closed` / `unknown`。
   */
  state: FeatureGateState;
  /** 该动作所需的 OAuth scope。 */
  requiredScopes: string[];
  /** 该动作是否需要 step-up（高风险动作二次验证）。 */
  requiredStepUp: boolean;
  /** 人类可读原因（诊断 / 展示）。 */
  reason: string;
}

// =============================================================================
// Operation Projection（操作投影，gap-register U-5）
// =============================================================================

/**
 * compliance 操作投影【列表项】视图。对应后端 G2 `OperationPageItem`。
 *
 * 与领域对象状态【正交】：描述【一次操作】本身的执行进度，而非某个履约对象的
 * 业务态。时间字段为 ISO-8601 字符串。
 */
export interface OperationPageItem {
  /** 行 id（数值主键）。 */
  id: number;
  /** 操作幂等键（跨来源统一关联键）。 */
  operationId: string;
  /** 操作状态。 */
  status: string;
  /** 是否终态。 */
  terminal: boolean;
  /** 当前状态是否允许 SDK 安全重试。 */
  retryable: boolean;
  /** 已尝试次数。 */
  attemptCount: number;
  /** 关联业务编号。 */
  businessNo?: string | null;
  /** 关联合同编号。 */
  contractNo?: string | null;
  /** 关联印章 id。 */
  sealId?: number | null;
  /** 对账状态。 */
  reconciliationStatus?: string | null;
  /** 下次重试时间 ISO-8601。 */
  nextRetryAt?: string | null;
  /** 请求发起时间 ISO-8601。 */
  requestedAt?: string | null;
  /** provider 响应时间 ISO-8601。 */
  respondedAt?: string | null;
  /** 创建时间 ISO-8601。 */
  createTime: string;
}

/**
 * compliance 操作投影【详情】视图。对应后端 G2 `OperationDetail`。
 *
 * 当前与 {@link OperationPageItem} 字段一致——单独成类型以便后端在详情视图
 * 追加字段时不破坏列表项契约。
 */
export interface OperationDetail {
  /** 行 id（数值主键）。 */
  id: number;
  /** 操作幂等键（跨来源统一关联键）。 */
  operationId: string;
  /** 操作状态。 */
  status: string;
  /** 是否终态。 */
  terminal: boolean;
  /** 当前状态是否允许 SDK 安全重试。 */
  retryable: boolean;
  /** 已尝试次数。 */
  attemptCount: number;
  /** 关联业务编号。 */
  businessNo?: string | null;
  /** 关联合同编号。 */
  contractNo?: string | null;
  /** 关联印章 id。 */
  sealId?: number | null;
  /** 对账状态。 */
  reconciliationStatus?: string | null;
  /** 下次重试时间 ISO-8601。 */
  nextRetryAt?: string | null;
  /** 请求发起时间 ISO-8601。 */
  requestedAt?: string | null;
  /** provider 响应时间 ISO-8601。 */
  respondedAt?: string | null;
  /** 创建时间 ISO-8601。 */
  createTime: string;
}

/**
 * `listOperations` 请求参数。
 *
 * 继承 {@link PageRequest} 分页 / 排序字段；全部可选。`createTimeStart` /
 * `createTimeEnd` 为调用方提供的【原样字符串】，后端按 `yyyy-MM-dd HH:mm:ss`
 * 解析；SDK 不做格式校验或时区转换。
 */
export interface ListOperationsRequest extends PageRequest {
  /** 操作状态过滤。 */
  status?: string;
  /** 创建时间下界，`yyyy-MM-dd HH:mm:ss`。 */
  createTimeStart?: string;
  /** 创建时间上界，`yyyy-MM-dd HH:mm:ss`。 */
  createTimeEnd?: string;
}
