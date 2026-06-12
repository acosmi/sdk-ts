// chatbridge/client.ts — 第三方聊天 bridge 控制面客户端 (Phase 7B 落地).
//
// 端点: /api/v4/chat-bridge/* (nexus-v4 routes_business.go registerChatBridgeRoutes)。
// 契约源: docs/audit/sdk-remote-control-contract-2026-05-27.md §6 + §12 + ADR-8。
//
// Wire 平面 (契约 §12, 与 remote-control 平面不同):
//   - 请求体字段 = snake_case (handler ShouldBindJSON 结构体 tag: app_id /
//     workspace_id / config_json / secret_kind / new_plaintext ...);
//   - 响应 data = model 直接序列化的 camelCase (model/chat_bridge.go json tag:
//     appId / credentialRef / secretKind ...), 与本域 types.ts 逐字一致。
//
// 守卫 (最小授权三档; OAuth token 须显式申请, chat_bridge 不进 allScopes()):
//   - chat_bridge:read   → listIntegrations / getIntegration / listCredentials
//   - chat_bridge:write  → createIntegration / updateIntegrationStatus / storeCredential
//   - chat_bridge:rotate → rotateCredential / revokeCredential (高风险)
//
// 安全红线 (契约 §6 Secret zero-knowledge):
//   - 任何端点不回 plaintext / ciphertext (model Ciphertext/ConfigJSON json:"-");
//   - 创建/轮换的明文只在请求体出现一次, SDK 不缓存不打印;
//   - 跨租户引用服务端一律 404 (不暴露存在性)。

import type { APIResponse } from '../shared/api-response';
import { Client } from '../core/client';
import {
  asCredentialRef,
  type ChatCredentialPublic,
  type ChatIntegration,
  type IntegrationStatus,
  type Platform,
  type Region,
} from './types';

/** `chatBridge.createIntegration()` 请求 (wire snake_case 由 SDK 转换)。 */
export interface CreateIntegrationRequest {
  /** 绑定的 Acosmi app。 */
  appId: string;
  platform: Platform;
  region: Region;
  /** 平台 workspace/企业 原始 ID; 服务端只存 SHA256 hash。 */
  workspaceId?: string;
  /** 平台 bot 原始 ID; 服务端只存 SHA256 hash。 */
  botId?: string;
  /** 仅非敏感配置 (rate limit / feature toggles); 严禁含 secret。 */
  configJson?: string;
}

/** `chatBridge.storeCredential()` 请求 — 明文一次性提交。 */
export interface StoreCredentialRequest {
  /** 凭证种类 (平台相关, 例: app_secret / signing_secret / bot_token)。 */
  secretKind: string;
  /** 凭证明文; 加密落库后即弃, 响应只回 masked 视图。 */
  plaintext: string;
  region?: Region;
  platform?: Platform;
}

declare module '@acosmi/sdk-ts' {
  interface Client {
    /** 第三方聊天 bridge 控制面 (Phase 7B; 契约 §6/§12/ADR-8)。 */
    readonly chatBridge: ChatBridgeClient;
  }
}

const chatBridgeByClient = new WeakMap<Client, ChatBridgeClient>();

Object.defineProperty(Client.prototype, 'chatBridge', {
  configurable: true,
  enumerable: false,
  get(this: Client): ChatBridgeClient {
    let existing = chatBridgeByClient.get(this);
    if (!existing) {
      existing = new ChatBridgeClient(this);
      chatBridgeByClient.set(this, existing);
    }
    return existing;
  },
});

export class ChatBridgeClient {
  constructor(private readonly client: Client) {}

  // ---------------------------------------------------------------------------
  // Integration 管理面
  // ---------------------------------------------------------------------------

  /** 创建平台集成 (chat_bridge:write)。云端控制台与下游 (CrabCode) 调的是同一端点/同一份数据。 */
  async createIntegration(
    req: CreateIntegrationRequest,
    signal?: AbortSignal,
  ): Promise<ChatIntegration> {
    const resp = await this.client.doJSON<APIResponse<ChatIntegration>>(
      'POST',
      '/chat-bridge/integrations',
      {
        app_id: req.appId,
        platform: req.platform,
        region: req.region,
        workspace_id: req.workspaceId,
        bot_id: req.botId,
        config_json: req.configJson,
      },
      signal,
    );
    return resp.data;
  }

