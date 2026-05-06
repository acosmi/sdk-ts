// 端口自 acosmi-sdk-go/sanitize/history_test.go (关键 case)
//
// stripEphemeral 行为 + tool_use_id 联动剥除 + thinking 硬豁免.

import { describe, it, expect } from 'vitest';
import { stripEphemeral, dropBlocks } from '../../src/sanitize';

describe('stripEphemeral', () => {
  it('剥除带 acosmi_ephemeral=true 的 block', () => {
    const messages = [
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'hi' },
          { type: 'text', text: 'temp', acosmi_ephemeral: true },
        ],
      },
    ];
    const out = stripEphemeral(messages) as Array<{ role: string; content: unknown[] }>;
    expect(out).toHaveLength(1);
    expect(out[0]!.content).toHaveLength(1);
    expect((out[0]!.content[0] as { text: string }).text).toBe('hi');
  });

  it('thinking 硬豁免: 即便 ephemeral=true 也不剥', () => {
    const messages = [
      {
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: 'why', acosmi_ephemeral: true },
          { type: 'text', text: 'answer' },
        ],
      },
    ];
    const out = stripEphemeral(messages) as Array<{ role: string; content: unknown[] }>;
    expect(out[0]!.content).toHaveLength(2);
  });

  it('redacted_thinking 硬豁免', () => {
    const messages = [
      {
        role: 'assistant',
        content: [
          { type: 'redacted_thinking', data: 'xx', acosmi_ephemeral: true },
        ],
      },
    ];
    const out = stripEphemeral(messages) as Array<{ role: string; content: unknown[] }>;
    expect(out[0]!.content).toHaveLength(1);
  });

  it('剥除 ephemeral tool_use 时联动剥除引用它的 tool_result', () => {
    const messages = [
      {
        role: 'assistant',
        content: [
          { type: 'tool_use', id: 'tu_1', name: 'fn', input: {}, acosmi_ephemeral: true },
        ],
      },
      {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 'tu_1', content: 'ok' }],
      },
    ];
    const out = stripEphemeral(messages);
    // 两条消息都被整条丢弃 (assistant 全 ephemeral; user 全是联动剥)
    expect(out).toHaveLength(0);
  });

  it('未带 ephemeral 标记的 block 不剥', () => {
    const messages = [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }];
    const out = stripEphemeral(messages) as Array<{ role: string; content: unknown[] }>;
    expect(out).toEqual(messages);
  });
});

describe('dropBlocks', () => {
  it('剥除 pred 命中的 block', () => {
    const messages = [
      {
        role: 'user',
        content: [
          { type: 'image', source: {} },
          { type: 'text', text: 'hi' },
        ],
      },
    ];
    const out = dropBlocks(messages, (b) => b['type'] === 'image') as Array<{ role: string; content: unknown[] }>;
    expect(out[0]!.content).toHaveLength(1);
  });

  it('content 空消息整条丢弃 — 防 provider 空消息错', () => {
    const messages = [
      {
        role: 'assistant',
        content: [{ type: 'text', text: 'a', acosmi_ephemeral: true }],
      },
      {
        role: 'user',
        content: [{ type: 'text', text: 'kept' }],
      },
    ];
    const out = stripEphemeral(messages) as Array<{ role: string; content: unknown[] }>;
    expect(out).toHaveLength(1);
    expect((out[0]!.content[0] as { text: string }).text).toBe('kept');
  });
});
