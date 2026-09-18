// openai-response-usage-absent.test.ts — [W-SDK-OPENAI-PARITY] 非流式响应缺 usage 时的容忍契约。
//
// 三份 SDK (TS / Go / Rust) 共有缺陷的第二条: 不是 parity 差异, 而是同一批形态上三份给出同一个
// 错误答案 —— 必须一起修, 单改一份就是制造新的分歧。真源
// docs/audit/2026-09-17-SDK-OpenAI流式转换器与TS参照不一致-根因审计与实施方案.md §5.5 的 PR-6。
//
// 缺陷形态: `{"id":…,"choices":[…]}` 没有 usage 键。修前 convertOpenAIToChatResponse 与
// parseOpenAIResponseToAnthropic 各自直接读 `oai.usage.prompt_tokens` (无可选链), 抛
// `TypeError: Cannot read properties of undefined (reading 'prompt_tokens')` —— 一个本来完全
// 可用的响应 (正文、finish_reason、tool_calls 全在) 整条被打死, 只因为上游不计量。
//
// 契约: usage 缺席 ⇒ 两个计数按 0, 其余照常转换。与 Go 侧同名函数逐字同语义 (那里 Usage 是值
// 类型, 缺席即零值)。两条路径都要钉 —— 只钉一处等于「非流式路径修好了一半」。

import { describe, expect, it } from 'vitest';

// 经 adapters/index 入口导入, 与 openai-stream-converter.test.ts 同理 (绕开
// openai.ts ↔ adapters/index.ts 的循环依赖初始化竞态)。
import { OpenAIAdapter } from '../src/models/adapters/index';
import { parseOpenAIResponseToAnthropic } from '../src/models/adapters/openai';

/** 一个内容完整、但不带 usage 键的 OpenAI 同步响应。 */
const BODY_WITHOUT_USAGE = JSON.stringify({
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
});

/** 同一响应, 只是补上了 usage —— 用作「映射本身没坏」的正向对照。 */
const BODY_WITH_USAGE = JSON.stringify({
  id: 'resp_1',
  object: 'chat.completion',
  model: 'some-model',
  choices: [
    {
      index: 0,
      message: { role: 'assistant', content: 'hello' },
      finish_reason: 'stop',
    },
  ],
  usage: { prompt_tokens: 11, completion_tokens: 7, total_tokens: 18 },
});

describe('OpenAI 非流式响应 — 共有缺陷: usage 缺席', () => {
  it('parseResponse: 缺 usage 时计数按 0, 正文 / stop_reason / tool_use 照常转换', () => {
    // 载重断言。改回 `oai.usage.prompt_tokens` ⇒ TypeError 直接把本用例打红。
    const resp = new OpenAIAdapter().parseResponse(BODY_WITHOUT_USAGE);

    expect(resp.usage).toEqual({ input_tokens: 0, output_tokens: 0 });
    // 「其余照常转换」不是顺带一说: 它正是这条修复的理由 —— 上游不计量不该让正文消失。
    expect(resp.stop_reason).toBe('tool_use');
    expect(resp.content.map((b) => b.type)).toEqual(['thinking', 'text', 'tool_use']);
  });

  it('parseOpenAIResponseToAnthropic: 缺 usage 时计数按 0, 其余照常转换', () => {
    // 载重断言 (第二条路径)。两处是各自独立的一行, 只改一处时这条仍会红。
    const resp = parseOpenAIResponseToAnthropic(BODY_WITHOUT_USAGE);

    expect(resp.usage).toEqual({ input_tokens: 0, output_tokens: 0 });
    expect(resp.stop_reason).toBe('tool_use');
    expect(resp.content.map((b) => b.type)).toEqual(['thinking', 'text', 'tool_use']);
  });

  it('正向对照: usage 在场时两条路径都原样搬运计数 (证明钉的不是「恒 0」)', () => {
    // 独立用例: 载重断言被篡改打红时, 这条必须仍绿 —— 否则无从分辨「容忍没生效」与
    // 「映射整个坏掉」。它走的是 `?? 0` 的左支, 结构上不经过缺席分支。
    const viaAdapter = new OpenAIAdapter().parseResponse(BODY_WITH_USAGE);
    expect(viaAdapter.usage).toEqual({ input_tokens: 11, output_tokens: 7 });

    const viaAnthropic = parseOpenAIResponseToAnthropic(BODY_WITH_USAGE);
    expect(viaAnthropic.usage).toEqual({ input_tokens: 11, output_tokens: 7 });
  });
});