  /** 列出本租户集成 (chat_bridge:read; masked 视图)。可按 appId 过滤。 */
  async listIntegrations(appId?: string, signal?: AbortSignal): Promise<ChatIntegration[]> {
    const qs = appId ? `?app_id=${encodeURIComponent(appId)}` : '';
    const resp = await this.client.doJSON<APIResponse<{ items?: ChatIntegration[] }>>(
      'GET',
      `/chat-bridge/integrations${qs}`,
      null,
      signal,
    );
    return resp.data?.items ?? [];
  }

  /** 取单个集成 (chat_bridge:read)。不存在/跨租户一律 404。 */
  async getIntegration(id: string, signal?: AbortSignal): Promise<ChatIntegration> {
    const resp = await this.client.doJSON<APIResponse<ChatIntegration>>(
      'GET',
      `/chat-bridge/integrations/${encodeURIComponent(id)}`,
      null,
      signal,
    );
    return resp.data;
  }

  /** 更新集成状态 (chat_bridge:write): pending | active | suspended | revoked。 */
  async updateIntegrationStatus(
    id: string,
    status: IntegrationStatus,
    signal?: AbortSignal,
  ): Promise<void> {
    await this.client.doJSON<APIResponse<{ ok?: boolean }>>(
      'PATCH',
      `/chat-bridge/integrations/${encodeURIComponent(id)}/status`,
      { status },
      signal,
    );
  }

  // ---------------------------------------------------------------------------
  // Credential 管理面 (vault)
  // ---------------------------------------------------------------------------

  /** 存凭证 (chat_bridge:write) — 明文一次性提交, 返回 masked 记录 (ref+fingerprint)。 */
  async storeCredential(
    integrationId: string,
    req: StoreCredentialRequest,
    signal?: AbortSignal,
  ): Promise<ChatCredentialPublic> {
    const resp = await this.client.doJSON<APIResponse<ChatCredentialPublic>>(
      'POST',
      `/chat-bridge/integrations/${encodeURIComponent(integrationId)}/credentials`,
      {
        secret_kind: req.secretKind,
        plaintext: req.plaintext,
        region: req.region,
        platform: req.platform,
      },
      signal,
    );
    return brandCredential(resp.data);
  }

  /** 列出集成的凭证 (chat_bridge:read; masked, 永不含明文/密文)。 */
  async listCredentials(
    integrationId: string,
    signal?: AbortSignal,
  ): Promise<ChatCredentialPublic[]> {
    const resp = await this.client.doJSON<APIResponse<{ items?: ChatCredentialPublic[] }>>(
      'GET',
      `/chat-bridge/integrations/${encodeURIComponent(integrationId)}/credentials`,
      null,
      signal,
    );
    return (resp.data?.items ?? []).map(brandCredential);
  }

  /** 轮换凭证 (chat_bridge:rotate, 高风险) — ref 不变, fingerprint 更新。 */
  async rotateCredential(
    integrationId: string,
    secretKind: string,
    newPlaintext: string,
    signal?: AbortSignal,
  ): Promise<ChatCredentialPublic> {
    const resp = await this.client.doJSON<APIResponse<ChatCredentialPublic>>(
      'POST',
      `/chat-bridge/integrations/${encodeURIComponent(integrationId)}/credentials/rotate`,
      { secret_kind: secretKind, new_plaintext: newPlaintext },
      signal,
    );
    return brandCredential(resp.data);
  }

  /** 吊销凭证 (chat_bridge:rotate) — 软吊销 + 服务端抹密文。 */
  async revokeCredential(credentialRef: string, signal?: AbortSignal): Promise<void> {
    await this.client.doJSON<APIResponse<{ ok?: boolean }>>(
      'POST',
      `/chat-bridge/credentials/${encodeURIComponent(credentialRef)}/revoke`,
      {},
      signal,
    );
  }
}

// 服务端返回的 credentialRef 是裸 string; 出 SDK 边界前统一 brand 成 CredentialRef
// (运行时恒等, 只改类型), 防止与 plaintext 字符串互窜 (types.ts branded 约定)。
function brandCredential(c: ChatCredentialPublic): ChatCredentialPublic {
  if (c && typeof c.credentialRef === 'string') {
    return { ...c, credentialRef: asCredentialRef(c.credentialRef) };
  }
  return c;
}
