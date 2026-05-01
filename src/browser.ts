// browser.ts — 浏览器特化入口
//
// 与 src/index.ts 等价, 但默认 TokenStore 用 LocalStorage 而非 File。
// fetch / WebSocket 用浏览器原生 globals。
//
// authorize() 在浏览器调用会抛错 (无法启动 HTTP server)
// — 浏览器侧应自行实现 popup window + redirect handler。

export * from './index';

// 覆盖默认 store 选择策略 — 浏览器 build 时 Client constructor 会按平台检测,
// 但显式 export 给调用方更明确。
export { LocalStorageTokenStore as DefaultBrowserTokenStore } from './store';
