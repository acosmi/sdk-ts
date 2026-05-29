import { describe, expect, it } from 'vitest';

import {
  isTerminalRemoteEvent,
  parseRemoteControlEvent,
  type RemoteControlEvent,
} from '../src/index';

describe('parseRemoteControlEvent — 11 event types', () => {
  it('text_delta', () => {
    const ev = parseRemoteControlEvent({ type: 'text_delta', index: 0, text: 'hello' });
    expect(ev).toEqual({ type: 'text_delta', index: 0, text: 'hello' });
  });

  it('reasoning_delta', () => {
    const ev = parseRemoteControlEvent({ type: 'reasoning_delta', index: 1, text: 'thinking' });
    expect(ev).toEqual({ type: 'reasoning_delta', index: 1, text: 'thinking' });
  });

  it('tool_call (snake_case wire -> camelCase TS)', () => {
    const ev = parseRemoteControlEvent({
      type: 'tool_call',
      tool_call_id: 't1',
      name: 'web_search',
      input: { q: 'a' },
      source: 'crabcode',
    });
    expect(ev).toEqual({
      type: 'tool_call',
      toolCallId: 't1',
      name: 'web_search',
      input: { q: 'a' },
      source: 'crabcode',
    });
  });

  it('tool_call (camelCase wire fallback)', () => {
    const ev = parseRemoteControlEvent({
      type: 'tool_call',
      toolCallId: 't2',
      name: 'fs_read',
    });
    expect(ev).toMatchObject({ type: 'tool_call', toolCallId: 't2', name: 'fs_read' });
  });

  it('tool_result', () => {
    const ev = parseRemoteControlEvent({
      type: 'tool_result',
      tool_call_id: 't1',
      ok: true,
      output: { ok: 1 },
    });
    expect(ev).toEqual({
      type: 'tool_result',
      toolCallId: 't1',
      ok: true,
      output: { ok: 1 },
      error: undefined,
    });
  });

  it('permission_request', () => {
    const ev = parseRemoteControlEvent({
      type: 'permission_request',
      request_id: 'p1',
      kind: 'shell.exec',
      payload: { cmd: 'ls' },
      deadline_ms: 30000,
    });
    expect(ev).toEqual({
      type: 'permission_request',
      requestId: 'p1',
      kind: 'shell.exec',
      payload: { cmd: 'ls' },
      deadlineMs: 30000,
    });
  });

  it('permission_result', () => {
    const ev = parseRemoteControlEvent({
      type: 'permission_result',
      request_id: 'p1',
      decision: 'allow',
      actor: 'user@acosmi',
      decided_at: '2026-05-27T00:00:00Z',
    });
    expect(ev).toEqual({
      type: 'permission_result',
      requestId: 'p1',
      decision: 'allow',
      actor: 'user@acosmi',
      decidedAt: '2026-05-27T00:00:00Z',
    });
  });

  it('usage', () => {
    const ev = parseRemoteControlEvent({
      type: 'usage',
      input_tokens: 100,
      output_tokens: 50,
      cache_read: 10,
      cache_create: 5,
      exact: true,
    });
    expect(ev).toEqual({
      type: 'usage',
      inputTokens: 100,
      outputTokens: 50,
      cacheRead: 10,
      cacheCreate: 5,
      exact: true,
    });
  });

  it('settle', () => {
    const ev = parseRemoteControlEvent({ type: 'settle', status: 'completed', billed: true });
    expect(ev).toEqual({ type: 'settle', status: 'completed', billed: true });
  });

  it('status', () => {
    const ev = parseRemoteControlEvent({ type: 'status', phase: 'running', message: 'turn 1' });
    expect(ev).toEqual({ type: 'status', phase: 'running', message: 'turn 1' });
  });

  it('error', () => {
    const ev = parseRemoteControlEvent({
      type: 'error',
      code: 'tool_timeout',
      message: 'shell took too long',
      retryable: true,
      kind: 'tool',
    });
    expect(ev).toEqual({
      type: 'error',
      code: 'tool_timeout',
      message: 'shell took too long',
      retryable: true,
      kind: 'tool',
    });
  });

  it('done', () => {
    const ev = parseRemoteControlEvent({
      type: 'done',
      reason: 'complete',
      run_id: 'r1',
      final_status: 'completed',
    });
    expect(ev).toEqual({
      type: 'done',
      reason: 'complete',
      runId: 'r1',
      finalStatus: 'completed',
    });
  });
});

