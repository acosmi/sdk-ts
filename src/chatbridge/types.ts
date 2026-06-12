// Acosmi 第三方聊天 bridge 控制面 — SDK 类型契约 (Phase 7 骨架).
//
// 契约源: docs/audit/sdk-remote-control-contract-2026-05-27.md §6 (Secret zero-knowledge)
//        + §7 (旧抽象不可复用) + 主索引 §5 Phase 7 + ADR-8.
//
// 设计纪律:
//   - chatbridge 资源 GET 走 nexus-v4 model-direct 序列化, wire 字段为 camelCase
//     (与 model/chat_bridge.go 的 json tag 逐字一致; 契约 §12 chatbridge 平面)。
//     注意: 这与 remote-control 平面 (agent-runs 事件/policy 用 snake_case) 不同 ——
//     nexus-v4 的 wire 约定按平面分, 不是全局统一;
//   - 公开 TypeScript API 与 wire 同为 camelCase;
//   - 平台 secret (plaintext / token / signing key) 永不出现在 SDK 公共 namespace;
//     SDK 只见 read-only metadata + CredentialRef + fingerprint + ChannelEvents;
//   - 7 个平台严格枚举, 任何新增需先改契约文档 + 主索引 §5 Phase 7 再扩本文件;
//   - 平台原始 thread / sender / workspace ID 一律 hash 后入 SDK; 永不持原值;
//   - 严禁复用 app_channels / chat_completions / managed-models 承载平台 secret。

// =============================================================================
// Platform / Region / IntegrationStatus (与 Go side `service/chatbridge/types.go` 对齐)
// =============================================================================

export type Platform =
  | 'feishu'
  | 'wecom'
  | 'dingtalk'
  | 'slack'
  | 'teams'
  | 'telegram'
  | 'whatsapp';

export type Region = 'cn' | 'intl';

export type IntegrationStatus = 'pending' | 'active' | 'suspended' | 'revoked';

// =============================================================================
// CredentialRef branded type
// =============================================================================

/**
 * CredentialRef — chat-bridge 凭证公开引用 (`cred_<22 char base32>`).
 *
 * branded type 防止 plaintext secret 字符串被误传到需要 CredentialRef 的位置。
 * SDK 调用方应仅持有 CredentialRef, 永不持 plaintext。
 */
export type CredentialRef = string & { readonly __brand: 'CredentialRef' };

// =============================================================================
// Channel event 公共类型 (read-only events; secret 永不出现)
// =============================================================================

/**
 * ChannelAttachment — 入站附件 / 出站文件附件.
 *
 * 安全约束 (ADR-8):
 *   - `url` 必须由 bridge runtime 解析过 (Acosmi 内部存储 URL); 严禁是平台原始签名 URL。
 *   - `contentType` 是标准 MIME; `kind` 是 bridge 内部分类 (image/file/audio/video/link/...)。
 */
export interface ChannelAttachment {
  kind: string;
  url: string;
  size?: number;
  contentType?: string;
}

/**
 * ChannelCardAction — 出站交互卡片按钮 / 自由输入.
 *
 * `kind`: 'approve' | 'reject' | 'cancel' | 'free_text' | 其他 bridge 自定义。
 * `id` 是 bridge 侧稳定 action id, 用于把用户点击映射回原 requestId 幂等键。
 */
export interface ChannelCardAction {
  kind: string;
  id: string;
  label: string;
}

/**
 * ChannelCard — 出站交互卡片 (permission / tool_status / done / error).
 */
export interface ChannelCard {
  kind: string;
  title: string;
  body: string;
  actions?: ChannelCardAction[];
}

/**
 * ChannelInboundEvent — bridge runtime 视角的入站平台消息.
 *
 * 安全约束:
 *   - `threadHash` / `senderHash` 是 SHA256(平台原始 ID), 不允许直接是平台 ID;
 *   - `metadata` 仅含非敏感字段 (例: locale, message_kind), 严禁含 plaintext secret;
 *   - `messageId` 是平台原生 message id, 仅用于平台侧 ack / dedup, 不进 AgentRun transcript。
 */
export interface ChannelInboundEvent {
  platform: Platform;
  threadHash: string;
  senderHash?: string;
  content: string;
  attachments?: ChannelAttachment[];
  messageId?: string;
  receivedAt?: string; // ISO-8601
  metadata?: Record<string, string>;
}

/**
 * ChannelOutboundEvent — bridge runtime 出站平台消息 / 卡片.
 *
 * Metadata 仅含非敏感投递参数 (例: card_locale), 严禁含 plaintext secret。
 */
export interface ChannelOutboundEvent {
  threadHash: string;
  content?: string;
  cards?: ChannelCard[];
  metadata?: Record<string, string>;
}

/**
 * BridgeThreadRef — bridge runtime 内部 thread 引用 (Acosmi 三元组).
 *
 * 永不携带 platform secret / 原始平台 ID。
 */
export interface BridgeThreadRef {
  threadId: string;
  runId?: string;
  remoteSessionId?: string;
  tenantId: string;
  userId: string;
  appId: string;
}

