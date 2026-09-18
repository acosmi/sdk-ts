// openai-response-choices-absent.test.ts — [W-SDK-OPENAI-PARITY] 非流式响应缺 choices 时的容忍契约。
//
// 三份 SDK (TS / Go / Rust) 共有缺陷族的第四条。这一族的病根是同一个: wire 类型把「线上确实会
// 缺席的键」声明成必填, 消费处于是裸读, 一个 TypeError 把整条响应/整条流打死。已知落点四处 ——
// `OpenAIStreamChunk.choices` (2.19.3 已修)、`OpenAIStreamChoice.delta`、`OpenAIChatResponse.usage`、
// 以及本文件钉的 `OpenAIChatResponse.choices`。Go 因为切片/结构体零值全部天然免疫。
// 真源 docs/audit/2026-09-17-SDK-OpenAI流式转换器与TS参照不一致-根因审计与实施方案.md §5.5 的 PR-6。
//
// 缺陷形态: `{"id":…,"model":…,"usage":{…}}` 没有 choices 键。修前 convertOpenAIToChatResponse 与
// parseOpenAIResponseToAnthropic 各自直接读 `oai.choices.length`, 抛
// `TypeError: Cannot read properties of undefined (reading 'length')`。
//
// 契约: choices 缺席 ⇒ 按空数组处理 (零内容块、不报错), id / model / usage 照常转换。与 Go 侧
// 同名函数逐字同语义 (那里 Choices 是切片, 缺席即 nil, `len(nil) == 0`)。
// 两条路径都要钉 —— 只钉一处等于「非流式路径修好了一半」。

import { describe, expect, it } from 'vitest';

// 经 adapters/index 入口导入, 与 openai-stream-converter.test.ts 同理 (绕开
// openai.ts ↔ adapters/index.ts 的循环依赖初始化竞态)。
import { OpenAIAdapter } from '../src/models/adapters/index';
import { parseOpenAIResponseToAnthropic } from '../src/models/adapters/openai';

/**
 * 一个不带 choices 键的响应。刻意带上 usage: 「其余字段照常转换」正是这条容忍的理由 ——
 * 裸读 choices 会把已经到手的 id / model / usage 一起丢掉。
 */
const BODY_WITHOUT_CHOICES = JSON.stringify({
  id: 'resp_1',
  object: 'chat.completion',
  model: 'some-model',
  usage: { prompt_tokens: 11, completion_tokens: 7, total_tokens: 18 },
});

/** 同一响应补上 choices —— 用作「内容块照常产出」的正向对照。 */
const BODY_WITH_CHOICES = JSON.stringify({
  id: 'resp_1',
  object: 'chat.completion',
  model: 'some-model',
  choices: [
    {
      index: 0,
      message: {
        role: 'assistant',
        content: 'hello',
        reasoning_content: 'thought',
        tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'fn', arguments: '{}' } }],
      },
      finish_reason: 'tool_calls',
    },
  ],
  usage: { prompt_tokens: 11, completion_tokens: 7, total_tokens: 18 },
});

describe('OpenAI 非流式响应 — 共有缺陷: choices 缺席', () => {
  it('parseResponse: 缺 choices 时零内容块、不报错, id / model / usage 照常转换', () => {
    // 载重断言。撤掉 Array.isArray 守卫 ⇒ TypeError 直接把本用例打红。
    const resp = new OpenAIAdapter().parseResponse(BODY_WITHOUT_CHOICES);

    expect(resp.content).toEqual([]);
    // stop_reason 保持初值空串: 没有 choice 就没有 finish_reason 可映射, 不能伪造一个 end_turn。
    expect(resp.stop_reason).toBe('');
    // 「其余照常转换」—— 这几个字段是裸读 choices 时会被一起丢掉的东西。
    expect(resp.id).toBe('resp_1');
    expect(resp.model).toBe('some-model');
    expect(resp.usage).toEqual({ input_tokens: 11, output_tokens: 7 });
  });

  it('parseOpenAIResponseToAnthropic: 缺 choices 时零内容块、不报错, 其余照常转换', () => {
    // 载重断言 (第二条路径)。两处是各自独立的一行, 只改一处时这条仍会红。
    const resp = parseOpenAIResponseToAnthropic(BODY_WITHOUT_CHOICES);

    expect(resp.content).toEqual([]);
    expect(resp.stop_reason).toBe('');
    expect(resp.id).toBe('resp_1');
    expect(resp.model).toBe('some-model');
    expect(resp.usage).toEqual({ input_tokens: 11, output_tokens: 7 });
  });

  it('正向对照: choices 在场时两条路径都照常产出内容块 (证明钉的不是「恒空」)', () => {
    // 独立用例: 载重断言被篡改打红时, 这条必须仍绿 —— 否则无从分辨「容忍没生效」与
    // 「转换整个坏掉」。它走的是守卫的真支, 结构上不经过缺席分支。
    const viaAdapter = new OpenAIAdapter().parseResponse(BODY_WITH_CHOICES);
    expect(viaAdapter.content.map((b) => b.type)).toEqual(['thinking', 'text', 'tool_use']);
    expect(viaAdapter.stop_reason).toBe('tool_use');

    const viaAnthropic = parseOpenAIResponseToAnthropic(BODY_WITH_CHOICES);
    expect(viaAnthropic.content.map((b) => b.type)).toEqual(['thinking', 'text', 'tool_use']);
    expect(viaAnthropic.stop_reason).toBe('tool_use');
  });
});
