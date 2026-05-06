// scopes.ts — 端口自 acosmi-sdk-go/scopes.go (v0.19.0)
//
// 分组 Scope（V2: 10→3 合并），与后端 DesktopOAuthScopes 保持一致。

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

/** 全部分组 scope (推荐) */
export function allScopes(): string[] {
  return [ScopeAI, ScopeSkills, ScopeAccount];
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
