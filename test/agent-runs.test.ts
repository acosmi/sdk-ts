import { describe, expect, it } from 'vitest';

import { AgentRunStreamError, Client, type AgentRunStreamEvent } from '../src/index';

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

describe('agentRuns', () => {
  it('serializes create request as snake_case wire payload', async () => {
    const calls: RequestInit[] = [];
    const client = clientWithFetch(async (_url, init) => {
      calls.push(init ?? {});
      return jsonResponse({
        code: 0,
        message: 'success',
        data: { run_id: 'run_1', session_id: 'sess_1', status: 'queued' },
      });
    });

    const created = await client.agentRuns.create({
      appId: 'crabdesign',
      mode: 'design',
      sessionId: 'sess_0',
      input: 'build a poster',
      messages: [{ role: 'user', content: 'hello' }],
      model: 'deepseek-v4',
      activeSkillIds: ['skill_1'],
      knowledgeBaseIds: ['kb_1'],
      metadata: { source: 'test' },
      localContextPolicy: {
        enabled: true,
        readonly: true,
        maxBytes: 1024,
        allowedTools: ['read_file'],
      },
      artifactPolicy: { enabled: true, maxFiles: 3 },
    });

    expect(created).toEqual({ runId: 'run_1', sessionId: 'sess_1', status: 'queued' });
    expect(JSON.parse(String(calls[0].body))).toEqual({
      app_id: 'crabdesign',
      mode: 'design',
      session_id: 'sess_0',
      input: 'build a poster',
      messages: [{ role: 'user', content: 'hello' }],
      model: 'deepseek-v4',
      active_skill_ids: ['skill_1'],
      knowledge_base_ids: ['kb_1'],
      metadata: { source: 'test' },
      local_context_policy: {
        enabled: true,
        readonly: true,
        max_bytes: 1024,
        allowed_tools: ['read_file'],
      },
      artifact_policy: { enabled: true, max_files: 3 },
    });
  });

  it('parses all AgentRunStreamEvent variants', async () => {
    const frames = [
      { type: 'run_started', run_id: 'run_1', session_id: 'sess_1' },
      { type: 'status', status: 'running', message: 'working' },
      { type: 'text_delta', text: 'hello' },
      { type: 'reasoning_delta', text: 'thinking' },
      { type: 'tool_call', id: 'call_1', name: 'search', input: { q: 'x' } },
      { type: 'tool_result', id: 'call_1', name: 'search', result: { ok: true } },
      { type: 'local_tool_request', request_id: 'local_1', name: 'read_file', input: { path: 'a.txt' } },
      { type: 'artifact', artifact: { id: 'art_1', filename: 'chart.png', content_type: 'image/png', size: 7 } },
      { type: 'sources', sources: [{ title: 'doc' }] },
      { type: 'usage', usage: { input_tokens: 1, output_tokens: 2, total_tokens: 3, cache_read_tokens: 4, cache_create_tokens: 5, exact: true, source: 'provider_usage' } },
      { type: 'settle', settlement: { request_id: 'consume_1', consume_status: 'SETTLED', total_tokens: 3, cache_read_tokens: 4, cache_create_tokens: 5, exact: true, retry_queued: false } },
      { type: 'error', error: { code: 'tool_failed', message: 'bad tool', retryable: false } },
      { type: 'done', run_id: 'run_1', status: 'completed' },
    ]
      .map((frame) => `event: ${frame.type}\ndata: ${JSON.stringify(frame)}\n\n`)
      .join('');

    const client = clientWithFetch(async () => sseResponse(frames));
    const events: AgentRunStreamEvent[] = [];
    for await (const event of client.agentRuns.stream('run_1', { throwOnError: false })) {
      events.push(event);
    }

    expect(events.map((event) => event.type)).toEqual([
      'run_started',
      'status',
      'text_delta',
      'reasoning_delta',
      'tool_call',
      'tool_result',
      'local_tool_request',
      'artifact',
      'sources',
      'usage',
      'settle',
      'error',
      'done',
    ]);
    expect(events[0]).toMatchObject({ runId: 'run_1', sessionId: 'sess_1' });
    expect(events[6]).toMatchObject({ requestId: 'local_1', name: 'read_file' });
    expect(events[7]).toMatchObject({ artifact: { id: 'art_1', filename: 'chart.png' } });
    expect(events[9]).toMatchObject({
      usage: {
        inputTokens: 1,
        outputTokens: 2,
        totalTokens: 3,
        cacheReadTokens: 4,
        cacheCreateTokens: 5,
        exact: true,
        source: 'provider_usage',
      },
    });
    expect(events[10]).toMatchObject({
      settlement: { requestId: 'consume_1', consumeStatus: 'SETTLED', totalTokens: 3, cacheReadTokens: 4, cacheCreateTokens: 5, exact: true, retryQueued: false },
    });
  });

  it('retries 401 after refresh only for safe query requests', async () => {
    const getCalls: string[] = [];
    const getClient = clientWithFetch(async (url) => {
      getCalls.push(String(url));
      if (getCalls.length === 1) return jsonResponse({ error: { message: 'expired' } }, 401);
      return jsonResponse({
        code: 0,
        message: 'success',
        data: { run_id: 'run_1', session_id: 'sess_1', status: 'running' },
      });
    });
    let refreshes = 0;
    getClient.forceRefresh = async () => {
      refreshes += 1;
      getClient.tokens = { ...getClient.tokens!, access_token: 'token-2' };
    };

    await expect(getClient.agentRuns.get('run_1')).resolves.toMatchObject({ runId: 'run_1' });
    expect(refreshes).toBe(1);
    expect(getCalls).toHaveLength(2);

    const createCalls: string[] = [];
    const createClient = clientWithFetch(async (url) => {
      createCalls.push(String(url));
      return jsonResponse({ error: { message: 'expired' } }, 401);
    });
    createClient.forceRefresh = async () => {
      throw new Error('create must not refresh-and-replay');
    };

    await expect(createClient.agentRuns.create({ appId: 'app', input: 'hi' })).rejects.toMatchObject({
      statusCode: 401,
    });
    expect(createCalls).toHaveLength(1);
  });

  it('throws AgentRunStreamError for error events by default', async () => {
    const client = clientWithFetch(async () =>
      sseResponse(
        `event: error\ndata: ${JSON.stringify({
          type: 'error',
          error: { code: 'quota_exhausted', stage: 'entitlement', message: 'no quota', retryable: false },
        })}\n\n`,
      ),
    );

    await expect(async () => {
      for await (const _event of client.agentRuns.stream('run_1')) {
        // consume
      }
    }).rejects.toBeInstanceOf(AgentRunStreamError);
  });

  it('submits local tool result with snake_case payload', async () => {
    let body: unknown;
    const client = clientWithFetch(async (_url, init) => {
      body = JSON.parse(String(init?.body));
      return jsonResponse({
        code: 0,
        message: 'success',
        data: { run_id: 'run_1', session_id: 'sess_1', status: 'running' },
      });
    });

    await client.agentRuns.submitLocalToolResult('run_1', {
      requestId: 'local_1',
      ok: true,
      content: { text: 'readonly result' },
    });

    expect(body).toEqual({
      request_id: 'local_1',
      ok: true,
      content: { text: 'readonly result' },
    });
  });

  it('runWithLocalTools starts the handler before yielding local_tool_request', async () => {
    let handlerCalled = false;
    let submitted: unknown;
    const client = clientWithFetch(async (url, init) => {
      const path = String(url);
      if (path.endsWith('/agent-runs') && init?.method === 'POST') {
        return jsonResponse({
          code: 0,
          message: 'success',
          data: { run_id: 'run_1', session_id: 'sess_1', status: 'queued' },
        });
      }
      if (path.endsWith('/agent-runs/run_1/stream')) {
        return sseResponse(
          [
            { type: 'run_started', run_id: 'run_1', session_id: 'sess_1' },
            { type: 'local_tool_request', request_id: 'local_1', name: 'read_file', input: { path: 'a.txt' } },
            { type: 'done', run_id: 'run_1', status: 'completed' },
          ]
            .map((frame) => `event: ${frame.type}\ndata: ${JSON.stringify(frame)}\n\n`)
            .join(''),
        );
      }
      if (path.endsWith('/agent-runs/run_1/local-tool-results')) {
        submitted = JSON.parse(String(init?.body));
        return jsonResponse({
          code: 0,
          message: 'success',
          data: { run_id: 'run_1', session_id: 'sess_1', status: 'running' },
        });
      }
      throw new Error(`unexpected request: ${path}`);
    });

    for await (const event of client.agentRuns.runWithLocalTools(
      { appId: 'app', input: 'hi' },
      {
        read_file: () => {
          handlerCalled = true;
          return { text: 'hello' };
        },
      },
    )) {
      if (event.type === 'local_tool_request') {
        expect(handlerCalled).toBe(true);
      }
    }

    expect(submitted).toMatchObject({
      request_id: 'local_1',
      ok: true,
      content: { text: 'hello' },
    });
  });

  it('parses downloadArtifact filename and content-type', async () => {
    const data = new Uint8Array([1, 2, 3]);
    const client = clientWithFetch(async () =>
      new Response(data, {
        status: 200,
        headers: {
          'Content-Type': 'text/csv',
          'Content-Disposition': `attachment; filename*=UTF-8''report.csv`,
        },
      }),
    );

    const artifact = await client.agentRuns.downloadArtifact('run_1', 'art_1');
    expect(artifact.filename).toBe('report.csv');
    expect(artifact.contentType).toBe('text/csv');
    expect([...artifact.data]).toEqual([1, 2, 3]);
  });
});
