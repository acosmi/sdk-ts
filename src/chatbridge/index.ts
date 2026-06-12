// chatbridge/index.ts — Chat Bridge 域 barrel (Phase 7B 客户端落地).
//
// 契约: docs/audit/sdk-remote-control-contract-2026-05-27.md §6 + §7 + §12 + ADR-8.
//
// 暴露: read-only metadata + ChannelEvent types + 7 平台 / 区域 / 状态枚举与
// type guards + ChatBridgeClient (integration/credential 管理面 CRUD;
// declaration-merge chatBridge getter 到 Client.prototype)。Phase 8 平台
// adapter 落地后追加 send / subscribe events。
//
// 红线: 平台 secret (plaintext / token / signing key) 永不出现在本 barrel 导出 —
// storeCredential/rotateCredential 的明文只进请求体一次, 响应恒为 masked 视图。

export * from './types';

// === 子客户端 (导出类 + declaration-merge chatBridge getter 到 Client.prototype) ===
export * from './client';
