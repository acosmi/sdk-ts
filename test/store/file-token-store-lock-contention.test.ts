// file-token-store-lock-contention.test.ts — 2.19.5
//
// `withLock` 的「锁被占」判据此前只认 EEXIST。Windows 上前一持有者 `unlink` 之后、
// 最后一个句柄关闭之前，文件处于 NT 的 STATUS_DELETE_PENDING，此刻 `open(...,'wx')`
// 被映射成 EPERM（本机实测；EBUSY 同机理）—— 恰恰不是 EEXIST，于是 `if (!isAlreadyExistsError(e))
// throw e` 把一次**正常的锁交接**报成致命错误。实测症状：同一进程 5 个并发 withLock，
// 其中一个直接以 `EPERM: operation not permitted, open '...tokens.json.lock'` 失败。
//
// 这里用穿透式 mock 注入 `fs.open` 的错误码，让判据与平台都可控 —— 否则这组断言的答案
// 会取决于「跑在哪台机器上」，那不是闸门。另外两条是必须的对照：
//   - 非争用错误（ENOENT）仍原样抛出；
//   - 非 Windows 平台上的 EPERM 仍是致命错误（POSIX 的 EPERM 是真权限问题，
//     收进来会把"配置错了"拖成"30 秒后超时"）。

import { mkdtemp, rm, stat, writeFile, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FileTokenStore, fileLockDefaults } from '../../src';

/** mock 工厂是 hoist 的，控制面必须经 vi.hoisted 才能被它看见。 */
const ctl = vi.hoisted(() => ({
  /** 返回 Error ⇒ 这次 open 抛它；返回 null ⇒ 放行到真实 open。 */
  openInterceptor: null as null | ((path: string) => Error | null),
  /** 落在 `.lock` 上的 stat 次数 —— 用来证明 delete-pending 档确实**跳过**了 stale 检测。 */
  lockStatCalls: 0,
}));

// 穿透式 mock：只包 open / stat 两个入口，其余一律是真函数（整只替换会把同文件里
// mkdtemp / rm / writeFile 这些真实 IO 一起打掉）。
vi.mock('node:fs/promises', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  const open = (async (...args: Parameters<typeof actual.open>) => {
    const err = ctl.openInterceptor?.(String(args[0]));
    if (err) throw err;
    return actual.open(...args);
  }) as typeof actual.open;
  const stat_ = (async (...args: Parameters<typeof actual.stat>) => {
    if (String(args[0]).endsWith('.lock')) ctl.lockStatCalls += 1;
    return actual.stat(...args);
  }) as typeof actual.stat;
  return { ...actual, default: { ...actual, open, stat: stat_ }, open, stat: stat_ };
});

let tmpDir: string;
let tokenPath: string;
let lockPath: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'acosmi-lock-'));
  tokenPath = join(tmpDir, 'tokens.json');
  lockPath = `${tokenPath}.lock`;
  ctl.openInterceptor = null;
  ctl.lockStatCalls = 0;
});

afterEach(async () => {
  ctl.openInterceptor = null;
  await rm(tmpDir, { recursive: true, force: true });
});

/** 把判据依赖的 `process.platform` 钉成指定值；用完按原描述符还原。 */
async function withPlatform<T>(platform: string, fn: () => Promise<T>): Promise<T> {
  const original = Object.getOwnPropertyDescriptor(process, 'platform');
  Object.defineProperty(process, 'platform', {
    value: platform,
    configurable: true,
    enumerable: true,
    writable: false,
  });
  try {
    return await fn();
  } finally {
    if (original) Object.defineProperty(process, 'platform', original);
  }
}

function errno(code: string, message: string): Error {
  return Object.assign(new Error(`${code}: ${message}, open`), { code });
}

/** 让锁路径上的第 n 次 open 抛出 code，其余放行。 */
function failLockOpenOnce(code: string): () => number {
  let opens = 0;
  ctl.openInterceptor = (p: string) => {
    if (!p.endsWith('.lock')) return null;
    opens += 1;
    return opens === 1 ? errno(code, 'operation not permitted') : null;
  };
  return () => opens;
}

