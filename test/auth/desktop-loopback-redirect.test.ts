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

/** 启动 authorize (跳过浏览器), 解析出本地回环 /callback 的 redirect_uri */
async function startAndGetCallbackURI(
  opts: Record<string, unknown>,
): Promise<{ promise: ReturnType<typeof authorize>; redirectURI: string }> {
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
  const redirectURI = new URL(authUrl).searchParams.get('redirect_uri');
  if (!redirectURI) throw new Error('auth URL missing redirect_uri');
  return { promise, redirectURI };
}

describe('desktop loopback success redirect (issue C)', () => {
  it('302-redirects browser to the branded success page when successRedirectURL is provided', async () => {
    const successURL = 'https://acosmi.com/oauth/code/success?app=crabcode';
    const { promise, redirectURI } = await startAndGetCallbackURI({
      successRedirectURL: successURL,
    });

    const resp = await fetch(`${redirectURI}?code=test-code`, { redirect: 'manual' });
    expect(resp.status).toBe(302);
    expect(resp.headers.get('location')).toBe(successURL);

    // 安全模型不变: 授权码仍被本地捕获, authorize 正常完成
    const r = await promise;
    expect(r.result.code).toBe('test-code');
  });

  it('keeps the local success HTML (200) when no successRedirectURL is given (zero regression)', async () => {
    const { promise, redirectURI } = await startAndGetCallbackURI({});

    const resp = await fetch(`${redirectURI}?code=test-code`, { redirect: 'manual' });
    expect(resp.status).toBe(200);
    expect(resp.headers.get('content-type') ?? '').toContain('text/html');
    expect(await resp.text()).toContain('授权成功');

    const r = await promise;
    expect(r.result.code).toBe('test-code');
  });

  it('falls back to local HTML for non-http(s) redirect URLs (no open redirect)', async () => {
    const { promise, redirectURI } = await startAndGetCallbackURI({
      successRedirectURL: 'javascript:alert(1)',
    });

    const resp = await fetch(`${redirectURI}?code=test-code`, { redirect: 'manual' });
    expect(resp.status).toBe(200);
    expect(resp.headers.get('location')).toBeNull();
    expect(await resp.text()).toContain('授权成功');

    const r = await promise;
    expect(r.result.code).toBe('test-code');
  });
});
