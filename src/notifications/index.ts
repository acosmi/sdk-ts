// notifications/index.ts — 通知域 barrel
//
// 收口通知类型与 WS 配置。
//
// 通知业务方法与 WS 订阅通过 side-effect import 注入到 Client.prototype。
// notifications.ts 无自身导出，必须保留在模块图中；ws.ts 既被 side-effect import
// (注入 prototype) 又导出 WSConfig 类型。

// === 类型 ===
export * from './types';

// === 业务方法 — side-effect import 注入到 Client.prototype ===
import './notifications';
import './ws';

export type { WSConfig } from './ws';