describe('withLock 对 Windows delete-pending 的争用判定（2.19.5）', () => {
  // 只有这两个码算争用。EPERM 是本机实测的 delete-pending 真实表现，EBUSY 是同机理的
  // 第二种表现；EACCES 见下面的负向对照 —— 它是真权限错误，必须立刻报。
  for (const code of ['EPERM', 'EBUSY']) {
    it(`win32 上首次 open 抛 ${code} ⇒ 退避重试并拿到锁，fn 恰跑一次`, async () => {
      const s = new FileTokenStore(tokenPath);
      const opens = failLockOpenOnce(code);
      let ran = 0;

      await withPlatform('win32', () =>
        s.withLock!(async () => {
          ran += 1;
        }),
      );

      // 承重判据：真的重试了（2 次 open），而不是"第一次就莫名其妙成功了"。
      expect(opens()).toBe(2);
      expect(ran).toBe(1);
      // 锁已释放（走完了正常的 acquire → fn → release 全程）。
      await expect(stat(lockPath)).rejects.toMatchObject({ code: 'ENOENT' });
    });
  }

  it('负向对照：win32 上的 EACCES 仍是致命错误（锁目录只读这类配置错误要立刻报）', async () => {
    const s = new FileTokenStore(tokenPath);
    const opens = failLockOpenOnce('EACCES');
    let ran = 0;

    await expect(
      withPlatform('win32', () =>
        s.withLock!(async () => {
          ran += 1;
        }),
      ),
    ).rejects.toMatchObject({ code: 'EACCES' });

    // 一次都没重试 —— 把它收进争用档的代价正是「立刻报 EACCES」变成「30s 后报 acquire timeout」。
    expect(opens()).toBe(1);
    expect(ran).toBe(0);
  });

  it('delete-pending 档跳过 stale 检测（对那一刻的锁文件不做 stat）', async () => {
    const s = new FileTokenStore(tokenPath);
    failLockOpenOnce('EPERM');

    await withPlatform('win32', () => s.withLock!(async () => undefined));

    // stat 一个 delete-pending 的文件要么失败、要么读到前一持有者的旧 mtime，
    // 两种都会把"正在消失的锁"误判成"崩溃残留"；而 stat 失败那条腿是 `continue`，
    // 不过 acquireTimeoutMs 检查 —— 持续 EPERM 会变成不退出的忙循环。
    expect(ctl.lockStatCalls).toBe(0);
  });

  it('正向对照：EEXIST 仍然走 stale 检测并 break 掉崩溃残留', async () => {
    const s = new FileTokenStore(tokenPath);
    // 手工造一把"崩溃残留"的锁：文件真实存在（open 会自然抛 EEXIST），mtime 早于 staleMs。
    await writeFile(lockPath, '99999\n0\n', { mode: 0o600 });
    const oldSec = (Date.now() - fileLockDefaults.staleMs - 5_000) / 1000;
    await utimes(lockPath, oldSec, oldSec);

    let ran = 0;
    await withPlatform('win32', () =>
      s.withLock!(async () => {
        ran += 1;
      }),
    );

    expect(ran).toBe(1);
    // 这一档必须 stat 过锁文件 —— 否则"跳过 stale"就退化成了"永远不做 stale 检测",
    // 崩溃残留的锁会一直等到 acquireTimeoutMs。
    expect(ctl.lockStatCalls).toBeGreaterThanOrEqual(1);
  });

  it('负向对照：非争用错误（ENOENT）原样抛出，fn 不执行', async () => {
    const s = new FileTokenStore(tokenPath);
    ctl.openInterceptor = (p: string) =>
      p.endsWith('.lock') ? errno('ENOENT', 'no such file or directory') : null;
    let ran = 0;

    await expect(
      withPlatform('win32', () =>
        s.withLock!(async () => {
          ran += 1;
        }),
      ),
    ).rejects.toMatchObject({ code: 'ENOENT' });
    expect(ran).toBe(0);
  });

  it('负向对照：非 Windows 平台上 EPERM 仍是致命错误（POSIX 的 EPERM 是真权限问题）', async () => {
    const s = new FileTokenStore(tokenPath);
    ctl.openInterceptor = (p: string) =>
      p.endsWith('.lock') ? errno('EPERM', 'operation not permitted') : null;
    let ran = 0;

    await expect(
      withPlatform('linux', () =>
        s.withLock!(async () => {
          ran += 1;
        }),
      ),
    ).rejects.toMatchObject({ code: 'EPERM' });
    expect(ran).toBe(0);
  });
});