describe('parseRemoteControlEvent — negative cases', () => {
  it('returns null for missing required fields (text_delta missing text)', () => {
    expect(parseRemoteControlEvent({ type: 'text_delta', index: 0 })).toBeNull();
  });

  it('returns null for missing required fields (text_delta missing index)', () => {
    expect(parseRemoteControlEvent({ type: 'text_delta', text: 'x' })).toBeNull();
  });

  it('returns null for tool_call without toolCallId', () => {
    expect(parseRemoteControlEvent({ type: 'tool_call', name: 'x' })).toBeNull();
  });

  it('returns null for permission_request missing kind', () => {
    expect(parseRemoteControlEvent({ type: 'permission_request', request_id: 'p1' })).toBeNull();
  });

  it('returns null for unknown event type', () => {
    expect(parseRemoteControlEvent({ type: 'plan_delta', text: 'x' })).toBeNull();
    expect(parseRemoteControlEvent({ type: 'intent_confirmation' })).toBeNull();
    expect(parseRemoteControlEvent({ type: 'sources', sources: [] })).toBeNull();
  });

  it('returns null for non-object input', () => {
    expect(parseRemoteControlEvent(null)).toBeNull();
    expect(parseRemoteControlEvent(undefined)).toBeNull();
    expect(parseRemoteControlEvent('text')).toBeNull();
    expect(parseRemoteControlEvent(42)).toBeNull();
    expect(parseRemoteControlEvent([])).toBeNull();
  });

  it('returns null for done missing finalStatus', () => {
    expect(parseRemoteControlEvent({ type: 'done', reason: 'x', run_id: 'r1' })).toBeNull();
  });

  it('returns null for error missing code/message', () => {
    expect(parseRemoteControlEvent({ type: 'error', code: 'x' })).toBeNull();
    expect(parseRemoteControlEvent({ type: 'error', message: 'm' })).toBeNull();
  });
});

describe('isTerminalRemoteEvent', () => {
  it('done is terminal', () => {
    const ev: RemoteControlEvent = {
      type: 'done',
      reason: 'complete',
      runId: 'r1',
      finalStatus: 'completed',
    };
    expect(isTerminalRemoteEvent(ev)).toBe(true);
  });

  it('settle is terminal', () => {
    expect(isTerminalRemoteEvent({ type: 'settle', status: 'completed' })).toBe(true);
  });

  it('error is NOT terminal (contract §4: non-terminal errors do not end stream)', () => {
    expect(
      isTerminalRemoteEvent({
        type: 'error',
        code: 'tool_timeout',
        message: 'm',
      }),
    ).toBe(false);
  });

  it('tool_call is not terminal', () => {
    expect(
      isTerminalRemoteEvent({ type: 'tool_call', toolCallId: 't1', name: 'x' }),
    ).toBe(false);
  });

  it('text_delta is not terminal', () => {
    expect(isTerminalRemoteEvent({ type: 'text_delta', index: 0, text: 'x' })).toBe(false);
  });

  it('status / usage / permission_request / permission_result not terminal', () => {
    expect(isTerminalRemoteEvent({ type: 'status', phase: 'running' })).toBe(false);
    expect(isTerminalRemoteEvent({ type: 'usage' })).toBe(false);
    expect(
      isTerminalRemoteEvent({
        type: 'permission_request',
        requestId: 'p1',
        kind: 'shell.exec',
      }),
    ).toBe(false);
    expect(
      isTerminalRemoteEvent({ type: 'permission_result', requestId: 'p1', decision: 'allow' }),
    ).toBe(false);
  });
});
