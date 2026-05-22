// billing/index.ts — 计费域 barrel
//
// 收口 entitlements / packages / wallet 类型。运行时承载 billing / metering /
// entitlements 三个命名空间。
//
// 业务方法 (getBalance / listPackages / getWalletStats 等) 通过 side-effect import
// 注入到 Client.prototype — 这些 mixin 文件无自身导出，必须保留在模块图中。

// === 类型 ===
export * from './types';

// === 业务方法 — side-effect import 注入到 Client.prototype ===
import './entitlements';
import './packages';
import './wallet';
