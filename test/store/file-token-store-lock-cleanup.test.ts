// file-token-store-lock-cleanup.test.ts
//
// `withLock` 里两个 unlink（释放 / stale-break）此前是 `catch {}` —— 整段沉默。
// 失败的后果不是立刻报错，而是锁文件留在盘上、下一次 acquire 一直退避到 `staleMs`
// (60 s) 才 break 得掉：症状是「偶发卡 30~60 秒」，而日志里一个字都没有。
//
// 本闸门钉三件事：
//   1. 真失败（EACCES 这类）必须记一条，且点名是哪个阶段、哪个锁文件；
//   2. ENOENT **不记** —— 那是两个调用点都明确允许的竞态（释放期间被 stale-break 删掉 /
//      stale-break 时别人先删了）；恒响的 warn 等于没有 warn；
//   3. 行为不变：两条路径仍然 fail-soft，`withLock` 不因清理失败而抛，fn 的返回值照常出来。
//
// 故障注入用穿透式 mock 包 `unlink` 一个入口（整只替换会把同文件里 mkdtemp / rm /
// writeFile 这些真实 IO 一起打掉）。stale-break 那一档的注入**先做真实删除再抛**：
// 判据的主题是「报错时要不要记日志」，而不是「文件有没有被删掉」；不真删的话循环会一直
// 撞同一把陈旧锁，直到 30 s 的 acquireTimeoutMs —— 那不是闸门该付的成本。
//
// 篡改对照（本轮实跑）：把 store.ts 的 `warnLockCleanupFailed('release', …)` 改回
// 空 `catch {}` ⇒ 第 1 条立刻红；把该函数里的 `if (isNotExistError(e)) return;` 删掉
// ⇒ 第 2 条立刻红。

import { mkdtemp, rm, stat, writeFile, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FileTokenStore, fileLockDefaults } from '../../src';

/** mock 工厂是 hoist 的，控制面必须经 vi.hoisted 才能被它看见。 */
const ctl = vi.hoisted(() => ({
  /**
   * 返回 Error ⇒ 这次 unlink 抛它（注入前已按 realUnlinkFirst 决定要不要先真删）；
   * 返回 null ⇒ 放行到真实 unlink。
   */
  unlinkInterceptor: null as null | ((path: string) => Error | null),
  /** true ⇒ 注入错误之前先执行真实 unlink，让调用方的循环能往前走。 */
  realUnlinkFirst: false,
  unlinkCalls: 0,
}));

vi.mock('node:fs/promises', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  const unlink = (async (...args: Parameters<typeof actual.unlink>) => {
    const path = String(args[0]);
    const err = ctl.unlinkInterceptor?.(path);
    if (!err) return actual.unlink(...args);
    ctl.unlinkCalls += 1;
    if (ctl.realUnlinkFirst) {
      try {
        await actual.unlink(...args);
      } catch {
        // 本就不存在 —— 注入的错误照抛。
      }
    }
    throw err;
  }) as typeof actual.unlink;
  return { ...actual, default: { ...actual, unlink }, unlink };
});

let tmpDir: string;
let tokenPath: string;
let lockPath: string;
let warnSpy: ReturnType<typeof vi.spyOn>;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'acosmi-lock-cleanup-'));
  tokenPath = join(tmpDir, 'tokens.json');
  lockPath = `${tokenPath}.lock`;
  ctl.unlinkInterceptor = null;
  ctl.realUnlinkFirst = false;
  ctl.unlinkCalls = 0;
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(async () => {
  ctl.unlinkInterceptor = null;
  ctl.realUnlinkFirst = false;
  warnSpy.mockRestore();
  await rm(tmpDir, { recursive: true, force: true });
});

function errno(code: string, message: string): Error {
  return Object.assign(new Error(`${code}: ${message}, unlink`), { code });
}

/** 让锁路径上的 unlink 一律抛 code（非锁路径放行）。 */
function failLockUnlink(code: string, realFirst = false): void {
  ctl.realUnlinkFirst = realFirst;
  ctl.unlinkInterceptor = (p: string) =>
    p.endsWith('.lock') ? errno(code, 'permission denied') : null;
}

/** 已记录的 warn 行（每次 console.warn 的首个实参）。 */
function warnLines(): string[] {
  return warnSpy.mock.calls.map(args => String(args[0]));
}

describe('withLock 的锁文件清理失败不再静默', () => {
  it('释放阶段 unlink 真失败 ⇒ 记一条并点名阶段与路径，withLock 仍然返回 fn 的结果', async () => {
    const s = new FileTokenStore(tokenPath);
    failLockUnlink('EACCES');

    // 行为不变：fail-soft，返回值照常出来，不抛。
    await expect(s.withLock!(async () => 'payload')).resolves.toBe('payload');

    expect(ctl.unlinkCalls).toBe(1);
    const lines = warnLines();
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('[acosmi-sdk] warning:');
    expect(lines[0]).toContain('(release)');
    expect(lines[0]).toContain(lockPath);
    expect(lines[0]).toContain('EACCES');
  });

  it('负向对照：释放阶段 ENOENT 不记（锁已被 stale-break 删掉是允许的竞态）', async () => {
    const s = new FileTokenStore(tokenPath);
    failLockUnlink('ENOENT');

    await expect(s.withLock!(async () => 'payload')).resolves.toBe('payload');

    expect(ctl.unlinkCalls).toBe(1); // 前提自检：注入确实命中了那次 unlink
    expect(warnLines()).toEqual([]);
  });

  it('stale-break 阶段 unlink 真失败 ⇒ 记一条，阶段名与释放阶段分得开', async () => {
    const s = new FileTokenStore(tokenPath);
    // 手工造一把"崩溃残留"的锁：文件真实存在（open 抛 EEXIST），mtime 早于 staleMs。
    await writeFile(lockPath, '99999\n0\n', { mode: 0o600 });
    const oldSec = (Date.now() - fileLockDefaults.staleMs - 5_000) / 1000;
    await utimes(lockPath, oldSec, oldSec);
    // 只让第一次（stale-break 那次）失败；之后的释放走真实 unlink。
    let injected = 0;
    ctl.realUnlinkFirst = true;
    ctl.unlinkInterceptor = (p: string) => {
      if (!p.endsWith('.lock') || injected > 0) return null;
      injected += 1;
      return errno('EACCES', 'permission denied');
    };

    await expect(s.withLock!(async () => 'payload')).resolves.toBe('payload');

    const lines = warnLines();
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('(stale-break)');
    expect(lines[0]).toContain(lockPath);
    // 释放正常完成 —— 锁没留在盘上。
    await expect(stat(lockPath)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('正向对照：清理成功的正常路径一条 warn 都不记，锁文件被删掉', async () => {
    const s = new FileTokenStore(tokenPath);

    await expect(s.withLock!(async () => 'payload')).resolves.toBe('payload');

    expect(warnLines()).toEqual([]);
    await expect(stat(lockPath)).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
