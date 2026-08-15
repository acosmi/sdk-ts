// desktop-loopback-state.test.ts — 桌面 loopback OAuth state 全路径矩阵 (2026-08-15)
//
// 交接验收 (DSH-GUI → Acosmi SDK): callback 必须在 token 交换前验证**恰好一个** state
// 且与当前这次登录完全匹配; 缺失、重复、错误值以及携带 OAuth error 的回调同样必须先过
// state 校验; 每条终止路径只结算一次且端口完全关闭。
//
// 覆盖: 成功 / 缺失 state / 错误 state / 重复 state / 恶意先到回调 / 用户拒绝 /
// 超时 / 取消 / 浏览器打开失败 / listener teardown (端口关闭)。
import { describe, it, expect } from 'vitest';
import {
  authorize,
  EventAuthURL,
  EventError,
  ErrAuthDenied,
  ErrBrowserOpen,
  ErrStateMismatch,
  ErrTimeout,
  type LoginEvent,
  type ServerMetadata,
} from '../../src';

const fakeMeta: ServerMetadata = {
  issuer: 'https://acosmi.com',
  authorization_endpoint: 'https://acosmi.com/oauth/desktop/authorize',
  token_endpoint: 'https://acosmi.com/oauth/desktop/token',
  revocation_endpoint: 'https://acosmi.com/oauth/desktop/revoke',
  registration_endpoint: 'https://acosmi.com/oauth/desktop/register',
  scopes_supported: ['ai', 'skills', 'account'],
};

interface Started {
  promise: ReturnType<typeof authorize>;
  redirectURI: string;
  state: string;
  events: LoginEvent[];
}

/** 启动 authorize (默认跳过浏览器), 返回回环 redirect_uri / 本次 state / 事件流。 */
async function start(opts: Record<string, unknown> = {}): Promise<Started> {
  const events: LoginEvent[] = [];
  let authUrl = '';
  const promise = authorize(fakeMeta, 'client-1', ['ai'], {
    skipBrowser: true,
    handler: (e: LoginEvent) => {
      events.push(e);
      if (e.type === EventAuthURL && e.url) authUrl = e.url;
    },
    ...opts,
  });
  // 真实调用方从头到尾 await 着; 测试要先拿 auth_url 再挂期望, 这个窗口里的快速拒绝
  // (如 pre-aborted signal) 会被 Node 记成 unhandled rejection。先挂空 catch 标记已处理,
  // 不影响后续 expect(promise).rejects 的断言语义。
  promise.catch(() => {});
  for (let i = 0; i < 200 && authUrl === ''; i++) {
    await new Promise((r) => setTimeout(r, 5));
  }
  if (authUrl === '') throw new Error('did not receive auth URL');
  const parsed = new URL(authUrl);
  const redirectURI = parsed.searchParams.get('redirect_uri');
  if (!redirectURI) throw new Error('auth URL missing redirect_uri');
  const state = parsed.searchParams.get('state');
  if (!state) throw new Error('auth URL missing state (desktop flow must send state)');
  return { promise, redirectURI, state, events };
}

