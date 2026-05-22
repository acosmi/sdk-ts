// skills/index.ts — 技能 / 工具域 barrel
//
// 收口 skill store / tool 类型。
//
// 业务方法 (listSkills / listTools 等) 通过 side-effect import 注入到
// Client.prototype — 这些 mixin 文件无自身导出，必须保留在模块图中。

// === 类型 ===
export * from './types';

// === 业务方法 — side-effect import 注入到 Client.prototype ===
import './skills';
import './tools';
