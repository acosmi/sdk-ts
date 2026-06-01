// C3 (P2-3): 空成功响应 (HTTP 204 / 200 空体) 不应 JSON.parse('') 抛错。
import { describe, expect, it } from 'vitest';
import { Client } from '../src';

const future = new Date(Date.now() + 60_000).toISOString();

function clientWithFetch(fetchImpl: typeof fetch): Client {
  const client = new Client({ serverURL: 'https://nexus.test', fetchImpl });
  client.tokens = {
    access_token: 'token-1',
    refresh_token: 'refresh-1',
    expires_at: future,
    scope: 'ai',
    client_id: 'client-1',
    server_url: 'https://nexus.test',
  };
  return client;
}

function emptyResp(status: number): Response {
  // 204 不允许带 body; 200 用空字符串体模拟空成功响应。
  return status === 204
    ? new Response(null, { status: 204 })
    : new Response('', { status: 200 });
}

describe('core doJSON — 空成功响应', () => {
  it('HTTP 204 空体 → 返回 undefined, 不抛 JSON parse error', async () => {
    const client = clientWithFetch(async () => emptyResp(204));
    const result = await client.doJSON<unknown>('DELETE', '/some/resource', null);
    expect(result).toBeUndefined();
  });

  it('HTTP 200 空体 → 返回 undefined, 不抛 JSON parse error', async () => {
    const client = clientWithFetch(async () => emptyResp(200));
    const result = await client.doJSON<unknown>('POST', '/some/action', null);
    expect(result).toBeUndefined();
  });
});

describe('agent-runs requestAPI — 空成功响应不抛 JSON parse error', () => {
  it('200 空体 → 不抛 SyntaxError / JSON parse error', async () => {
    const client = clientWithFetch(async () => emptyResp(200));
    // requestAPI 私有, 经 cancel() 公开方法触发; 空响应 → requestAPI 返回 undefined,
    // 下游 mapper 可能因 undefined 另抛业务错误, 但绝不应是 JSON.parse('') 的 SyntaxError。
    let caught: unknown;
    try {
      await client.agentRuns.cancel('run_1');
    } catch (e) {
      caught = e;
    }
    if (caught !== undefined) {
      expect(caught).not.toBeInstanceOf(SyntaxError);
      const msg = caught instanceof Error ? caught.message : String(caught);
      expect(msg).not.toMatch(/JSON|Unexpected end of/i);
    }
  });
});
