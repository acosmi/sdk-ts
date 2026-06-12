// agent-runs/byok.ts — CrabCode 远控 BYO 模型密钥管理面 (契约 §18.2, W4 2026-06-10).
//
// 端点: /api/v4/crabcode/byok-credentials (wire snake_case; remote-control 平面)。
// 守卫: AuthOrDesktopScope("remote_control") — 网页 JWT 用户直接过 (自管自己的
// 密钥), desktop/SDK OAuth token 须显式 remote_control scope。
//
// 安全红线 (契约 §6 附录 A):
//   - 任何端点不回 plaintext / ciphertext; 创建/轮换的明文只在请求体出现一次,
//     加密落库后即弃; 列表一律 masked 视图 (ref + fingerprint + 元数据);
//   - 调用方拿到的 credentialRef 是唯一可持有的引用 —— 把它传给
//     `agentRuns.createRemoteRun({ byokCredentialRef })` (仅 runner='cloud');
//     解密只发生在网关 launchCloudRunner 的子进程 env 注入点;
//   - SDK 不缓存、不打印明文; 调用方同样不应将明文落任何持久化存储。

import type { APIResponse } from '../shared/api-response';
import { Client } from '../core/client';

/** 允许的第三方提供商 (与网关 byokAllowedProviders / managed_model Provider 谱系对齐)。 */
export type ByokProvider =
  | 'anthropic'
  | 'openai'
  | 'deepseek'
  | 'dashscope'
  | 'zhipu'
  | 'volcengine'
  | 'custom';

export type ByokCredentialStatus = 'active' | 'revoked';

/** BYOK 密钥 masked 视图 — 永不含明文/密文。 */
export interface ByokCredential {
  credentialRef: string;
  provider: ByokProvider | string;
  name?: string;
  /** 仅 provider='custom' 时存在 (https:// 起始)。 */
  baseUrl?: string;
  /** 明文指纹 (轮换后变化; 用于"是否同一把钥匙"的人工核对)。 */
  fingerprint?: string;
  status: ByokCredentialStatus | string;
  createdAt?: string;
  lastUsedAt?: string;
}

/** `crabcodeByok.create()` 请求。明文一次性提交, 服务端加密落库后即弃。 */
export interface ByokCreateRequest {
  provider: ByokProvider;
  /** API key 明文; ≤4KB, 不得含换行。 */
  plaintext: string;
  /** 显示名; ≤100 字符。 */
  name?: string;
  /** 仅 provider='custom' 必填 (必须 https://); 其他 provider 不可设。 */
  baseUrl?: string;
}

interface WireByokCredential {
  credential_ref?: string;
  provider?: string;
  name?: string;
  base_url?: string;
  fingerprint?: string;
  status?: string;
  created_at?: string;
  last_used_at?: string;
}

function fromWireByok(v: WireByokCredential): ByokCredential {
  return {
    credentialRef: v.credential_ref ?? '',
    provider: v.provider ?? '',
    name: v.name || undefined,
    baseUrl: v.base_url || undefined,
    fingerprint: v.fingerprint || undefined,
    status: v.status ?? '',
    createdAt: v.created_at || undefined,
    lastUsedAt: v.last_used_at || undefined,
  };
}

declare module '@acosmi/sdk-ts' {
  interface Client {
    /** CrabCode 远控 BYO 模型密钥管理面 (契约 §18.2)。 */
    readonly crabcodeByok: CrabCodeByokClient;
  }
}

const byokByClient = new WeakMap<Client, CrabCodeByokClient>();

Object.defineProperty(Client.prototype, 'crabcodeByok', {
  configurable: true,
  enumerable: false,
  get(this: Client): CrabCodeByokClient {
    let existing = byokByClient.get(this);
    if (!existing) {
      existing = new CrabCodeByokClient(this);
      byokByClient.set(this, existing);
    }
    return existing;
  },
});

export class CrabCodeByokClient {
  constructor(private readonly client: Client) {}

  /** 列出调用者自己的密钥 (masked; 新→旧, 服务端上限 100 条)。 */
  async list(signal?: AbortSignal): Promise<ByokCredential[]> {
    const resp = await this.client.doJSON<APIResponse<{ items?: WireByokCredential[] }>>(
      'GET',
      '/crabcode/byok-credentials',
      null,
      signal,
    );
    return (resp.data?.items ?? []).map(fromWireByok);
  }

  /**
   * 创建密钥 — 明文一次性提交, 返回 masked 视图。
   * 单用户上限 20 把; provider='custom' 必须带 https:// baseUrl。
   */
  async create(req: ByokCreateRequest, signal?: AbortSignal): Promise<ByokCredential> {
    const resp = await this.client.doJSON<APIResponse<WireByokCredential>>(
      'POST',
      '/crabcode/byok-credentials',
      {
        provider: req.provider,
        name: req.name,
        base_url: req.baseUrl,
        plaintext: req.plaintext,
      },
      signal,
    );
    return fromWireByok(resp.data ?? {});
  }

  /** 轮换密钥明文 — credentialRef 不变, fingerprint 更新。已吊销的密钥不可轮换 (400)。 */
  async rotate(
    credentialRef: string,
    newPlaintext: string,
    signal?: AbortSignal,
  ): Promise<ByokCredential> {
    const resp = await this.client.doJSON<APIResponse<WireByokCredential>>(
      'POST',
      `/crabcode/byok-credentials/${encodeURIComponent(credentialRef)}/rotate`,
      { new_plaintext: newPlaintext },
      signal,
    );
    return fromWireByok(resp.data ?? {});
  }

  /** 吊销密钥 (软状态 + 服务端抹密文, 不可恢复; 幂等 — 重复吊销返回当前视图)。 */
  async revoke(credentialRef: string, signal?: AbortSignal): Promise<ByokCredential> {
    const resp = await this.client.doJSON<APIResponse<WireByokCredential>>(
      'POST',
      `/crabcode/byok-credentials/${encodeURIComponent(credentialRef)}/revoke`,
      {},
      signal,
    );
    return fromWireByok(resp.data ?? {});
  }
}
