// =============================================================================
// 文件: acosmi-sdk-ts/test/chatbridge-types.test.ts
// 模块: chatbridge | Phase 7 骨架 — 类型导出 / runtime guard 烟雾测试
// 契约: docs/audit/sdk-remote-control-contract-2026-05-27.md §6 + §7 + ADR-8
// =============================================================================

import { describe, expect, it } from 'vitest';

import {
  ALL_INTEGRATION_STATUS,
  ALL_PLATFORMS,
  ALL_REGIONS,
  asCredentialRef,
  isChannelInboundEvent,
  isIntegrationStatus,
  isPlatform,
  isRegion,
  type ChannelInboundEvent,
  type ChatCredentialPublic,
  type ChatIntegration,
  type CredentialRef,
  type Platform,
  type Region,
} from '../src/index';

describe('chatbridge — 7 platforms', () => {
  it('ALL_PLATFORMS covers 7 supported chat platforms', () => {
    expect(ALL_PLATFORMS).toEqual([
      'feishu',
      'wecom',
      'dingtalk',
      'slack',
      'teams',
      'telegram',
      'whatsapp',
    ]);
  });

  it('isPlatform accepts all 7 enum values and rejects unknowns', () => {
    for (const p of ALL_PLATFORMS) {
      expect(isPlatform(p)).toBe(true);
    }
    for (const bad of ['', 'discord', 'wechat', 'FEISHU', 'qq', null, undefined, 42, {}]) {
      expect(isPlatform(bad)).toBe(false);
    }
  });
});

describe('chatbridge — region & status', () => {
  it('isRegion accepts cn/intl only', () => {
    expect(ALL_REGIONS).toEqual(['cn', 'intl']);
    for (const r of ALL_REGIONS) {
      expect(isRegion(r)).toBe(true);
    }
    for (const bad of ['us', 'eu', 'CN', 'global', '']) {
      expect(isRegion(bad)).toBe(false);
    }
  });

  it('isIntegrationStatus accepts 4 enum values', () => {
    expect(ALL_INTEGRATION_STATUS).toEqual(['pending', 'active', 'suspended', 'revoked']);
    for (const s of ALL_INTEGRATION_STATUS) {
      expect(isIntegrationStatus(s)).toBe(true);
    }
    for (const bad of ['PENDING', 'draft', 'deleted', '']) {
      expect(isIntegrationStatus(bad)).toBe(false);
    }
  });
});

describe('chatbridge — ChannelInboundEvent type guard', () => {
  it('accepts a minimal valid inbound event', () => {
    const wire: unknown = {
      platform: 'feishu',
      threadHash: 'abc123',
      content: 'hi',
    };
    expect(isChannelInboundEvent(wire)).toBe(true);
    if (isChannelInboundEvent(wire)) {
      const narrowed: ChannelInboundEvent = wire;
      expect(narrowed.platform).toBe('feishu');
    }
  });

  it('rejects events with missing or invalid fields', () => {
    expect(isChannelInboundEvent({})).toBe(false);
    expect(isChannelInboundEvent({ platform: 'feishu' })).toBe(false);
    expect(isChannelInboundEvent({ platform: 'feishu', threadHash: '' })).toBe(false);
    expect(isChannelInboundEvent({ platform: 'discord', threadHash: 'h', content: 'x' })).toBe(
      false,
    );
    expect(isChannelInboundEvent(null)).toBe(false);
    expect(isChannelInboundEvent([])).toBe(false);
    expect(isChannelInboundEvent('string')).toBe(false);
  });
});

describe('chatbridge — CredentialRef branded type', () => {
  it('asCredentialRef brands a string without altering it', () => {
    const ref: CredentialRef = asCredentialRef('cred_abcdefghijklmnopqrwxyz');
    expect(ref).toBe('cred_abcdefghijklmnopqrwxyz');
  });

  it('ChatCredentialPublic surface excludes ciphertext / plaintext fields (compile-time smoke)', () => {
    const view: ChatCredentialPublic = {
      credentialRef: asCredentialRef('cred_xxx'),
      integrationId: 'int-1',
      platform: 'slack' as Platform,
      region: 'intl' as Region,
      secretKind: 'bot_token',
      fingerprint: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      keyId: 'v1',
      version: 1,
      status: 'active',
    };
    expect(view.credentialRef).toBe('cred_xxx');
    // 编译期保证: ChatCredentialPublic 没有 ciphertext / plaintext / token 等字段。
    // 任何后续 PR 误加这类字段会让本测试编译失败 (TS 严格模式)。
    expect(Object.keys(view)).not.toContain('ciphertext');
    expect(Object.keys(view)).not.toContain('plaintext');
  });
});

describe('chatbridge — barrel re-export reachable from src/index', () => {
  it('ChatIntegration / ChatCredentialPublic / ChannelInboundEvent types reachable', () => {
    // 类型级 smoke: 引用即可, 让 tsc 校验导出存在。
    const integration: ChatIntegration = {
      id: 'i-1',
      tenantId: 't-1',
      appId: 'a-1',
      platform: 'feishu',
      region: 'cn',
      status: 'pending',
    };
    expect(integration.platform).toBe('feishu');
  });
});
