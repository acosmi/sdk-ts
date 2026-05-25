// enterprise/index.ts — 企业席位 (P6a) namespace barrel (商品化总规划 2026-05-25).
//
// 与 tk-dist `dist_enterprise_*` + `dist_org_subscription` + `dist_org_seat` 五表族对齐;
// §-1.2.D 钉死 4 项: 销售对接 ≥200 席 / 月度变更 3 次/订阅 / per_seat_cap = pool/seats×1.5 / pool = seats × Pro Max × 0.8.
//
// admin 板块 9 controllers 由 admin UI 直连; SDK 暴露登录态 + 跨身份共用端点.

export * from './types';

// side-effect import 注入到 Client.prototype
import './client';
