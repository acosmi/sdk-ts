// scopes.ts — 端口自 acosmi-sdk-go/scopes.go (v0.19.0)
//
// 分组 Scope（V2: 10→3 合并），与后端 DesktopOAuthScopes 保持一致。
//
// 三处必须字面量一致, 任一变更需同步另外两处:
//   - Go:  nexus-v4/backend/internal/handler/desktop_oauth.go DesktopOAuthScopes
//   - Java: tk-dist/yudao-module-compliance-api ComplianceScopes
//   - TS:  本文件 ComplianceScope* 常量
// 合规 scope 不做分组合并 — 服务端按细粒度校验, SDK 也只应按需申请最小集合。

export const ScopeAI = 'ai'; // 模型服务: 模型调用 + 流量包 + 权益
export const ScopeSkills = 'skills'; // 技能与工具: 技能商店 + 工具列表 + 执行
export const ScopeAccount = 'account'; // 账户信息: 个人资料 + 钱包余额 + 交易记录

/** @deprecated 旧细粒度 scope, 保留向后兼容, 新代码请用分组 scope */
export const ScopeModels = 'models';
/** @deprecated */
export const ScopeModelsChat = 'models:chat';
/** @deprecated */
export const ScopeEntitlements = 'entitlements';
/** @deprecated */
export const ScopeTokenPackages = 'token-packages';
/** @deprecated */
export const ScopeSkillStore = 'skill_store';
/** @deprecated */
export const ScopeTools = 'tools';
/** @deprecated */
export const ScopeToolsExecute = 'tools:execute';
/** @deprecated */
export const ScopeWallet = 'wallet';
/** @deprecated */
export const ScopeWalletReadonly = 'wallet:readonly';
/** @deprecated */
export const ScopeProfile = 'profile';

// ===========================================================================
// 合规履约 scope
// ===========================================================================
//
// 调用 compliance API 时必须按这些常量声明所需 scope; 不允许通过 ScopeAI /
// ScopeAccount 隐式获得 compliance 权限。

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

/** 全部分组 scope (推荐) */
export function allScopes(): string[] {
  return [ScopeAI, ScopeSkills, ScopeAccount];
}

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

/** 模型服务相关 scope */
export function modelScopes(): string[] {
  return [ScopeAI];
}

/** 商城/钱包 scope */
export function commerceScopes(): string[] {
  return [ScopeAI, ScopeAccount];
}

/** 技能/工具 scope */
export function skillScopes(): string[] {
  return [ScopeSkills];
}
