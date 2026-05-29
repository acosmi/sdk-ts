// chatbridge/index.ts — Chat Bridge 域 barrel (Phase 7 骨架).
//
// 契约: docs/audit/sdk-remote-control-contract-2026-05-27.md §6 + §7 + ADR-8.
//
// 当前仅暴露 read-only metadata + ChannelEvent types + 7 平台 / 区域 / 状态枚举与
// type guards。Phase 7B / Phase 8 落地具体客户端方法 (install / revoke / send /
// subscribe events) 后, 在此 barrel 追加 export。
//
// 红线: 平台 secret (plaintext / token / signing key) 永不出现在本 barrel 导出。

export * from './types';