/** 断言回环端口已完全关闭: 新连接最终被拒绝 (close 在结算后的 finally 里异步生效, 轮询等待)。 */
async function expectPortClosed(redirectURI: string): Promise<void> {
  for (let i = 0; i < 100; i++) {
    try {
      await fetch(redirectURI);
    } catch {
      return; // 连接被拒 = 端口已关
    }
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error(`loopback listener still accepting connections: ${redirectURI}`);
}

const countErrors = (events: LoginEvent[]) => events.filter((e) => e.type === EventError).length;

describe('desktop loopback state matrix', () => {
  it('success: settles once with the code, later callbacks cannot flip it, port fully closes', async () => {
    const { promise, redirectURI, state } = await start();
    const q = `?code=good-code&state=${encodeURIComponent(state)}`;
    await fetch(redirectURI + q, { redirect: 'manual' });
    const r = await promise;
    expect(r.result.code).toBe('good-code');

    // 结算后再打一发合法形状的回调: 要么端口已拒, 要么被忽略 — 结果不变。
    try {
      await fetch(`${redirectURI}?code=late-code&state=${encodeURIComponent(state)}`);
    } catch {
      // 端口已关, 同样符合契约
    }
    expect((await promise).result.code).toBe('good-code');
    await expectPortClosed(redirectURI);
  });

  it('missing state (with code) is rejected as state_mismatch before any code consumption', async () => {
    const { promise, redirectURI, events } = await start();
    const rejection = expect(promise).rejects.toThrow(/state_mismatch.*missing state/);
    const resp = await fetch(`${redirectURI}?code=attacker-code`, { redirect: 'manual' });
    expect(await resp.text()).toContain('授权失败');
    await rejection;
    expect(countErrors(events)).toBe(1);
    expect(events.find((e) => e.type === EventError)?.err_code).toBe(ErrStateMismatch);
    await expectPortClosed(redirectURI);
  });

  it('duplicate state values are rejected even when one of them is correct', async () => {
    const { promise, redirectURI, state } = await start();
    const rejection = expect(promise).rejects.toThrow(/state_mismatch.*multiple state/);
    const good = encodeURIComponent(state);
    await fetch(`${redirectURI}?code=attacker-code&state=${good}&state=wrong`, {
      redirect: 'manual',
    });
    await rejection;
    await expectPortClosed(redirectURI);
  });

  it('duplicate identical states are still "not exactly one" and rejected', async () => {
    const { promise, redirectURI, state } = await start();
    const rejection = expect(promise).rejects.toThrow(/state_mismatch.*multiple state/);
    const good = encodeURIComponent(state);
    await fetch(`${redirectURI}?code=attacker-code&state=${good}&state=${good}`, {
      redirect: 'manual',
    });
    await rejection;
    await expectPortClosed(redirectURI);
  });

  it('OAuth error callback WITHOUT valid state fails state validation, not auth_denied (no unauthenticated login-DoS shaping)', async () => {
    const { promise, redirectURI, events } = await start();
    const rejection = expect(promise).rejects.toThrow(/state_mismatch/);
    await fetch(`${redirectURI}?error=access_denied&error_description=nope`, {
      redirect: 'manual',
    });
    await rejection;
    const err = events.find((e) => e.type === EventError);
    expect(err?.err_code).toBe(ErrStateMismatch);
    expect(err?.err_code).not.toBe(ErrAuthDenied);
    // 错误信息不得回显回调取值/完整 query
    expect(err?.error ?? '').not.toContain('access_denied');
    expect(err?.error ?? '').not.toContain('nope');
    await expectPortClosed(redirectURI);
  });

  it('user denial (OAuth error WITH correct state) settles once as auth_denied', async () => {
    const { promise, redirectURI, state, events } = await start();
    const rejection = expect(promise).rejects.toThrow(/authorization denied/);
    const resp = await fetch(
      `${redirectURI}?error=access_denied&error_description=user+said+no&state=${encodeURIComponent(state)}`,
      { redirect: 'manual' },
    );
    expect(await resp.text()).toContain('授权失败');
    await rejection;
    expect(countErrors(events)).toBe(1);
    expect(events.find((e) => e.type === EventError)?.err_code).toBe(ErrAuthDenied);
    await expectPortClosed(redirectURI);
  });

  it('malicious first callback rejects the login once; a later legitimate callback cannot resurrect it', async () => {
    const { promise, redirectURI, state, events } = await start();
    const rejection = expect(promise).rejects.toThrow(/state_mismatch/);
    await fetch(`${redirectURI}?code=attacker-code&state=wrong-state`, { redirect: 'manual' });
    await rejection;

    // 合法回调迟到: 端口可能已关 (被拒即通过); 若仍被处理, 也不得改变已结算的结果。
    try {
      await fetch(`${redirectURI}?code=legit-code&state=${encodeURIComponent(state)}`);
    } catch {
      // 端口已关
    }
    await expect(promise).rejects.toThrow(/state_mismatch/);
    expect(countErrors(events)).toBe(1);
    await expectPortClosed(redirectURI);
  });

  it('cancel/timeout via AbortSignal settles once as auth_timeout and closes the port', async () => {
    const ctl = new AbortController();
    const { promise, redirectURI, events } = await start({ signal: ctl.signal });
    const rejection = expect(promise).rejects.toThrow(/timed out/);
    ctl.abort();
    await rejection;
    expect(events.find((e) => e.type === EventError)?.err_code).toBe(ErrTimeout);
    // 二次 abort 无副作用 (listener 已摘除)
    ctl.abort();
    await expectPortClosed(redirectURI);
  });

  it('pre-aborted signal rejects immediately and still tears the listener down', async () => {
    const ctl = new AbortController();
    ctl.abort();
    const { promise, redirectURI } = await start({ signal: ctl.signal });
    await expect(promise).rejects.toThrow(/timed out/);
    await expectPortClosed(redirectURI);
  });

  it('browser open failure emits browser_open_failed but the flow still completes via manual callback', async () => {
    const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform')!;
    Object.defineProperty(process, 'platform', { value: 'sunos', configurable: true });
    try {
      const { promise, redirectURI, state, events } = await start({ skipBrowser: false });
      // openBrowser 对不支持的平台抛错 → 不阻塞流程, 仅发事件
      for (let i = 0; i < 200 && !events.some((e) => e.err_code === ErrBrowserOpen); i++) {
        await new Promise((r) => setTimeout(r, 5));
      }
      expect(events.some((e) => e.type === EventError && e.err_code === ErrBrowserOpen)).toBe(
        true,
      );
      await fetch(`${redirectURI}?code=manual-code&state=${encodeURIComponent(state)}`, {
        redirect: 'manual',
      });
      const r = await promise;
      expect(r.result.code).toBe('manual-code');
      await expectPortClosed(redirectURI);
    } finally {
      Object.defineProperty(process, 'platform', originalPlatform);
    }
  });
});
