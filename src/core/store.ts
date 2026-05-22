// store.ts — 端口自 acosmi-sdk-go/store.go (跨端扩展)
//
// Go 侧仅 FileTokenStore (Node 风格 ~/.acosmi/tokens.json)。
// TS 端口扩展为多端: Node File / Browser localStorage / 内存 (兜底).
//
// 接口异步化: Go 同步 IO, TS 必须 async。所有 Save/Load/Clear 返回 Promise。

import type { TokenSet } from '../auth/types';

/**
 * Token 持久化接口
 * 桌面智能体可自行实现 (如 macOS Keychain / Windows Credential Manager)
 *
 * 跨端约定:
 *   - Save: 写入持久化, 失败抛 Error
 *   - Load: 读取, 不存在返回 null (与 Go IsNotExist 行为一致)
 *   - Clear: 删除, 不存在不抛错 (Logout 后 Clear 不应报错, [RC-11])
 *   - withLock (v1.0.2 新增, 可选): 跨进程临界区. Client 在 refresh token rotation
 *     场景下用此包裹 "load → check → refresh → save" 整段, 防多进程共享同一 store
 *     (典型: FileTokenStore 默认 ~/.acosmi/tokens.json) 撞 HTTP 400 refresh token
 *     not found. 不实现时 Client 自动回退到仅进程内串行 (LocalStorage / InMemory
 *     单进程语义无需此方法).
 */
export interface TokenStore {
  save(tokens: TokenSet): Promise<void>;
  load(): Promise<TokenSet | null>;
  clear(): Promise<void>;
  withLock?<T>(fn: () => Promise<T>): Promise<T>;
}

// ============================================================================
// FileTokenStore — Node 文件实现
// ============================================================================

/**
 * 基于文件的 token 存储 (开发/测试用)
 * 生产环境建议替换为系统钥匙串实现
 *
 * 默认路径: ~/.acosmi/tokens.json
 *
 * 浏览器环境调用 new FileTokenStore() 会抛错 — 浏览器请用 LocalStorageTokenStore 或 InMemoryTokenStore.
 */
/** 跨进程文件锁配置 (v1.0.2). 公开常量是为了让 caller / 测试可观察, 不建议生产代码改. */
export const fileLockDefaults = {
  /** 获取锁的超时上限 (毫秒). refresh 流程含网络 < 30s, 30s 已远超正常完成时间. */
  acquireTimeoutMs: 30_000,
  /** 旧锁判定阈值 (毫秒). 锁文件 mtime 早于此值视为 stale 进程崩溃残留, 自动 break. */
  staleMs: 60_000,
  /** 重试间隔基数 (毫秒). 真实间隔 = base + random(0, jitter). */
  retryBaseMs: 30,
  retryJitterMs: 70,
} as const;

export class FileTokenStore implements TokenStore {
  private path: string;
  /** 进程内串行化 (Promise chain) — 与跨进程 flock 配合, 避免单进程内并发持锁产生死锁式互等. */
  private chain: Promise<void> = Promise.resolve();

  constructor(path?: string) {
    if (typeof process === 'undefined' || !process.versions || !process.versions.node) {
      throw new Error('FileTokenStore requires Node.js environment; use LocalStorageTokenStore or InMemoryTokenStore in browser');
    }
    if (path && path !== '') {
      this.path = path;
    } else {
      // 延迟初始化 — constructor 不能 async, 用 lazy resolve
      this.path = '';
    }
  }

  private async resolvePath(): Promise<string> {
    if (this.path && this.path !== '') return this.path;
    const os = await import('node:os');
    const path = await import('node:path');
    this.path = path.join(os.homedir(), '.acosmi', 'tokens.json');
    return this.path;
  }

