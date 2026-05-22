// shared.test.ts — 跨域共享 DTO 契约测试（能力缺口总账 Phase 0.3 / 0.5）。
//
// 覆盖：
//   - pagination: `PageResult<T>` ≡ `YudaoPageResult<T>`（别名，非双标准）；
//     `PageRequest` 全可选。
//   - operation: `IdempotencyKeyHeader` 常量；`ProviderRequestStatus` 复用
//     既有 `ComplianceProviderRequestStatus`。
//   - retry-advice: `RETRY_ADVICE_REASONS` 全集；compliance key / OAuth 错误 →
//     reason 映射；`complianceErrorToRetryAdvice` 叠加投影且不 mutate 入参。
//   - 红线：`RetryAdvice` 不替换 `ComplianceErrorInfo` —— `classifyComplianceError`
//     行为零回归。
//   - principal / gate: 形态构造可用。

import { describe, expect, it } from 'vitest';

import {
  BusinessError,
  classifyComplianceError,
  complianceErrorToRetryAdvice,
  IdempotencyKeyHeader,
  RETRY_ADVICE_REASONS,
  retryReasonForComplianceKey,
  retryReasonForOAuthError,
} from '../src/index';
import type {
  ApiClientRef,
  BillingPreflightResult,
  ComplianceErrorInfo,
  ComplianceProviderRequestStatus,
  FeatureGateStatus,
  GateQuota,
  OperationSource,
  OperationStatus,
  PageRequest,
  PageResult,
  PrincipalRef,
  ProviderRequestStatus,
  RetryAdvice,
  RetryAdviceReason,
  StepUpStatus,
  TenantRef,
  VerifyStatus,
  YudaoPageResult,
} from '../src/index';

describe('shared/pagination', () => {
  it('PageResult<T> 与 YudaoPageResult<T> 互相赋值（别名，非双标准）', () => {
    const page: PageResult<number> = { list: [1, 2, 3], total: 3 };
    const yudao: YudaoPageResult<number> = page; // PageResult → YudaoPageResult
    const back: PageResult<number> = yudao; // YudaoPageResult → PageResult
    expect(back.list).toEqual([1, 2, 3]);
    expect(back.total).toBe(3);
  });

  it('PageRequest 字段全可选 —— 空对象合法', () => {
    const empty: PageRequest = {};
    const full: PageRequest = { pageNo: 2, pageSize: 20, sortBy: 'createdAt', sortDirection: 'desc' };
    expect(empty).toEqual({});
    expect(full.sortDirection).toBe('desc');
  });
});

describe('shared/operation', () => {
  it('IdempotencyKeyHeader 是写接口幂等键 header 单一真相源', () => {
    expect(IdempotencyKeyHeader).toBe('Idempotency-Key');
  });

  it('ProviderRequestStatus 复用 ComplianceProviderRequestStatus', () => {
    const a: ComplianceProviderRequestStatus = 'SUCCESS';
    const b: ProviderRequestStatus = a; // 同一类型，可直接赋值
    expect(b).toBe('SUCCESS');
  });

  it('OperationSource / OperationStatus / VerifyStatus 是开放联合', () => {
    const known: OperationSource = 'console';
    const custom: OperationSource = 'compliance:seal'; // 未知来源不被拒绝
    const status: OperationStatus = 'awaiting_verify';
    const verify: VerifyStatus = 'verified';
    expect([known, custom, status, verify]).toEqual([
      'console',
      'compliance:seal',
      'awaiting_verify',
      'verified',
    ]);
  });
});

