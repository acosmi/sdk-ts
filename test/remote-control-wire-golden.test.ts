import { describe, expect, it } from 'vitest';

import { parseRemoteControlEvent } from '../src/index';

// =============================================================================
// 跨语言 wire 金标 (契约 §13 事件扁平帧)。
//
// SYNC: 本 fixtures 与后端权威源
//   nexus-v4/backend/internal/service/crabcode/remotecontrol/testdata/wire_golden.json
// 必须逐字段同源。后端 TestEventWireGoldenFrames 用 RemoteSessionEvent.ToWire()
// 产出同样的帧; 本测试验证 SDK parseRemoteControlEvent 能正确消费。任一端字段名/
// 单位/形状漂移, 两端金标之一即红 (P1-1 同类 bug 的编译/测试期护栏)。
//
// 帧含 `seq` 顶层字段 (replay 用); SDK 解析器按设计忽略 seq, 不进入强类型事件。
// =============================================================================

const GOLDEN_WIRE_FRAMES: Record<string, Record<string, unknown>> = {
  text_delta: { type: 'text_delta', seq: 1, index: 0, text: 'hello' },
  reasoning_delta: { type: 'reasoning_delta', seq: 2, index: 0, text: 'thinking' },
  tool_call: { type: 'tool_call', seq: 3, tool_call_id: 'tc_1', name: 'read_file', input: { path: '/a' }, source: 'crabcode' },
  tool_result: { type: 'tool_result', seq: 4, tool_call_id: 'tc_1', ok: true, output: 'ok' },
  permission_request: { type: 'permission_request', seq: 5, request_id: 'req_1', kind: 'shell_exec', payload: { command: 'ls' }, deadline_ms: 30000 },
  permission_result: { type: 'permission_result', seq: 6, request_id: 'req_1', decision: 'deny', actor: 'alice', decided_at: '2026-05-28T10:00:00Z' },
  usage: { type: 'usage', seq: 7, input_tokens: 100, output_tokens: 50, cache_read: 10, cache_create: 5, exact: true },
  settle: { type: 'settle', seq: 8, status: 'settled', billed: true },
  status: { type: 'status', seq: 9, phase: 'running', message: 'turn started' },
  error: { type: 'error', seq: 10, code: 'upstream_unavailable', message: 'boom', retryable: true, kind: 'transport' },
  done: { type: 'done', seq: 11, reason: 'complete', run_id: 'run_1', final_status: 'completed' },
};

const EXPECTED_PARSED: Record<string, unknown> = {
  text_delta: { type: 'text_delta', index: 0, text: 'hello' },
  reasoning_delta: { type: 'reasoning_delta', index: 0, text: 'thinking' },
  tool_call: { type: 'tool_call', toolCallId: 'tc_1', name: 'read_file', input: { path: '/a' }, source: 'crabcode' },
  tool_result: { type: 'tool_result', toolCallId: 'tc_1', ok: true, output: 'ok' },
  permission_request: { type: 'permission_request', requestId: 'req_1', kind: 'shell_exec', payload: { command: 'ls' }, deadlineMs: 30000 },
  permission_result: { type: 'permission_result', requestId: 'req_1', decision: 'deny', actor: 'alice', decidedAt: '2026-05-28T10:00:00Z' },
  usage: { type: 'usage', inputTokens: 100, outputTokens: 50, cacheRead: 10, cacheCreate: 5, exact: true },
  settle: { type: 'settle', status: 'settled', billed: true },
  status: { type: 'status', phase: 'running', message: 'turn started' },
  error: { type: 'error', code: 'upstream_unavailable', message: 'boom', retryable: true, kind: 'transport' },
  done: { type: 'done', reason: 'complete', runId: 'run_1', finalStatus: 'completed' },
};

describe('remote-control wire golden — cross-language 契约 §13', () => {
  it('covers all 11 contract §4 events', () => {
    expect(Object.keys(GOLDEN_WIRE_FRAMES).sort()).toEqual(Object.keys(EXPECTED_PARSED).sort());
    expect(Object.keys(GOLDEN_WIRE_FRAMES)).toHaveLength(11);
  });

  for (const [name, frame] of Object.entries(GOLDEN_WIRE_FRAMES)) {
    it(`${name}: snake_case wire frame parses to expected typed event`, () => {
      const parsed = parseRemoteControlEvent(frame);
      expect(parsed).toEqual(EXPECTED_PARSED[name]);
    });
  }
});
