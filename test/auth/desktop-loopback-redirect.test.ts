// desktop-loopback-redirect.test.ts — issue C: 桌面 loopback 授权成功页 302 到品牌域名
//
// 覆盖 (真实驱动 authorize 的本地回环 server, 非 mock):
//   - 提供合法 successRedirectURL → /callback 返回 302 + Location 指向品牌成功页,
//     地址栏脱离 127.0.0.1; 授权码仍被本地捕获 (authorize 正常 resolve)。
//   - 未提供 → 保留原本地"授权成功"HTML (200, text/html), 零回归。
//   - 非法 URL (非 http(s) 协议) → 回退本地 HTML, 不发生开放重定向 (纵深防御)。
import { describe, it, expect } from 'vitest';
import { authorize, EventAuthURL, type ServerMetadata, type LoginEvent } from '../../src';

const fakeMeta: ServerMetadata = {
  issuer: 'https://acosmi.com',
  authorization_endpoint: 'https://acosmi.com/oauth/desktop/authorize',
  token_endpoint: 'https://acosmi.com/oauth/desktop/token',
  revocation_endpoint: 'https://acosmi.com/oauth/desktop/revoke',
  registration_endpoint: 'https://acosmi.com/oauth/desktop/register',
  scopes_supported: ['ai', 'skills', 'account'],
};

/**
 * 启动 authorize (跳过浏览器), 解析出本地回环 /callback 的 redirect_uri 与本次流程的 state。
 *
 * state 必须从授权 URL 里取: 2026-08-14 起桌面流程带 state 且在回调时严格校验, 回调不带
 * (或带错) state 一律拒绝 —— 测试要模拟的是**合法**回调, 就得像真浏览器一样把 state 带回来。
 */
async function startAndGetCallbackURI(
  opts: Record<string, unknown>,
): Promise<{ promise: ReturnType<typeof authorize>; redirectURI: string; state: string }> {
  let authUrl = '';
  const promise = authorize(fakeMeta, 'client-1', ['ai', 'skills', 'account'], {
    skipBrowser: true,
    handler: (e: LoginEvent) => {
      if (e.type === EventAuthURL && e.url) authUrl = e.url;
    },
    ...opts,
  });
  // emit(EventAuthURL) 在若干 await 后才触发, 轮询等待
  for (let i = 0; i < 200 && authUrl === ''; i++) {
    await new Promise((r) => setTimeout(r, 5));
  }
  if (authUrl === '') throw new Error('did not receive auth URL');
  const parsed = new URL(authUrl);
  const redirectURI = parsed.searchParams.get('redirect_uri');
  if (!redirectURI) throw new Error('auth URL missing redirect_uri');
  const state = parsed.searchParams.get('state');
  if (!state) throw new Error('auth URL missing state (desktop flow must send state)');
  return { promise, redirectURI, state };
}

describe('desktop loopback success redirect (issue C)', () => {
  it('302-redirects browser to the branded success page when successRedirectURL is provided', async () => {
    const successURL = 'https://acosmi.com/oauth/code/success?app=crabcode';
    const { promise, redirectURI, state } = await startAndGetCallbackURI({
      successRedirectURL: successURL,
    });

    const resp = await fetch(`${redirectURI}?code=test-code&state=${encodeURIComponent(state)}`, {
      redirect: 'manual',
    });
    expect(resp.status).toBe(302);
    expect(resp.headers.get('location')).toBe(successURL);

    // 安全模型不变: 授权码仍被本地捕获, authorize 正常完成
    const r = await promise;
    expect(r.result.code).toBe('test-code');
  });

  it('keeps the local success HTML (200) when no successRedirectURL is given (zero regression)', async () => {
    const { promise, redirectURI, state } = await startAndGetCallbackURI({});

    const resp = await fetch(`${redirectURI}?code=test-code&state=${encodeURIComponent(state)}`, {
      redirect: 'manual',
    });
    expect(resp.status).toBe(200);
    expect(resp.headers.get('content-type') ?? '').toContain('text/html');
    expect(await resp.text()).toContain('授权成功');

    const r = await promise;
    expect(r.result.code).toBe('test-code');
  });

  it('falls back to local HTML for non-http(s) redirect URLs (no open redirect)', async () => {
    const { promise, redirectURI, state } = await startAndGetCallbackURI({
      successRedirectURL: 'javascript:alert(1)',
    });

    const resp = await fetch(`${redirectURI}?code=test-code&state=${encodeURIComponent(state)}`, {
      redirect: 'manual',
    });
    expect(resp.status).toBe(200);
    expect(resp.headers.get('location')).toBeNull();
    expect(await resp.text()).toContain('授权成功');

    const r = await promise;
    expect(r.result.code).toBe('test-code');
  });

  it('rejects a callback whose state does not match (local login-CSRF)', async () => {
    // 攻击模型: 本机另一个进程猜到回环端口, 把**攻击者的**授权码打进来。若 SDK 不校验 state,
    // 它会拿这个码去换 token, 用户的客户端就悄悄登进了攻击者的账号。
    const { promise, redirectURI } = await startAndGetCallbackURI({});
    // 先挂上期望再触发回调: 否则 promise 会在 fetch 与 await 之间的微任务窗口里以"无处理器"
    // 状态被拒绝, Node 会记一条 unhandled rejection (真实调用方是一直 await 着的)。
    const rejection = expect(promise).rejects.toThrow(/state_mismatch/);

    const resp = await fetch(`${redirectURI}?code=attacker-code&state=wrong-state`, {
      redirect: 'manual',
    });
    expect(resp.status).toBe(200);
    expect(await resp.text()).toContain('授权失败');

    await rejection;
  });
});
