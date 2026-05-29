// auth/scopes.ts — 端口自 acosmi-sdk-go/scopes.go (v0.19.0)
//
// 分组 Scope（V2: 10→3 合并），与后端 DesktopOAuthScopes 保持一致。
//
// 三处必须字面量一致, 任一变更需同步另外两处:
//   - Go:  nexus-v4/backend/internal/handler/desktop_oauth.go DesktopOAuthScopes
//   - Java: tk-dist/yudao-module-compliance-api ComplianceScopes
//   - TS:  本文件 + compliance/scopes.ts 的 Scope* 常量
// 合规 scope 不做分组合并 — 服务端按细粒度校验, SDK 也只应按需申请最小集合。
// 合规 scope 已迁出至 compliance/scopes.ts。

export const ScopeAI = 'ai'; // 模型服务: 模型调用 + 流量包 + 权益
export const ScopeSkills = 'skills'; // 技能与工具: 技能商店 + 工具列表 + 执行
export const ScopeAccount = 'account'; // 账户信息: 个人资料 + 钱包余额 + 交易记录

// -----------------------------------------------------------------------------
// Phase 4 (2026-05-27) 远程控制 CrabCode 多接入面专用 scope
//
// 契约: docs/audit/sdk-remote-control-contract-2026-05-27.md §6 #1 红线:
//   - 远控绝不复用 `models:chat` / `ai` scope;
//   - `ai` 展开列表绝不允许加入 remote_control 任意子项 (隐式获权后门);
//   - allScopes() 默认不申请 remote_control — 桌面登录不应该自动获得远控权限,
//     调用方必须显式构造 `[ScopeRemoteControl]` 或 `[...allScopes(), ScopeRemoteControl]`
//     才能在授权页面前向用户展示远控授权风险.
//
// 三处必须字面量一致:
//   - Go DesktopOAuthScopes (nexus-v4/backend/internal/handler/desktop_oauth.go)
//   - TS 本文件
//   - SDK / Web / Desktop 文档 §6
// -----------------------------------------------------------------------------

/** 远程控制能力 (分组 scope, 自包含展开到 3 个子 scope). 高风险, 不进 allScopes(). */
export const ScopeRemoteControl = 'remote_control';
/** 创建 / 取消 / stream AgentRun. */
export const ScopeRemoteControlAgentRun = 'remote_control:agent-run';
/** 远程会话 lifecycle 控制 (cancel / interrupt / kill). */
export const ScopeRemoteControlSessionControl = 'remote_control:session-control';
/** 代表用户提交远控权限审批响应 (allow / deny / timeout). */
export const ScopeRemoteControlPermissionResponse = 'remote_control:permission-response';

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

/**
 * 远程控制 scope (推荐). 仅返回分组 ScopeRemoteControl, 服务端 ScopeExpansion 会展开
 * 为 3 个子 scope. 调用方需显式申请, allScopes() 不包含本项 (避免桌面登录自动获权).
 */
export function remoteControlScopes(): string[] {
  return [ScopeRemoteControl];
}
