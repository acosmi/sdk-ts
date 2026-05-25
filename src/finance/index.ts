// finance/index.ts — 财务 P7 namespace barrel (商品化总规划 2026-05-25).
//
// 与 tk-dist `dist_invoice` / `dist_refund_*` / `dist_corporate_transfer` 表族对接.
// 决策 14 (对公转账零银行 API) + 决策 15 (退款规则按 Policy 表配置).
//
// admin 板块 (审批 / 财务工作台 / 对账) 由 admin UI 直连 `/api/admin/finance/**`,
// 不在 SDK 边界.

export * from './types';

// side-effect import 注入到 Client.prototype
import './client';