  /** 进程内串行 (维持 v1.0.1 单进程语义). flock 之外另一层防御: 如果用户自己就是单进程
   *  并发场景, 不必每次都进 flock 旁路文件 IO. */
  private withChain<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.chain.then(fn, fn);
    this.chain = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }

  /**
   * 跨进程临界区. 用 sidecar `<path>.lock` 文件 + O_EXCL 创建语义实现互斥:
   *   - 创建成功 = 持有锁; 写入 pid+timestamp 便于诊断
   *   - 创建失败 (EEXIST) = 别的进程持锁, backoff 重试
   *   - 锁文件 mtime > staleMs = 进程崩溃残留, unlink 后重试
   *   - acquireTimeoutMs 超时 = 抛错 (caller 应作为 transient error 处理, 上层 retry)
   *
   * 注意: O_EXCL 在 NFS 上不保证原子; FileTokenStore 适用于本地文件系统 (典型用户家目录).
   * 真要跨机共享 token, 应实现自定义 Keychain / 数据库 store, 不要用 FileTokenStore.
   */
  async withLock<T>(fn: () => Promise<T>): Promise<T> {
    // 注意: 不能用 withChain 包裹 — fn 内部调 save/load 也走 withChain 会死锁 (re-entrant
    // 不支持). 跨进程互斥已由 sidecar .lock 文件保证; 同一 Client 内并发由上层 withMu 串行;
    // 同一进程不同 Client 实例并发是预期场景, 走 flock 重试路径.
    const fs = await import('node:fs/promises');
    const pathMod = await import('node:path');
    const p = await this.resolvePath();
    const lockPath = `${p}.lock`;
    const dir = pathMod.dirname(p);
    await fs.mkdir(dir, { recursive: true, mode: 0o700 });

    const startMs = Date.now();
    let release: (() => Promise<void>) | null = null;
    while (true) {
      try {
        // 'wx' = O_CREAT | O_EXCL | O_WRONLY → 已存在抛 EEXIST
        const fh = await fs.open(lockPath, 'wx', 0o600);
        try {
          await fh.writeFile(`${process.pid}\n${Date.now()}\n`, 'utf8');
        } finally {
          await fh.close();
        }
        release = async () => {
          try {
            await fs.unlink(lockPath);
          } catch {
            // best-effort — 释放期间被 stale-break 删除是允许的
          }
        };
        break;
      } catch (e) {
        if (!isAlreadyExistsError(e)) throw e;
        // 锁被别的进程持有 — stale 检测
        let stale = false;
        try {
          const st = await fs.stat(lockPath);
          if (Date.now() - st.mtimeMs > fileLockDefaults.staleMs) stale = true;
        } catch {
          // 锁文件刚刚消失 → 立即重试 acquire
          continue;
        }
        if (stale) {
          try {
            await fs.unlink(lockPath);
          } catch {
            // 别人先删了, 没关系
          }
          continue;
        }
        if (Date.now() - startMs > fileLockDefaults.acquireTimeoutMs) {
          throw new Error(
            `acquire token file lock timeout (${fileLockDefaults.acquireTimeoutMs}ms): ${lockPath}`,
          );
        }
        const waitMs =
          fileLockDefaults.retryBaseMs + Math.random() * fileLockDefaults.retryJitterMs;
        await new Promise((r) => setTimeout(r, waitMs));
      }
    }
    try {
      return await fn();
    } finally {
      if (release) await release();
    }
  }

  /**
   * 写入 token. 流程:
   *   1. mkdir -p (默认路径目录)
   *   2. 写入 `<path>.tmp.<pid>`
   *   3. fsync 后 rename 到正式路径 (POSIX 上 rename(2) 同分区原子, Windows 上 ReplaceFile)
   *
   * 选择 atomic rename 而非直接 writeFile: 多进程并发或本进程崩溃时, 读端永远看到的是
   * 完整的旧/新 JSON, 不会读到截断半文件 (Client.create.store.load 可能在另一进程
   * 写入中间触发, atomic rename 避免它解析失败).
   */
  save(tokens: TokenSet): Promise<void> {
    return this.withChain(async () => {
      const fs = await import('node:fs/promises');
      const pathMod = await import('node:path');
      const p = await this.resolvePath();
      const dir = pathMod.dirname(p);
      await fs.mkdir(dir, { recursive: true, mode: 0o700 });
      const tmp = `${p}.tmp.${process.pid}.${Date.now()}.${Math.floor(Math.random() * 1e6)}`;
      const data = JSON.stringify(tokens, null, 2);
      await fs.writeFile(tmp, data, { encoding: 'utf8', mode: 0o600 });
      try {
        await fs.rename(tmp, p);
      } catch (e) {
        // rename 失败 — 清理 tmp 防泄漏
        try {
          await fs.unlink(tmp);
        } catch {
          // ignore
        }
        throw e;
      }
    });
  }

  load(): Promise<TokenSet | null> {
    return this.withChain(async () => {
      const fs = await import('node:fs/promises');
      const p = await this.resolvePath();
      try {
        const data = await fs.readFile(p, 'utf8');
        return JSON.parse(data) as TokenSet;
      } catch (e) {
        if (isNotExistError(e)) return null;
        throw new Error(
          `read token file: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    });
  }

  clear(): Promise<void> {
    return this.withChain(async () => {
      const fs = await import('node:fs/promises');
      const p = await this.resolvePath();
      try {
        await fs.unlink(p);
      } catch (e) {
        if (isNotExistError(e)) return;
        throw e;
      }
    });
  }
}

function isNotExistError(e: unknown): boolean {
  if (typeof e === 'object' && e !== null && 'code' in e) {
    return (e as { code: unknown }).code === 'ENOENT';
  }
  return false;
}

function isAlreadyExistsError(e: unknown): boolean {
  if (typeof e === 'object' && e !== null && 'code' in e) {
    return (e as { code: unknown }).code === 'EEXIST';
  }
  return false;
}

/**
 * 创建文件 token 存储 (与 Go NewFileTokenStore 等价)
 * @param path 自定义路径; 空则使用默认 ~/.acosmi/tokens.json
 */
export function newFileTokenStore(path?: string): FileTokenStore {
  return new FileTokenStore(path);
}

// ============================================================================
// LocalStorageTokenStore — Browser 实现
// ============================================================================

/**
 * 基于 LocalStorage 的 token 存储 (浏览器)
 *
 * 仅在浏览器环境可用 (检测 globalThis.localStorage)。
 * 不持久化跨设备同步, 适合单机 SPA 使用。
 */
export class LocalStorageTokenStore implements TokenStore {
  private key: string;

  constructor(key = 'acosmi.tokens') {
    if (typeof globalThis.localStorage === 'undefined') {
      throw new Error('LocalStorageTokenStore requires browser environment');
    }
    this.key = key;
  }

  async save(tokens: TokenSet): Promise<void> {
    globalThis.localStorage.setItem(this.key, JSON.stringify(tokens));
  }

  async load(): Promise<TokenSet | null> {
    const data = globalThis.localStorage.getItem(this.key);
    if (data == null || data === '') return null;
    try {
      return JSON.parse(data) as TokenSet;
    } catch {
      return null;
    }
  }

  async clear(): Promise<void> {
    globalThis.localStorage.removeItem(this.key);
  }
}

// ============================================================================
// InMemoryTokenStore — 兜底实现 (不持久化)
// ============================================================================

/**
 * 内存 token 存储 (不持久化, 进程重启即丢失)
 * 适合: 测试 / Deno script / 短期 SDK 调用 / 不希望落盘的安全场景
 */
export class InMemoryTokenStore implements TokenStore {
  private tokens: TokenSet | null = null;

  async save(tokens: TokenSet): Promise<void> {
    this.tokens = tokens;
  }

  async load(): Promise<TokenSet | null> {
    return this.tokens;
  }

  async clear(): Promise<void> {
    this.tokens = null;
  }
}