describe('shared/retry-advice', () => {
  it('RETRY_ADVICE_REASONS 恰为 §6.6 要求的 11 项且不重复', () => {
    expect(RETRY_ADVICE_REASONS).toHaveLength(11);
    expect(new Set(RETRY_ADVICE_REASONS).size).toBe(11);
    expect(RETRY_ADVICE_REASONS).toEqual([
      'unknown',
      'retrying',
      'failed',
      'gate_closed',
      'step_up_required',
      'tenant_mismatch',
      'insufficient_scope',
      'quota_exceeded',
      'provider_timeout',
      'local_verify_failed',
      'billing_preflight_failed',
    ]);
  });

  it('retryReasonForComplianceKey 映射既有符号 key（非新造码）', () => {
    expect(retryReasonForComplianceKey('COMPLIANCE_STEP_UP_REQUIRED')).toBe('step_up_required');
    expect(retryReasonForComplianceKey('COMPLIANCE_INSUFFICIENT_SCOPE')).toBe('insufficient_scope');
    expect(retryReasonForComplianceKey('ENVELOPE_GATE_CLOSED')).toBe('gate_closed');
    expect(retryReasonForComplianceKey('ENVELOPE_TENANT_MISMATCH')).toBe('tenant_mismatch');
    expect(retryReasonForComplianceKey('SUBJECT_SNAPSHOT_TENANT_MISMATCH')).toBe('tenant_mismatch');
    expect(retryReasonForComplianceKey('TIMESTAMP_LOCAL_VERIFY_FAILED')).toBe('local_verify_failed');
    expect(retryReasonForComplianceKey('AUDIT_CHAIN_TAMPER_DETECTED')).toBe('local_verify_failed');
    expect(retryReasonForComplianceKey('BILLING_CALLBACK_CANNOT_COMMIT')).toBe('billing_preflight_failed');
    expect(retryReasonForComplianceKey('UNKNOWN_COMPLIANCE_ERROR')).toBe('unknown');
  });

  it('retryReasonForComplianceKey 输出恒在 RETRY_ADVICE_REASONS 内', () => {
    const sample: Parameters<typeof retryReasonForComplianceKey>[0][] = [
      'COMPLIANCE_UNAUTHORIZED',
      'PROVIDER_NOT_CONFIGURED',
      'PROVIDER_REQUEST_STATUS_NOT_TERMINAL',
      'ENVELOPE_EVIDENCE_NOT_READY',
      'SEAL_USE_ALREADY_CONSUMED',
      'BILLING_COMMIT_REQUIRES_LOCAL_VERIFY',
      'TIMESTAMP_PROVIDER_NOT_AVAILABLE',
    ];
    for (const key of sample) {
      expect(RETRY_ADVICE_REASONS).toContain(retryReasonForComplianceKey(key));
    }
  });

  it('retryReasonForOAuthError 映射 Go OAuth 标准错误字符串', () => {
    expect(retryReasonForOAuthError('insufficient_scope')).toBe('insufficient_scope');
    expect(retryReasonForOAuthError('invalid_token')).toBe('failed');
    expect(retryReasonForOAuthError('something_unregistered')).toBe('unknown');
  });

  it('complianceErrorToRetryAdvice 对终态错误：换新幂等键 + 需人工介入', () => {
    const info = classifyComplianceError(new BusinessError(1031004004, 'gate closed'));
    expect(info.key).toBe('ENVELOPE_GATE_CLOSED');
    expect(info.terminal).toBe(true);

    const advice: RetryAdvice = complianceErrorToRetryAdvice(info);
    expect(advice.reason).toBe('gate_closed');
    expect(advice.retryable).toBe(false);
    expect(advice.sameIdempotencyKeyRequired).toBe(false); // 终态 → 换新 key
    expect(advice.manualActionRequired).toBe(true);
    expect(advice.supportCode).toBe('compliance:1031004004');
    expect(advice.developerMessage).toBe('API error (code=1031004004): gate closed');
  });

  it('complianceErrorToRetryAdvice 对 step-up 错误：沿用同一幂等键 + 需人工介入', () => {
    const info = classifyComplianceError(new BusinessError(1031000013, 'step up'));
    expect(info.stepUpRequired).toBe(true);
    expect(info.terminal).toBe(false);

    const advice = complianceErrorToRetryAdvice(info);
    expect(advice.reason).toBe('step_up_required');
    expect(advice.sameIdempotencyKeyRequired).toBe(true); // 非终态 → 重认证后用同一 key
    expect(advice.manualActionRequired).toBe(true);
  });

  it('complianceErrorToRetryAdvice 是只读投影 —— 不 mutate 入参', () => {
    const info: ComplianceErrorInfo = Object.freeze(
      classifyComplianceError(new BusinessError(1031002009, 'local verify failed')),
    );
    const snapshot = JSON.stringify(info);
    const advice = complianceErrorToRetryAdvice(info);
    expect(JSON.stringify(info)).toBe(snapshot); // 入参未变
    expect(advice.reason).toBe('local_verify_failed');
  });
});

describe('shared 红线：RetryAdvice 不替换 ComplianceErrorInfo', () => {
  it('classifyComplianceError 行为零回归（retryable/terminal/stepUpRequired 仍在）', () => {
    const info = classifyComplianceError(new BusinessError(1031000013, 'step up'));
    expect(info).toMatchObject({
      code: 1031000013,
      key: 'COMPLIANCE_STEP_UP_REQUIRED',
      retryable: false,
      terminal: false,
      stepUpRequired: true,
    });
    // RetryAdvice 是叠加层：独立字段，与 ComplianceErrorInfo 共存。
    const advice = complianceErrorToRetryAdvice(info);
    expect(Object.keys(advice).sort()).toEqual(
      ['developerMessage', 'manualActionRequired', 'reason', 'retryable', 'sameIdempotencyKeyRequired', 'supportCode'].sort(),
    );
  });
});

describe('shared/principal & gate 形态', () => {
  it('PrincipalRef / TenantRef / ApiClientRef 是轻量引用', () => {
    const tenant: TenantRef = { tenantId: 't-1', name: '众律宝租户' };
    const principal: PrincipalRef = { principalId: 'p-1', userId: 'u-1', tenantId: 't-1' };
    const apiClient: ApiClientRef = { clientId: 'c-1' };
    expect(tenant.tenantId).toBe('t-1');
    expect(principal.tenantId).toBe('t-1');
    expect(apiClient.name).toBeUndefined();
  });

  it('FeatureGateStatus fail-closed 形态可构造', () => {
    const gate: FeatureGateStatus = {
      executable: false,
      state: 'unknown',
      requiredScopes: ['compliance:seal:approve'],
      requiredStepUp: true,
    };
    expect(gate.executable).toBe(false);
    expect(gate.state).toBe('unknown');
  });

  it('StepUpStatus / GateQuota / BillingPreflightResult 形态可构造', () => {
    const stepUp: StepUpStatus = { required: true, satisfied: false, reason: 'token level too low' };
    const quota: GateQuota = { limit: 100, used: 30, remaining: 70, unit: 'count' };
    const preflight: BillingPreflightResult = {
      executable: true,
      estimatedCharge: '12.50', // string —— 金额精度红线
      currency: 'CNY',
      quota,
    };
    expect(stepUp.satisfied).toBe(false);
    expect(preflight.estimatedCharge).toBe('12.50');
    expect(typeof preflight.estimatedCharge).toBe('string');
  });

  it('RetryAdviceReason 可作 FeatureGateState 诊断（类型独立、不串）', () => {
    const reason: RetryAdviceReason = 'quota_exceeded';
    expect(RETRY_ADVICE_REASONS).toContain(reason);
  });
});
