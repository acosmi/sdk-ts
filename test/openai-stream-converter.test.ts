// openai-stream-converter.test.ts — OpenAIStreamConverter block index 配对契约测试。
//
// 根因回归: 当 chunk 顺序为 reasoning_content → tool_calls (中间无 content text delta)
// 时, 旧实现只在 textStarted 为真时关闭并递增 block, 不会关闭仍打开的 thinking block,
// 导致 thinking 与 tool 撞用 index 0; finish 收尾又按已被 tool 推进的 blockIndex 关
// thinking → 索引错配。
//
// 本测试断言: 每个 content_block_start 都有配对的 content_block_stop 且 index 一致;
// 无两个不同类型 block 共用同一 index; thinking / text / tool 的 index 不冲突。

import { describe, expect, it } from 'vitest';

// 经 adapters/index 入口导入 (而非直接 ../openai), 以正确的模块求值顺序绕开
// openai.ts ↔ adapters/index.ts 的循环依赖初始化竞态。
import { newOpenAIStreamConverter } from '../src/models/adapters/index';
import type { StreamEvent } from '../src/models/types';

interface ParsedEvent {
  event: string;
  payload: Record<string, unknown>;
}

/** 把一串 OpenAI SSE data 行喂进转换器, 收集所有 events 并解析 data JSON。 */
function runChunks(chunks: string[]): ParsedEvent[] {
  const conv = newOpenAIStreamConverter();
  const all: StreamEvent[] = [];
  for (const c of chunks) {
    const { events } = conv.convert(c);
    all.push(...events);
  }
  return all.map((e) => ({
    event: e.event,
    payload: JSON.parse(e.data) as Record<string, unknown>,
  }));
}

/** 校验所有 content_block start/stop 严格配对, 同一 index 不被两个不同类型复用。 */
function assertBlocksWellFormed(events: ParsedEvent[]): {
  startIndexByType: Map<string, number[]>;
} {
  // index → 当前是否打开 + 类型
  const open = new Map<number, string>();
  // index → 曾用过的类型集合 (检测复用冲突)
  const typeOfIndex = new Map<number, string>();
  const startIndexByType = new Map<string, number[]>();

  for (const ev of events) {
    if (ev.event === 'content_block_start') {
      const index = ev.payload.index as number;
      const cb = ev.payload.content_block as { type: string };
      const type = cb.type;
      // 同一 index 不能被不同类型 block 复用
      if (typeOfIndex.has(index)) {
        expect(
          typeOfIndex.get(index),
          `index ${index} 被复用: 已是 ${typeOfIndex.get(index)}, 又来 ${type}`,
        ).toBe(type);
      }
      // 该 index 当前不能已处于打开态
      expect(open.has(index), `index ${index} 已打开却又 start`).toBe(false);
      open.set(index, type);
      typeOfIndex.set(index, type);
      const arr = startIndexByType.get(type) ?? [];
      arr.push(index);
      startIndexByType.set(type, arr);
    } else if (ev.event === 'content_block_stop') {
      const index = ev.payload.index as number;
      expect(open.has(index), `index ${index} stop 但未处于打开态 (索引错配)`).toBe(true);
      open.delete(index);
    } else if (ev.event === 'content_block_delta') {
      // delta 的 index 必须指向一个当前打开的 block
      const index = ev.payload.index as number;
      expect(open.has(index), `delta index ${index} 不指向打开的 block`).toBe(true);
    }
  }

  // 收尾: 所有 block 必须已关闭 (无悬挂 start)
  expect(open.size, `仍有未关闭的 block: ${[...open.keys()].join(',')}`).toBe(0);
  return { startIndexByType };
}

function thinkingChunk(text: string): string {
  return JSON.stringify({
    id: 'c1',
    choices: [{ delta: { reasoning_content: text } }],
  });
}

function textChunk(text: string): string {
  return JSON.stringify({
    id: 'c1',
    choices: [{ delta: { content: text } }],
  });
}

function toolCallChunk(index: number, id: string, name: string, args: string): string {
  return JSON.stringify({
    id: 'c1',
    choices: [
      {
        delta: {
          tool_calls: [{ index, id, function: { name, arguments: args } }],
        },
      },
    ],
  });
}

function finishChunk(reason: string): string {
  return JSON.stringify({
    id: 'c1',
    choices: [{ delta: {}, finish_reason: reason }],
  });
}

describe('OpenAIStreamConverter — thinking → tool_calls (无 content) 不撞 index', () => {
  it('reasoning_content → tool_calls → finish: thinking 与 tool block index 不冲突且配对', () => {
    const events = runChunks([
      thinkingChunk('let me think'),
      thinkingChunk(' more'),
      toolCallChunk(0, 'call_1', 'get_weather', '{"city":'),
      toolCallChunk(0, 'call_1', 'get_weather', '"sf"}'),
      finishChunk('tool_calls'),
    ]);

    const { startIndexByType } = assertBlocksWellFormed(events);

    // thinking 与 tool_use 各开一个, index 必须不同
    const thinkingIdx = startIndexByType.get('thinking') ?? [];
    const toolIdx = startIndexByType.get('tool_use') ?? [];
    expect(thinkingIdx).toEqual([0]);
    expect(toolIdx).toEqual([1]);
    expect(thinkingIdx[0]).not.toBe(toolIdx[0]);

    // thinking block 必须被关闭 (有 stop@0)
    const stops = events.filter((e) => e.event === 'content_block_stop').map((e) => e.payload.index);
    expect(stops).toContain(0); // thinking stop
    expect(stops).toContain(1); // tool stop

    // finish 之后必有 message_stop
    expect(events.at(-1)?.event).toBe('message_stop');
  });
});

describe('OpenAIStreamConverter — 回归: 其它顺序仍正确配对', () => {
  it('thinking → text → tool: 三个 block 顺序 index 0/1/2 不冲突且配对', () => {
    const events = runChunks([
      thinkingChunk('reasoning'),
      textChunk('hello'),
      toolCallChunk(0, 'call_1', 'fn', '{}'),
      finishChunk('tool_calls'),
    ]);

    const { startIndexByType } = assertBlocksWellFormed(events);
    expect(startIndexByType.get('thinking')).toEqual([0]);
    expect(startIndexByType.get('text')).toEqual([1]);
    expect(startIndexByType.get('tool_use')).toEqual([2]);
  });

  it('text-only: 单 text block 配对', () => {
    const events = runChunks([textChunk('hi'), textChunk(' there'), finishChunk('stop')]);
    const { startIndexByType } = assertBlocksWellFormed(events);
    expect(startIndexByType.get('text')).toEqual([0]);
    expect(startIndexByType.has('thinking')).toBe(false);
  });

  it('thinking-only: 单 thinking block 在 index 0 配对关闭', () => {
    const events = runChunks([thinkingChunk('think'), finishChunk('stop')]);
    const { startIndexByType } = assertBlocksWellFormed(events);
    expect(startIndexByType.get('thinking')).toEqual([0]);
  });

  it('多 tool_calls: 各 tool 占独立 index', () => {
    const events = runChunks([
      thinkingChunk('plan'),
      toolCallChunk(0, 'c0', 'a', '{}'),
      toolCallChunk(1, 'c1', 'b', '{}'),
      finishChunk('tool_calls'),
    ]);
    const { startIndexByType } = assertBlocksWellFormed(events);
    expect(startIndexByType.get('thinking')).toEqual([0]);
    expect(startIndexByType.get('tool_use')).toEqual([1, 2]);
  });
});
