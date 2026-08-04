// `submitBugReport` / `getBugReport` 的 **wire 路径**闸门。
//
// 背景（2026-08-04 根因修复）：这两个端点返回**裸字段**，不是平台通用的
// `{code, data, msg}` 信封 —— 真源 nexus-v4 `internal/handler/crabcode_bug.go`
// (`Submit` → `gin.H{"feedback_id", "detail_url"}`，`AdminGet` → `view`)，移植源
// Go SDK `bug_report.go` 也是直接 decode。是本 TS 移植自己套了一层 `APIResponse`
// 后取 `.data`，于是恒返回 `undefined`。
//
// 这个缺陷的形态特别隐蔽：网关此时**已经落库并发出通知邮件**，所以调用方报「提交
// 失败」而运维侧收到通知，两边各自看起来都像对方的问题。CrabCode GUI 的「问题反馈」
// 因此不可用了两个多月。
//
// 之所以以前没被测出来：本 SDK 对这两个方法**一条测试都没有**（Rust 移植有测试，
// 但只测结构体的 serde 形态，同样照不到 wire 路径）。所以这里必须打在真方法上，
// 用假 fetch 喂网关的真实响应体，而不是测某个内部 helper 的抄件。

import { describe, expect, it } from 'vitest';
import { Client } from '../src';

const future = new Date(Date.now() + 60_000).toISOString();

function clientWithFetch(fetchImpl: typeof fetch): Client {
  const client = new Client({ serverURL: 'https://nexus.test', fetchImpl });
  client.tokens = {
    access_token: 'token-1',
    refresh_token: 'refresh-1',
    expires_at: future,
    scope: 'account',
    client_id: 'client-1',
    server_url: 'https://nexus.test',
  };
  return client;
}

function jsonResp(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** 网关 `Submit` 的真实 200 响应体。 */
const BARE_SUBMIT = {
  feedback_id: 'uuid-1',
  detail_url: 'https://nexus.test/chat/crabcode/bug/uuid-1',
};

/** 网关 `AdminGet` 的真实 200 响应体（PublicView）。 */
const BARE_VIEW = {
  id: 'uuid-1',
  description: 'boom',
  messageCount: 2,
  hasErrors: true,
  status: 'new',
  createdAt: '2026-08-04T00:00:00Z',
};

describe('submitBugReport — 网关裸响应', () => {
  it('解析裸 {feedback_id, detail_url}（网关当前真形态）', async () => {
    const client = clientWithFetch(async () => jsonResp(BARE_SUBMIT));
    const result = await client.submitBugReport({ description: 'boom' });
    expect(result.feedback_id).toBe('uuid-1');
    expect(result.detail_url).toBe('https://nexus.test/chat/crabcode/bug/uuid-1');
  });

  it('请求体是**单层** {content: <JSON 字符串>}', async () => {
    let seen: unknown;
    const client = clientWithFetch(async (_url, init) => {
      seen = JSON.parse(String((init as RequestInit).body));
      return jsonResp(BARE_SUBMIT);
    });
    await client.submitBugReport({ description: 'boom', platform: 'win32' });

    const body = seen as { content?: unknown };
    expect(typeof body.content).toBe('string');
    const inner = JSON.parse(body.content as string);
    expect(inner).toEqual({ description: 'boom', platform: 'win32' });
    // 双层包裹的指纹：解一次还剩一个 content。
    expect(inner).not.toHaveProperty('content');
  });

  it('信封形态也能解（网关将来若统一成信封，不回归）', async () => {
    const client = clientWithFetch(async () =>
      jsonResp({ code: 0, msg: '', data: BARE_SUBMIT }),
    );
    const result = await client.submitBugReport({ description: 'boom' });
    expect(result.feedback_id).toBe('uuid-1');
  });

  it('2xx 但缺必填字段时**抛错**并带上观察到的 key —— 不静默返回 undefined', async () => {
    const client = clientWithFetch(async () => jsonResp({ code: 0, msg: 'ok' }));
    await expect(client.submitBugReport({ description: 'boom' })).rejects.toThrow(
      /submitBugReport.*observed keys: code,msg/s,
    );
  });

  it('业务码非 0 仍按 BusinessError 抛（doJSON 的既有语义不受影响）', async () => {
    const client = clientWithFetch(async () =>
      jsonResp({ code: 41001, msg: 'nope', data: null }),
    );
    await expect(client.submitBugReport({ description: 'boom' })).rejects.toThrow();
  });
});

describe('getBugReport — 网关裸响应', () => {
  it('解析裸 view（AdminGet 直接 c.JSON(200, view)）', async () => {
    const client = clientWithFetch(async () => jsonResp(BARE_VIEW));
    const view = await client.getBugReport('uuid-1');
    expect(view.id).toBe('uuid-1');
    expect(view.description).toBe('boom');
  });

  it('信封形态也能解', async () => {
    const client = clientWithFetch(async () => jsonResp({ code: 0, data: BARE_VIEW }));
    const view = await client.getBugReport('uuid-1');
    expect(view.id).toBe('uuid-1');
  });

  it('缺必填字段时抛错而不是返回 undefined', async () => {
    const client = clientWithFetch(async () => jsonResp({ code: 0, msg: 'ok' }));
    await expect(client.getBugReport('uuid-1')).rejects.toThrow(/getBugReport/);
  });
});
