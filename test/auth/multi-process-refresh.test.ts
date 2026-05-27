// 回归: 多 Client 共享同一 FileTokenStore 路径时的 refresh token rotation 竞态.
//
// v1.0.1 bug: ensureToken / forceRefresh 在 withMu 内不 reload 磁盘, P2 用旧 R0 撞网关
// 必然 HTTP 400 "refresh token not found".
// v1.0.2 修复: 进入 withMu + storeWithLock 跨进程临界区后, 先 store.load() 重读磁盘.
//
// 这里用 in-process 双 Client 仿真双进程 (FileTokenStore 是真实文件 IO + flock).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  Client,
  FileTokenStore,
  type TokenSet,
  type ServerMetadata,
} from '../../src';

let tmpDir: string;
let tokenPath: string;
let realFetch: typeof globalThis.fetch;

const fakeMeta: ServerMetadata = {
  issuer: 'http://test.invalid',
  authorization_endpoint: 'http://test.invalid/authorize',
  token_endpoint: 'http://test.invalid/token',
  registration_endpoint: 'http://test.invalid/register',
};

function makeTokenSet(refreshTokenValue: string, expiresAtSecondsFromNow: number): TokenSet {
  return {
    access_token: `AT-${refreshTokenValue}`,
    refresh_token: refreshTokenValue,
    expires_at: new Date(Date.now() + expiresAtSecondsFromNow * 1000).toISOString(),
    scope: 'ai',
    client_id: 'test-client',
    server_url: 'http://test.invalid',
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'acosmi-mp-refresh-'));
  tokenPath = join(tmpDir, 'tokens.json');
  realFetch = globalThis.fetch;
});

afterEach(async () => {
  globalThis.fetch = realFetch;
  await rm(tmpDir, { recursive: true, force: true });
});

