// C1 (P2-1): 非法 token 过期判断 + store 形状校验回归。
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileTokenStore, isValidTokenSet, tokenSetIsExpired, type TokenSet } from '../src';

const validTokenSet = (): TokenSet => ({
  access_token: 'AT',
  refresh_token: 'RT',
  expires_at: new Date(Date.now() + 3600_000).toISOString(),
  scope: 'ai',
  client_id: 'client-1',
  server_url: 'https://nexus.test',
});

describe('tokenSetIsExpired — 非法 expires_at', () => {
  it('expires_at = "not-a-date" → 视为已过期 (true)', () => {
    const t = { ...validTokenSet(), expires_at: 'not-a-date' };
    expect(tokenSetIsExpired(t)).toBe(true);
  });

  it('expires_at = "" → 视为已过期 (true)', () => {
    const t = { ...validTokenSet(), expires_at: '' };
    expect(tokenSetIsExpired(t)).toBe(true);
  });

  it('合法未来时间 → 未过期 (false)', () => {
    expect(tokenSetIsExpired(validTokenSet())).toBe(false);
  });

  it('合法过去时间 → 已过期 (true)', () => {
    const t = { ...validTokenSet(), expires_at: new Date(Date.now() - 3600_000).toISOString() };
    expect(tokenSetIsExpired(t)).toBe(true);
  });
});

describe('isValidTokenSet 形状校验', () => {
  it('完整对象 → true', () => {
    expect(isValidTokenSet(validTokenSet())).toBe(true);
  });

  it('缺字段 (无 server_url) → false', () => {
    const { server_url: _omit, ...rest } = validTokenSet();
    expect(isValidTokenSet(rest)).toBe(false);
  });

  it('字段类型错 (expires_at 是 number) → false', () => {
    expect(isValidTokenSet({ ...validTokenSet(), expires_at: 12345 })).toBe(false);
  });

  it('非对象 / null → false', () => {
    expect(isValidTokenSet(null)).toBe(false);
    expect(isValidTokenSet('string')).toBe(false);
    expect(isValidTokenSet(42)).toBe(false);
  });
});

describe('FileTokenStore.load — 损坏 / 缺字段文件返回 null (不抛错)', () => {
  let tmpDir: string;
  let tokenPath: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'acosmi-store-validation-'));
    tokenPath = join(tmpDir, 'tokens.json');
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('损坏 JSON → load 返回 null', async () => {
    await writeFile(tokenPath, '{ this is not valid json ', 'utf8');
    const s = new FileTokenStore(tokenPath);
    await expect(s.load()).resolves.toBeNull();
  });

  it('缺字段 token 文件 → load 返回 null', async () => {
    await writeFile(tokenPath, JSON.stringify({ access_token: 'AT' }), 'utf8');
    const s = new FileTokenStore(tokenPath);
    await expect(s.load()).resolves.toBeNull();
  });

  it('字段类型错 (expires_at 非 string) → load 返回 null', async () => {
    await writeFile(
      tokenPath,
      JSON.stringify({ ...validTokenSet(), expires_at: 999 }),
      'utf8',
    );
    const s = new FileTokenStore(tokenPath);
    await expect(s.load()).resolves.toBeNull();
  });

  it('合法 token 文件 → load 正常返回', async () => {
    const t = validTokenSet();
    await writeFile(tokenPath, JSON.stringify(t), 'utf8');
    const s = new FileTokenStore(tokenPath);
    await expect(s.load()).resolves.toEqual(t);
  });
});
