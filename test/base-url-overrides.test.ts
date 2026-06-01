// C4 (P2-4): apiBaseURL / complianceBaseURL override 归一化校验。
import { describe, expect, it } from 'vitest';
import { Client, normalizeOverrideBaseURL } from '../src';

describe('Client override base URL 校验', () => {
  const bad: Array<[string, string]> = [
    ['ws 协议', 'ws://acosmi.com'],
    ['wss 协议', 'wss://acosmi.com'],
    ['带 query', 'https://acosmi.com/admin-api?x=1'],
    ['带 hash', 'https://acosmi.com/admin-api#frag'],
    ['无 host (https:// 裸)', 'https://'],
    ['非 URL', 'not a url'],
  ];

  for (const [label, value] of bad) {
    it(`apiBaseURL ${label} → 构造抛错`, () => {
      expect(() => new Client({ serverURL: 'https://acosmi.com', apiBaseURL: value })).toThrow();
    });
    it(`complianceBaseURL ${label} → 构造抛错`, () => {
      expect(
        () => new Client({ serverURL: 'https://acosmi.com', complianceBaseURL: value }),
      ).toThrow();
    });
  }

  it('合法 https → 正常构造, 去尾随 /', () => {
    const c = new Client({
      serverURL: 'https://acosmi.com',
      apiBaseURL: 'https://api.acosmi.com/',
      complianceBaseURL: 'https://acosmi.com/',
    });
    expect(c).toBeInstanceOf(Client);
  });

  it('未配置 → 保持 null 语义 (不抛错)', () => {
    expect(() => new Client({ serverURL: 'https://acosmi.com' })).not.toThrow();
  });
});

describe('normalizeOverrideBaseURL helper', () => {
  it('合法 https 去尾随 /', () => {
    expect(normalizeOverrideBaseURL('https://acosmi.com/admin-api/', 'complianceBaseURL')).toBe(
      'https://acosmi.com/admin-api',
    );
  });

  it('仅 origin 返回 origin', () => {
    expect(normalizeOverrideBaseURL('https://acosmi.com', 'apiBaseURL')).toBe('https://acosmi.com');
  });

  it('ws 协议抛错, 错误带 label', () => {
    expect(() => normalizeOverrideBaseURL('ws://acosmi.com', 'apiBaseURL')).toThrow(/apiBaseURL/);
  });

  it('带 query 抛错', () => {
    expect(() => normalizeOverrideBaseURL('https://acosmi.com?x=1', 'apiBaseURL')).toThrow(
      /query or hash/,
    );
  });

  it('空串抛错', () => {
    expect(() => normalizeOverrideBaseURL('   ', 'complianceBaseURL')).toThrow(/empty/);
  });
});
