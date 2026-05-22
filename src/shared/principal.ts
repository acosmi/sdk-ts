// shared/principal.ts — 跨域统一身份 / 租户 / API client 引用原语。
//
// 依据：能力缺口总账 §4.1 / §9.4（Phase 0.3 shared DTO）。
//
// 本文件只沉淀【轻量引用】（`*Ref`）—— 供 operation / audit 等记录跨对象关联
// 时携带最小必要标识。完整的当前租户 / principal 视图（含脱敏 email/mobile、
// 角色、scope 列表、token jti、登录来源、组织配置）属 `tenant` / `iam` 命名
// 空间，须待 Go 账号中心端点 + 契约就绪后落地（§9.1）—— 在此之前不实现。

/**
 * 租户轻量引用。
 *
 * 完整租户详情（状态 / 类型 / 产品开通 / 主体类型 / 地区 / 组织配置）见
 * 后续 `tenant` 命名空间。
 */
export interface TenantRef {
  tenantId: string;
  /** 展示名；后端可省略。 */
  name?: string;
}

/**
 * Principal（操作主体）轻量引用。
 *
 * 完整 principal 视图（脱敏联系方式 / 角色 / scope / 认证方式 / token jti /
 * 登录来源）见后续 `iam` 命名空间。前端【不自解 JWT】推断身份（§1.1 复核
 * 边界）—— 一律由 SDK 暴露稳定 principal。
 */
export interface PrincipalRef {
  principalId: string;
  /** 关联用户 id；与 `principalId` 可能不同（同一用户多 principal）。 */
  userId?: string;
  /** 所属租户 id。 */
  tenantId?: string;
  /** 展示名；后端可省略。 */
  displayName?: string;
}

/**
 * API client 轻量引用。
 *
 * 完整 API client 治理（CRUD / secret 轮换 / 回调域名 / IP 白名单 / 调用
 * 日志）见对外鉴权层独立计划范围 —— 本期不实现（用户决策 2026-05-22）。
 */
export interface ApiClientRef {
  clientId: string;
  /** 展示名；后端可省略。 */
  name?: string;
}
