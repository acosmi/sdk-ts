// agent-runs.local-tool-timeout.test.ts — 本地工具硬超时测试 (B2 根因修复)。
//
// 旧实现 `await handler(...)` 仅靠 ctx.signal 做协作式取消; handler 若忽略 signal 会永挂。
// 修复后用 Promise.race 加硬超时: 超时后立即返回稳定失败结果 (ok:false + 'timed out'),
// 不再等待 handler。本测试传一个永不 resolve 的 handler + 极小 timeoutMs, 断言整个
// runWithLocalTools 流程在超时后正常推进 (submitLocalToolResult 收到超时结果), 不挂死。

import { describe, expect, it } from 'vitest';

import { Client } from '../src/index';

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

function jsonResponse(data: unknown): Response {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function sseResponse(frames: string): Response {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(frames));
        controller.close();
      },
    }),
    { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
  );
}

describe('invokeLocalTool 硬超时 (经 runWithLocalTools 触发)', () => {
  it('handler 永不 resolve 时, 超时后返回 ok:false + "timed out", 流程不挂死', async () => {
    const submittedBodies: unknown[] = [];

    const fetchImpl: typeof fetch = async (url, init) => {
      const u = String(url);
      if (u.endsWith('/agent-runs') && init?.method === 'POST') {
        // create
        return jsonResponse({
          code: 0,
          data: { run_id: 'run_1', session_id: 'sess_1', status: 'queued' },
        });
      }
      if (u.includes('/agent-runs/run_1/stream')) {
        // 流: run_started → local_tool_request → DONE
        const frames =
          'event: run_started\n' +
          'data: {"type":"run_started","run_id":"run_1","session_id":"sess_1"}\n\n' +
          'event: local_tool_request\n' +
          'data: {"type":"local_tool_request","request_id":"req_1","name":"slow_tool","input":{}}\n\n' +
          'data: [DONE]\n\n';
        return sseResponse(frames);
      }
      if (u.includes('/agent-runs/run_1/local-tool-results') && init?.method === 'POST') {
        submittedBodies.push(JSON.parse(String(init?.body)));
        return jsonResponse({ code: 0, data: { run_id: 'run_1', status: 'running' } });
      }
      throw new Error(`unexpected request: ${init?.method} ${u}`);
    };

    const client = clientWithFetch(fetchImpl);

    // 永不 resolve 的 handler (完全忽略 ctx.signal)。
    const handlers = {
      slow_tool: () => new Promise<string>(() => {}),
    };

    const events: string[] = [];
    // 整个流程必须能跑完 (不挂死) — vitest 默认超时会兜底, 但 50ms 硬超时应远快于此。
    for await (const ev of client.agentRuns.runWithLocalTools(
      { appId: 'crabdesign', input: 'go' },
      handlers,
      { timeoutMs: 50 },
    )) {
      events.push(ev.type);
    }

    // 必须提交了一次 local tool result, 且是超时失败。
    expect(submittedBodies).toHaveLength(1);
    const body = submittedBodies[0] as { request_id: string; ok: boolean; error: string };
    expect(body.request_id).toBe('req_1');
    expect(body.ok).toBe(false);
    expect(body.error).toMatch(/timed out/);

    // 事件流正常推进到 local_tool_request。
    expect(events).toContain('run_started');
    expect(events).toContain('local_tool_request');
  });
});
