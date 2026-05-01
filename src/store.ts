// store.ts — 端口自 acosmi-sdk-go/store.go (跨端扩展)
//
// Go 侧仅 FileTokenStore (Node 风格 ~/.acosmi/tokens.json)。
// TS 端口扩展为多端: Node File / Browser localStorage / 内存 (兜底).
//
// 接口异步化: Go 同步 IO, TS 必须 async。所有 Save/Load/Clear 返回 Promise。

import type { TokenSet } from './types';

/**
 * Token 持久化接口
 * 桌面智能体可自行实现 (如 macOS Keychain / Windows Credential Manager)
 *
 * 跨端约定:
 *   - Save: 写入持久化, 失败抛 Error
 *   - Load: 读取, 不存在返回 null (与 Go IsNotExist 行为一致)
 *   - Clear: 删除, 不存在不抛错 (Logout 后 Clear 不应报错, [RC-11])
 */
export interface TokenStore {
  save(tokens: TokenSet): Promise<void>;
  load(): Promise<TokenSet | null>;
  clear(): Promise<void>;
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
export class FileTokenStore implements TokenStore {
  private path: string;
  /** 简单串行化锁 (替代 Go sync.Mutex) */
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

  private withLock<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.chain.then(fn, fn);
    this.chain = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }

  save(tokens: TokenSet): Promise<void> {
    return this.withLock(async () => {
      const fs = await import('node:fs/promises');
      const path = await import('node:path');
      const p = await this.resolvePath();
      const dir = path.dirname(p);
      await fs.mkdir(dir, { recursive: true, mode: 0o700 });
      const data = JSON.stringify(tokens, null, 2);
      await fs.writeFile(p, data, { encoding: 'utf8', mode: 0o600 });
    });
  }

  load(): Promise<TokenSet | null> {
    return this.withLock(async () => {
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
    return this.withLock(async () => {
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
