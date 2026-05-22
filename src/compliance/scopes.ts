// compliance/scopes.ts — 端口自 acosmi-sdk-go/scopes.go (v0.19.0)
//
// 合规履约 scope。
//
// 三处必须字面量一致, 任一变更需同步另外两处:
//   - Go:  nexus-v4/backend/internal/handler/desktop_oauth.go DesktopOAuthScopes
//   - Java: tk-dist/yudao-module-compliance-api ComplianceScopes
//   - TS:  本文件 ScopeCompliance* 常量
//
// 调用 compliance API 时必须按这些常量声明所需 scope; 不允许通过 ScopeAI /
// ScopeAccount 隐式获得 compliance 权限。合规 scope 不做分组合并 — 服务端按细粒度
// 校验, SDK 也只应按需申请最小集合。

export const ScopeComplianceEvidenceRead = 'compliance:evidence:read';
export const ScopeComplianceEvidenceWrite = 'compliance:evidence:write';

export const ScopeComplianceTimestampIssue = 'compliance:timestamp:issue';
export const ScopeComplianceTimestampVerify = 'compliance:timestamp:verify';

export const ScopeComplianceContractSigningRead = 'compliance:contract_signing:read';
export const ScopeComplianceContractSigningWrite = 'compliance:contract_signing:write';

export const ScopeComplianceSealManage = 'compliance:seal:manage';
export const ScopeComplianceSealApprovalRequest = 'compliance:seal_approval:request';
export const ScopeComplianceSealApprovalApprove = 'compliance:seal_approval:approve';
export const ScopeComplianceSealUseExecute = 'compliance:seal_use:execute';

export const ScopeComplianceReportsRead = 'compliance:reports:read';
export const ScopeComplianceReportsWrite = 'compliance:reports:write';
export const ScopeComplianceReportsPublish = 'compliance:reports:publish';

/** 类型联合：合规域细粒度 scope。Java compliance verifier 只按细粒度匹配, 不做分组展开。 */
export type ComplianceScope =
  | typeof ScopeComplianceEvidenceRead
  | typeof ScopeComplianceEvidenceWrite
  | typeof ScopeComplianceTimestampIssue
  | typeof ScopeComplianceTimestampVerify
  | typeof ScopeComplianceContractSigningRead
  | typeof ScopeComplianceContractSigningWrite
  | typeof ScopeComplianceSealManage
  | typeof ScopeComplianceSealApprovalRequest
  | typeof ScopeComplianceSealApprovalApprove
  | typeof ScopeComplianceSealUseExecute
  | typeof ScopeComplianceReportsRead
  | typeof ScopeComplianceReportsWrite
  | typeof ScopeComplianceReportsPublish;

/** 全部合规域 scope。OAuth 申请合规权限时使用; 谨慎一次性申请全部, 推荐按业务最小集合申请。 */
export function complianceScopes(): ComplianceScope[] {
  return [
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
  ];
}
