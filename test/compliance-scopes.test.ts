// compliance-scopes.test.ts — 13 个 compliance scope 常量与 complianceScopes() 覆盖。

import { describe, it, expect } from 'vitest';
import {
  complianceScopes,
  ScopeComplianceEvidenceRead,
  ScopeComplianceEvidenceWrite,
  ScopeComplianceTimestampIssue,
  ScopeComplianceTimestampVerify,
  ScopeComplianceContractSigningRead,
  ScopeComplianceContractSigningWrite,
  ScopeComplianceSealManage,
  ScopeComplianceSealApprovalRequest,
  ScopeComplianceSealApprovalApprove,
  ScopeComplianceSealUseExecute,
  ScopeComplianceReportsRead,
  ScopeComplianceReportsWrite,
  ScopeComplianceReportsPublish,
} from '../src/compliance/scopes';

describe('compliance scopes', () => {
  it('13 个 scope 字面量保持稳定', () => {
    expect(ScopeComplianceEvidenceRead).toBe('compliance:evidence:read');
    expect(ScopeComplianceEvidenceWrite).toBe('compliance:evidence:write');
    expect(ScopeComplianceTimestampIssue).toBe('compliance:timestamp:issue');
    expect(ScopeComplianceTimestampVerify).toBe('compliance:timestamp:verify');
    expect(ScopeComplianceContractSigningRead).toBe('compliance:contract_signing:read');
    expect(ScopeComplianceContractSigningWrite).toBe('compliance:contract_signing:write');
    expect(ScopeComplianceSealManage).toBe('compliance:seal:manage');
    expect(ScopeComplianceSealApprovalRequest).toBe('compliance:seal_approval:request');
    expect(ScopeComplianceSealApprovalApprove).toBe('compliance:seal_approval:approve');
    expect(ScopeComplianceSealUseExecute).toBe('compliance:seal_use:execute');
    expect(ScopeComplianceReportsRead).toBe('compliance:reports:read');
    expect(ScopeComplianceReportsWrite).toBe('compliance:reports:write');
    expect(ScopeComplianceReportsPublish).toBe('compliance:reports:publish');
  });

  it('complianceScopes() 精确返回 13 个 scope，顺序稳定', () => {
    expect(complianceScopes()).toEqual([
      'compliance:evidence:read',
      'compliance:evidence:write',
      'compliance:timestamp:issue',
      'compliance:timestamp:verify',
      'compliance:contract_signing:read',
      'compliance:contract_signing:write',
      'compliance:seal:manage',
      'compliance:seal_approval:request',
      'compliance:seal_approval:approve',
      'compliance:seal_use:execute',
      'compliance:reports:read',
      'compliance:reports:write',
      'compliance:reports:publish',
    ]);
  });

  it('每次调用返回新切片，修改不影响内部', () => {
    const a = complianceScopes();
    a.push('compliance:fake');
    expect(complianceScopes()).toHaveLength(13);
  });

  it('全部 scope 以 "compliance:" 前缀开头', () => {
    for (const s of complianceScopes()) {
      expect(s.startsWith('compliance:')).toBe(true);
    }
  });
});
