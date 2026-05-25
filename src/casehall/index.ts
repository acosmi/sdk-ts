// casehall/index.ts — 法律案件咨询 namespace barrel (商品化总规划 P5 方案 B 2026-05-25).
//
// 与 tk-dist `yudao-module-casehall` 同源。SDK 仅暴露公开端点视图 + 登录态 me/* 端点;
// admin 板块 9 模块由 admin UI 直连，不在 SDK 边界。

export * from './types';

// side-effect import 注入到 Client.prototype
import './client';
