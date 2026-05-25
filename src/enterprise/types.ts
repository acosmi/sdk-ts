// enterprise/types.ts — 企业席位 (P6a) 公开类型 (商品化总规划 2026-05-25).
//
// 与 tk-dist `dist_enterprise_*` + `dist_org_subscription` + `dist_org_seat` 五表族对齐.
// §-1.2.D 钉死 4 项: 销售对接 ≥200 席 / 月度变更 3 次/订阅 / per_seat_cap = pool/seats×1.5 / pool = seats × Pro Max × 0.8.

/** 企业组织公开视图 (PII L3 字段 contactPhone/Email 仅 OWNER/ADMIN 可见). */
export interface EnterpriseSummary {
  id: number;
  orgName: string;
  /** 工商注册号. */
  orgCode?: string;
  legalRepresentative?: string;
  /** 主联系人 user_id (UUID, 仅 OWNER 可见). */
  contactUserId?: string;
  contactPhone?: string;
  contactEmail?: string;
  /** 销售对接人 user_id (UUID, §-1.2.D ≥200 席自动绑定). */
  salesRepUserId?: string;
  /** CN / OVERSEAS. */
  regionScope?: string;
  /** ACTIVE / SUSPENDED / TERMINATED. */
  status?: string;
}

/** 企业成员视图. */
export interface EnterpriseMember {
  id: number;
  enterpriseId: number;
  /** UUID. */
  userId: string;
  /** OWNER / ADMIN / MEMBER. */
  role: string;
  department?: string;
  joinedAt?: string;
  leftAt?: string;
  /** ACTIVE / INACTIVE. */
  status?: string;
}

/** 企业订阅视图 — 派生计算字段 perSeatMonthlyCapTk / poolTotalTk 由后端在 createFromOrgOrder 写入. */
export interface OrgSubscription {
  id: number;
  enterpriseId: number;
  planId: number;
  /** ENT_PRO / ENT_ULTRA. */
  planCode: string;
  seatCountPurchased: number;
  seatCountAssigned: number;
  totalPriceFen: number;
  /** 阶梯折扣命中值 (0.85 = 15% off). */
  discountRate?: number;
  billingCycle?: string;
  /** §-1.3 W-3 字段名, 与个人订阅一致. */
  nextDeductDate?: string;
  /** §-1.2.D 钉死 3. */
  seatChangeMaxPerMonth: number;
  seatChangeUsedThisMonth: number;
  /** §-1.2.D 钉死 200. */
  salesTakeoverThreshold: number;
  /** 派生: pool/seats × 1.5. */
  perSeatMonthlyCapTk?: number;
  /** 派生: seats × Pro Max × 0.8. */
  poolTotalTk?: number;
  poolUsedTk?: number;
  /** SHARED / PER_SEAT / HYBRID (P6a 阶段仅 SHARED). */
  poolMode?: string;
  /** ACTIVE / PAUSED / EXPIRED / CANCELED. */
  status?: string;
  startedAt?: string;
  expiresAt?: string;
}

/** 企业席位视图. */
export interface OrgSeat {
  id: number;
  orgSubscriptionId: number;
  /** 1..N. */
  seatNo: number;
  /** AVAILABLE / ASSIGNED / REVOKED. */
  status: string;
  assignedMemberId?: number;
  /** UUID. */
  assignedUserId?: string;
  /** 单席位月度配额 override (NULL = 走订阅默认 perSeatMonthlyCapTk). */
  perSeatMonthlyCapTk?: number;
  usedTkThisMonth?: number;
}

/** 邀请成员请求 (P6a 简化: 直接 add, 不走邀请确认流程). */
export interface InviteMemberRequest {
  enterpriseId: number;
  userId: string;
  role?: 'OWNER' | 'ADMIN' | 'MEMBER';
  department?: string;
}

/** 分配席位请求. */
export interface AssignSeatRequest {
  subscriptionId: number;
  memberId: number;
  note?: string;
}

/** 企业消耗汇总视图 (P6a 简化: 订阅维度池子汇总; 完整账单留 P6b). */
export interface OrgConsumeReport {
  enterpriseId: number;
  subscriptionCount: number;
  totalPoolTk: number;
  totalUsedTk: number;
  totalPriceFen: number;
  note?: string;
}
