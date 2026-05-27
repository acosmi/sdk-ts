// remote-control-client.test.ts — Phase 5A coverage for
//   - agentRuns.createRemoteRun(req)
//   - agentRuns.streamRemoteControl(runId)
//
// Backend (Phase 3 skeleton) does not yet read the new wire fields, but the SDK
// forwards them so the contract is stable from day one; this test asserts the
// SDK -> wire snake_case translation and the SSE parse pipeline.

import { describe, expect, it } from 'vitest';

import { Client, type RemoteControlEvent } from '../src/index';

const future = new Date(Date.now() + 60_000).toISOString();

function clientWithFetch(fetchImpl: typeof fetch): Client {
  const client = new Client({ baseURL: 'https://nexus.test', fetchImpl });
  client.tokens = {
    access_token: 'token-1',
    refresh_token: 'refresh-1',
    expires_at: future,
    scope: 'remote_control ai',
    client_id: 'client-1',
    server_url: 'https://nexus.test',
  };
  return client;
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
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
    {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    },
  );
}

describe('createRemoteRun', () => {
  it('rejects when runtime is not crabcode_remote', async () => {
    const client = clientWithFetch(async () => jsonResponse({}));
    await expect(
      // @ts-expect-error — runtime narrowing prevents this in TS but we test runtime guard
      client.agentRuns.createRemoteRun({
        appId: 'a',
        input: 'x',
        runtime: 'standard',
        runner: 'cloud',
        adapter: 'remote_io',
      }),
    ).rejects.toThrow(/runtime must be "crabcode_remote"/);
  });

  it('rejects when runner is missing', async () => {
    const client = clientWithFetch(async () => jsonResponse({}));
    await expect(
      client.agentRuns.createRemoteRun({
        appId: 'a',
        input: 'x',
        runtime: 'crabcode_remote',
        // runner is missing — runtime guard rejects
        // @ts-expect-error
        runner: undefined,
        adapter: 'remote_io',
      }),
    ).rejects.toThrow(/runner is required/);
  });

  it('serializes remote-run request as snake_case wire payload with policy nesting', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const client = clientWithFetch(async (url, init) => {
      calls.push({ url: String(url), init: init ?? {} });
      return jsonResponse({
        code: 0,
        message: 'success',
        data: { run_id: 'run_1', session_id: 'sess_1', status: 'queued' },
      });
    });

    const resp = await client.agentRuns.createRemoteRun({
      appId: 'app-1',
      sessionId: 'sess-0',
      input: 'open a terminal',
      runtime: 'crabcode_remote',
      runner: 'desktop',
      adapter: 'app_server_tcp_ws',
      permissionPolicy: {
        shellAllowed: true,
        shellDenyList: ['rm', 'shutdown'],
        networkAllowed: false,
        writeAllowed: true,
        approvalTimeoutMs: 300_000,
        requiredActors: ['admin@example.com'],
      },
      workspacePolicy: {
        readOnly: false,
        allowedPaths: ['/workspace'],
        deniedPaths: ['/etc'],
        maxBytes: 10_485_760,
      },
    });

    expect(resp.runId).toBe('run_1');
    expect(calls).toHaveLength(1);
    const body = JSON.parse(String(calls[0].init.body));
    expect(body).toMatchObject({
      app_id: 'app-1',
      session_id: 'sess-0',
      input: 'open a terminal',
      runtime: 'crabcode_remote',
      runner: 'desktop',
      adapter: 'app_server_tcp_ws',
      permission_policy: {
        shell_allowed: true,
        shell_deny_list: ['rm', 'shutdown'],
        network_allowed: false,
        write_allowed: true,
        approval_timeout_ms: 300_000,
        required_actors: ['admin@example.com'],
      },
      workspace_policy: {
        read_only: false,
        allowed_paths: ['/workspace'],
        denied_paths: ['/etc'],
        max_bytes: 10_485_760,
      },
    });
    // never leaks plaintext token in body
    expect(JSON.stringify(body)).not.toContain('token-1');
  });
});