describe('multi-process refresh token rotation', () => {
  it('P2 命中磁盘上 P1 已 rotation 的新 token, 不撞 HTTP 400 (核心回归)', async () => {
    // 网关行为模拟: 接受旧 RT 一次, 换出新 RT; 旧 RT 之后 invalidated 返 400 invalid_grant.
    const validRefreshTokens = new Set(['R0']);
    let tokenEndpointCalls = 0;
    const seenRTs: string[] = [];

    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url !== 'http://test.invalid/token') {
        return new Response('not-found', { status: 404 });
      }
      tokenEndpointCalls++;
      const body = new URLSearchParams((init?.body as string) ?? '');
      const rt = body.get('refresh_token') ?? '';
      seenRTs.push(rt);
      if (!validRefreshTokens.has(rt)) {
        return jsonResponse(
          { error: 'invalid_grant', error_description: 'refresh token not found' },
          400,
        );
      }
      validRefreshTokens.delete(rt);
      const newRT = `R-after-${rt}`;
      validRefreshTokens.add(newRT);
      return jsonResponse({
        access_token: `AT-${newRT}`,
        refresh_token: newRT,
        token_type: 'Bearer',
        expires_in: 3600,
        scope: 'ai',
      });
    }) as typeof fetch;

    // 两个 Client 共享同一文件路径 (双 FileTokenStore, 各自 chain 独立 → 必然走跨进程 flock)
    const p1 = new Client({
      serverURL: 'http://test.invalid',
      store: new FileTokenStore(tokenPath),
    });
    p1.meta = fakeMeta;
    p1.tokens = makeTokenSet('R0', -10); // 已过期

    const p2 = new Client({
      serverURL: 'http://test.invalid',
      store: new FileTokenStore(tokenPath),
    });
    p2.meta = fakeMeta;
    p2.tokens = makeTokenSet('R0', -10);

    // P1 先 refresh: 用 R0 换出 R-after-R0
    const p1AT = await p1.ensureToken();
    expect(p1AT).toBe('AT-R-after-R0');
    expect(p1.tokens?.refresh_token).toBe('R-after-R0');

    // 磁盘已是新版
    const diskAfterP1 = JSON.parse(await readFile(tokenPath, 'utf8')) as TokenSet;
    expect(diskAfterP1.refresh_token).toBe('R-after-R0');

    // P2 触发 refresh — 修复后: 应该 reload 磁盘 → 采纳新 token → 不调网关
    const p2AT = await p2.ensureToken();
    expect(p2AT).toBe('AT-R-after-R0');
    expect(p2.tokens?.refresh_token).toBe('R-after-R0');

    // 关键断言: 网关只被调用 1 次 (P1 那次), P2 用磁盘新 token 直接返回 — 没用旧 R0 撞 400
    expect(tokenEndpointCalls).toBe(1);
    expect(seenRTs).toEqual(['R0']);
  });

  it('P2 也过期且磁盘是新 RT 但也已过期, P2 用磁盘新 RT refresh 一次成功', async () => {
    const validRefreshTokens = new Set(['R0', 'R1-stale']);
    let tokenEndpointCalls = 0;

    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url !== 'http://test.invalid/token') return new Response('nf', { status: 404 });
      tokenEndpointCalls++;
      const body = new URLSearchParams((init?.body as string) ?? '');
      const rt = body.get('refresh_token') ?? '';
      if (!validRefreshTokens.has(rt)) {
        return jsonResponse({ error: 'invalid_grant' }, 400);
      }
      validRefreshTokens.delete(rt);
      const newRT = `R-after-${rt}`;
      validRefreshTokens.add(newRT);
      return jsonResponse({
        access_token: `AT-${newRT}`,
        refresh_token: newRT,
        token_type: 'Bearer',
        expires_in: 3600,
        scope: 'ai',
      });
    }) as typeof fetch;

    // 磁盘提前写入 P1 已 rotation 但也已过期的 R1-stale (typical: 长时间不用)
    const p2Store = new FileTokenStore(tokenPath);
    await p2Store.save(makeTokenSet('R1-stale', -10));

    const p2 = new Client({ serverURL: 'http://test.invalid', store: p2Store });
    p2.meta = fakeMeta;
    p2.tokens = makeTokenSet('R0', -10); // 内存仍是 R0 旧

    // P2 ensureToken: syncFromDisk 采纳 R1-stale, 仍过期 → 用 R1-stale 去 refresh (成功)
    const p2AT = await p2.ensureToken();
    expect(p2AT).toBe('AT-R-after-R1-stale');
    expect(p2.tokens?.refresh_token).toBe('R-after-R1-stale');
    expect(tokenEndpointCalls).toBe(1);
  });

  it('forceRefresh 也走 syncFromDisk (401 重试路径)', async () => {
    const validRefreshTokens = new Set(['R-disk']);
    let seenRT = '';

    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url !== 'http://test.invalid/token') return new Response('nf', { status: 404 });
      const body = new URLSearchParams((init?.body as string) ?? '');
      seenRT = body.get('refresh_token') ?? '';
      if (!validRefreshTokens.has(seenRT)) return jsonResponse({ error: 'invalid_grant' }, 400);
      validRefreshTokens.delete(seenRT);
      validRefreshTokens.add(`R-after-${seenRT}`);
      return jsonResponse({
        access_token: `AT-R-after-${seenRT}`,
        refresh_token: `R-after-${seenRT}`,
        token_type: 'Bearer',
        expires_in: 3600,
        scope: 'ai',
      });
    }) as typeof fetch;

    const store = new FileTokenStore(tokenPath);
    // 磁盘 = 别的进程刚写入的新 RT (任意过期与否, forceRefresh 不查 expiry, 直接 refresh)
    await store.save(makeTokenSet('R-disk', 3600));

    const c = new Client({ serverURL: 'http://test.invalid', store });
    c.meta = fakeMeta;
    c.tokens = makeTokenSet('R-stale-in-memory', 3600); // 内存还是旧

    await c.forceRefresh();
    // 关键: forceRefresh 调网关时用了磁盘上的 R-disk, 不是内存的 R-stale-in-memory
    expect(seenRT).toBe('R-disk');
    expect(c.tokens?.refresh_token).toBe('R-after-R-disk');
  });

  it('磁盘 RT 与内存一致时不重复 reload 跳网关 (无 rotation 时 0 影响 v1.0.1 行为)', async () => {
    const validRefreshTokens = new Set(['R-same']);
    let tokenEndpointCalls = 0;

    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url !== 'http://test.invalid/token') return new Response('nf', { status: 404 });
      tokenEndpointCalls++;
      const body = new URLSearchParams((init?.body as string) ?? '');
      const rt = body.get('refresh_token') ?? '';
      if (!validRefreshTokens.has(rt)) return jsonResponse({ error: 'invalid_grant' }, 400);
      validRefreshTokens.delete(rt);
      validRefreshTokens.add(`R-after-${rt}`);
      return jsonResponse({
        access_token: `AT-R-after-${rt}`,
        refresh_token: `R-after-${rt}`,
        token_type: 'Bearer',
        expires_in: 3600,
        scope: 'ai',
      });
    }) as typeof fetch;

    const store = new FileTokenStore(tokenPath);
    const tokens = makeTokenSet('R-same', -10);
    await store.save(tokens);

    const c = new Client({ serverURL: 'http://test.invalid', store });
    c.meta = fakeMeta;
    c.tokens = tokens;

    const at = await c.ensureToken();
    expect(at).toBe('AT-R-after-R-same');
    expect(tokenEndpointCalls).toBe(1); // 只刷新一次, 没有因为 reload 多调
  });

  it('refresh_token 已被服务端判定失效时清除本地 token, 防止反复重试', async () => {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url !== 'http://test.invalid/token') return new Response('nf', { status: 404 });
      return jsonResponse(
        { error: 'invalid_grant', error_description: 'refresh token not found' },
        400,
      );
    }) as typeof fetch;

    const staleTokens = makeTokenSet('R-lost-after-deploy', -10);
    const store = new FileTokenStore(tokenPath);
    await store.save(staleTokens);

    const c = new Client({ serverURL: 'http://test.invalid', store });
    c.meta = fakeMeta;
    c.tokens = staleTokens;

    await expect(c.ensureToken()).rejects.toThrow('local tokens cleared');
    expect(c.getTokenSet()).toBeNull();
    expect(await store.load()).toBeNull();
  });
});
