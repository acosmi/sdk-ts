// node.ts — Node 特化入口
//
// 与 src/index.ts 完全等价 — Client 默认 TokenStore = FileTokenStore (~/.acosmi/tokens.json),
// fetch + WebSocket 在 Node 18+ 已是全局。
//
// authorize() 在 Node 启动本地 HTTP callback server, 跨平台打开浏览器。

export * from './index';
export { FileTokenStore as DefaultNodeTokenStore } from './store';