// =============================================================================
// Public 只读视图 (admin/管理后台 GET 用; 严禁含 Ciphertext / Plaintext)
// =============================================================================

/**
 * ChatIntegration — 平台安装记录的 SDK 只读视图.
 *
 * Phase 7B 起由 `client.chatBridge` 按此型号 GET (响应 camelCase, 契约 §12)。
 */
export interface ChatIntegration {
  id: string;
  tenantId: string;
  appId: string;
  platform: Platform;
  region: Region;
  workspaceIdHash?: string;
  botIdHash?: string;
  status: IntegrationStatus;
  /**
   * @deprecated 服务端从不返回此字段 (model ConfigJSON json:"-", 防 secret 误入
   * 后整体不外发) — 读取恒为 undefined。写入走 createIntegration({ configJson })。
   */
  configJson?: string;
  installedByUserId?: string;
  lastUsedAt?: string;
  createdAt?: string;
  updatedAt?: string;
}

/**
 * ChatCredentialPublic — 凭证的 SDK 只读视图 (绝不含 ciphertext / plaintext).
 *
 * 仅暴露公开字段: `credentialRef` / `fingerprint` / `keyId` / `version` / `status`。
 */
export interface ChatCredentialPublic {
  credentialRef: CredentialRef;
  integrationId: string;
  platform: Platform;
  region: Region;
  secretKind: string;
  fingerprint: string;
  keyId: string;
  version: number;
  status: 'active' | 'rotating' | 'revoked' | string;
  lastUsedAt?: string;
  rotatedAt?: string;
  createdAt?: string;
  updatedAt?: string;
}

/**
 * ChatThread — 平台 thread 到 Acosmi session 的映射 (SDK 只读视图).
 *
 * 永不携带原始 platform thread / sender ID; 仅含 SHA256 hash。
 */
export interface ChatThread {
  id: string;
  tenantId: string;
  integrationId: string;
  platformThreadHash: string;
  platform: Platform;
  userId: string;
  appId: string;
  sessionId?: string;
  lastRunId?: string;
  senderHash?: string;
  lastInboundAt?: string;
  lastOutboundAt?: string;
}

/**
 * ChatBridgeSession — 一次 bridge runtime 会话 (SDK 只读视图).
 */
export interface ChatBridgeSession {
  id: string;
  tenantId: string;
  threadId: string;
  integrationId: string;
  runId?: string;
  remoteSessionId?: string;
  status: 'created' | 'routing' | 'active' | 'paused' | 'closed' | 'errored' | string;
  adapter?: string;
  lastFrameAt?: string;
  closedAt?: string;
  disconnectReason?: string;
  createdAt?: string;
  updatedAt?: string;
}

// =============================================================================
// 平台 / 区域 / 状态 常量集合 (运行时 valid 校验用; SDK runtime 检查匿名外部输入)
// =============================================================================

export const ALL_PLATFORMS: readonly Platform[] = [
  'feishu',
  'wecom',
  'dingtalk',
  'slack',
  'teams',
  'telegram',
  'whatsapp',
] as const;

export const ALL_REGIONS: readonly Region[] = ['cn', 'intl'] as const;

export const ALL_INTEGRATION_STATUS: readonly IntegrationStatus[] = [
  'pending',
  'active',
  'suspended',
  'revoked',
] as const;

/**
 * isPlatform — runtime type guard for {@link Platform}.
 *
 * 用途: SDK 解析 wire payload 时校验未知字段; 不直接抛异常, 调用方决策。
 */
export function isPlatform(v: unknown): v is Platform {
  return typeof v === 'string' && (ALL_PLATFORMS as readonly string[]).includes(v);
}

/**
 * isRegion — runtime type guard for {@link Region}.
 */
export function isRegion(v: unknown): v is Region {
  return typeof v === 'string' && (ALL_REGIONS as readonly string[]).includes(v);
}

/**
 * isIntegrationStatus — runtime type guard for {@link IntegrationStatus}.
 */
export function isIntegrationStatus(v: unknown): v is IntegrationStatus {
  return typeof v === 'string' && (ALL_INTEGRATION_STATUS as readonly string[]).includes(v);
}

/**
 * isChannelInboundEvent — 极简 type guard, 用于 wire payload 入口校验.
 *
 * 仅校验必填字段 (platform/threadHash/content); 其他字段交给调用方按需校验。
 * 不抛异常: 失败返回 false。
 */
export function isChannelInboundEvent(v: unknown): v is ChannelInboundEvent {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return false;
  const r = v as Record<string, unknown>;
  return (
    isPlatform(r.platform) &&
    typeof r.threadHash === 'string' &&
    r.threadHash.length > 0 &&
    typeof r.content === 'string'
  );
}

/**
 * 把任意字符串安全 brand 成 {@link CredentialRef}; 不做合法性校验.
 *
 * Phase 7B SDK 客户端 wire 解析时使用 — 服务端返回的 `credential_ref` 字段一律走它。
 * 调用方自行判断格式 (例: 是否 `cred_` 前缀)。
 */
export function asCredentialRef(s: string): CredentialRef {
  return s as CredentialRef;
}