describe('streamRemoteControl', () => {
  it('parses 11-event union and ends iteration on done', async () => {
    const sse =
      `event: status\ndata: {"type":"status","phase":"connecting"}\n\n` +
      `event: text_delta\ndata: {"type":"text_delta","index":0,"text":"hello"}\n\n` +
      `event: reasoning_delta\ndata: {"type":"reasoning_delta","index":0,"text":"think"}\n\n` +
      `event: tool_call\ndata: {"type":"tool_call","tool_call_id":"t1","name":"shell"}\n\n` +
      `event: tool_result\ndata: {"type":"tool_result","tool_call_id":"t1","ok":true}\n\n` +
      `event: permission_request\ndata: {"type":"permission_request","request_id":"p1","kind":"shell_exec"}\n\n` +
      `event: permission_result\ndata: {"type":"permission_result","request_id":"p1","decision":"allow"}\n\n` +
      `event: usage\ndata: {"type":"usage","input_tokens":10,"output_tokens":20,"exact":true}\n\n` +
      `event: settle\ndata: {"type":"settle","status":"completed"}\n\n` +
      `event: done\ndata: {"type":"done","reason":"completed","run_id":"run_1","final_status":"completed"}\n\n` +
      // post-done event must NOT be yielded:
      `event: error\ndata: {"type":"error","code":"E_X","message":"x"}\n\n`;

    const client = clientWithFetch(async () => sseResponse(sse));

    const events: RemoteControlEvent[] = [];
    for await (const ev of client.agentRuns.streamRemoteControl('run_1')) {
      events.push(ev);
    }

    expect(events.map((e) => e.type)).toEqual([
      'status',
      'text_delta',
      'reasoning_delta',
      'tool_call',
      'tool_result',
      'permission_request',
      'permission_result',
      'usage',
      'settle', // settle is terminal — iteration ends here
    ]);
    // settle is terminal per contract §4 — don't keep going to done/error
    const last = events[events.length - 1];
    expect(last.type).toBe('settle');
  });

  it('iteration ends on done even when no settle observed', async () => {
    const sse =
      `event: text_delta\ndata: {"type":"text_delta","index":0,"text":"hi"}\n\n` +
      `event: error\ndata: {"type":"error","code":"E_TRANSIENT","message":"retry"}\n\n` +
      `event: done\ndata: {"type":"done","reason":"failed","run_id":"run_2","final_status":"failed"}\n\n` +
      `event: text_delta\ndata: {"type":"text_delta","index":1,"text":"never seen"}\n\n`;

    const client = clientWithFetch(async () => sseResponse(sse));

    const events: RemoteControlEvent[] = [];
    for await (const ev of client.agentRuns.streamRemoteControl('run_2')) {
      events.push(ev);
    }

    expect(events.map((e) => e.type)).toEqual(['text_delta', 'error', 'done']);
  });

  it('silently skips unknown event types and malformed frames', async () => {
    const sse =
      `event: legacy_event\ndata: {"type":"legacy_event","old":"yes"}\n\n` +
      `event: text_delta\ndata: {"type":"text_delta","index":0,"text":"ok"}\n\n` +
      `event: malformed\ndata: not-json\n\n` +
      `event: done\ndata: {"type":"done","reason":"ok","run_id":"run_3","final_status":"completed"}\n\n`;

    const client = clientWithFetch(async () => sseResponse(sse));

    const events: RemoteControlEvent[] = [];
    for await (const ev of client.agentRuns.streamRemoteControl('run_3')) {
      events.push(ev);
    }

    expect(events.map((e) => e.type)).toEqual(['text_delta', 'done']);
  });

  it('GET request hits the same /api/v4/agent-runs/:runId/stream path', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const client = clientWithFetch(async (url, init) => {
      calls.push({ url: String(url), init: init ?? {} });
      return sseResponse(
        `event: done\ndata: {"type":"done","reason":"ok","run_id":"run_4","final_status":"completed"}\n\n`,
      );
    });

    for await (const _ev of client.agentRuns.streamRemoteControl('run_4')) {
      // drain
    }
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://nexus.test/api/v4/agent-runs/run_4/stream');
    expect(calls[0].init.method).toBe('GET');
    expect((calls[0].init.headers as Record<string, string>)['Accept']).toBe(
      'text/event-stream',
    );
  });
});
