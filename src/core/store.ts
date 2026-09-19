// store.ts — 端口自 acosmi-sdk-go/store.go (跨端扩展)
//
// Go 侧仅 FileTokenStore (Node 风格 ~/.acosmi/tokens.json)。
// TS 端口扩展为多端: Node File / Browser localStorage / 内存 (兜底).
//
// 接口异步化: Go 同步 IO, TS 必须 async。所有 Save/Load/Clear 返回 Promise。

import type { TokenSet } from '../auth/types';
import { isValidTokenSet } from '../auth/types';

export type CredentialState =
  | 'signed_out'
  | 'pending_identity'
  | 'ready'
  | 'refresh_reserved'
  | 'refresh_dispatched'
  | 'reauth_required'
  | 'configuration_error';

export type CredentialReason =
  | 'invalid_grant'
  | 'refresh_outcome_unknown'
  | 'migration_required'
  | 'identity_unavailable'
  | 'invalid_client'
  | 'invalid_scope'
  | 'unsupported_grant_type'
  | 'auth_contract_unsupported';

export interface CredentialAuthorityConfig {
  serverURL: string;
  issuer: string;
  oauthProfile: 'desktop';
  authContractVersion: 2;
  errorContractVersion: 1;
}

export interface CredentialPrincipal {
  issuer: string;
  subject: string;
  organizationId: string | null;
}

export interface CredentialRefreshOperation {
  operationId: string;
  sessionId: string;
  baseRevision: string;
  phase: 'reserved' | 'dispatched';
  returnState: 'ready' | 'pending_identity';
  startedAt: string;
  dispatchedAt: string | null;
  deadlineAt: string | null;
}

export interface CredentialLoginAttempt {
  attemptId: string;
  baseSessionId: string | null;
  startedAt: string;
}

export interface VerifiedCredentialIdentity {
  authSessionId: string;
  principal: CredentialPrincipal;
  displayName?: string;
  avatarUrl?: string;
  email?: string;
  imageUrl?: string;
  accountCreatedAt?: string;
  requiresPhoneBinding?: boolean;
  hasExtraUsageEnabled?: boolean;
  billingType?: string;
  subscriptionCreatedAt?: string;
  rateLimitTier?: string;
  organizationName?: string;
  verifiedAt: string;
}

export interface CredentialMutationReceipt {
  mutationId: string;
  operationId: string | null;
  resultRevision: string;
}

/** Durable authoritative snapshot. Revisions are decimal strings to avoid JS truncation. */
export interface CredentialSnapshot {
  storeInstanceId: string;
  authorityConfig: CredentialAuthorityConfig | null;
  revision: string;
  authSessionId: string | null;
  principal: CredentialPrincipal | null;
  credentialState: CredentialState;
  tokenSet: TokenSet | null;
  refreshOperation: CredentialRefreshOperation | null;
  loginAttempt: CredentialLoginAttempt | null;
  reason: CredentialReason | null;
  lastMutation: CredentialMutationReceipt | null;
  lastLoginAttemptId: string | null;
  verifiedIdentity: VerifiedCredentialIdentity | null;
}

export type CredentialRequestOwner = Pick<
  CredentialSnapshot,
  'storeInstanceId' | 'authSessionId' | 'principal'
>;

export interface CredentialCASExpected {
  storeInstanceId: string;
  revision: string;
  authSessionId: string | null;
  state: CredentialState;
  operationId: string | null;
}

export type CredentialCASResult =
  | { status: 'committed'; snapshot: CredentialSnapshot }
  | { status: 'superseded'; snapshot: CredentialSnapshot }
  | { status: 'storage_error'; error: unknown };

/** Explicit opt-in store; versioned mode never calls TokenStore.save/load/clear. */
export interface VersionedCredentialStore {
  readSnapshot(signal?: AbortSignal): Promise<CredentialSnapshot>;
  compareAndSwap(
    expected: CredentialCASExpected,
    nextState: CredentialSnapshot,
    mutationId: string,
    signal?: AbortSignal,
  ): Promise<CredentialCASResult>;
}

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
   *   - 创建失败 (EEXIST) = 别的进程持锁, stale 检测后 backoff 重试
   *   - 创建失败 (Windows 的 EPERM / EBUSY) = 前一持有者的 unlink 处于 delete-pending,
   *     同属争用; 跳过 stale 检测直接 backoff 重试 (见 catch 内注释)。EACCES 不在其中 —
   *     它是真权限错误, 立即抛
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
          } catch (e) {
            // best-effort — 释放期间被 stale-break 删除是允许的 (ENOENT, 不记)。
            // 其余原因是真失败: 锁文件留在盘上, 下一个 acquire 要一直退避到 staleMs
            // 才 break 得掉 —— 见 warnLockCleanupFailed。
            warnLockCleanupFailed('release', lockPath, e);
          }
        };
        break;
      } catch (e) {
        if (!isLockContendedError(e)) throw e;
        // Windows delete-pending 窗口 (2.19.5): 前一持有者刚 unlink, 文件已被标记删除但
        // 最后一个句柄尚未关闭, 此刻 open(...,'wx') 返回的是 EPERM (实测; EBUSY 同机理)
        // 而不是 EEXIST (NT 的 STATUS_DELETE_PENDING 被映射成 ERROR_ACCESS_DENIED)。
        // 这是**争用**, 不是致命错误 —— 修前它走 `throw e`, 于是同一把锁上的正常交接被报成
        // 永久失败。
        //
        // 这一档必须**跳过 stale 检测**: delete-pending 的文件 stat 要么直接失败、要么给出
        // 前一持有者的旧 mtime, 两种都把"正在消失的锁"误判成"崩溃残留"; 而 stat 失败那条腿
        // 是 `continue` (不过 acquireTimeoutMs 检查), 持续 EPERM 会变成不退出的忙循环。
        // 退避重试仍受 acquireTimeoutMs 上界约束。
        //
        // EACCES **不收**: 它在 Windows 上更常见的产地是锁目录只读 / 被策略拒绝这类真权限
        // 错误, 收进来等于把"立刻报 EACCES"拖成"30s 后报 acquire timeout"。非 Windows 平台
        // 这两个码一律不收, 控制流与修前逐字节相同。
        if (!isWindowsLockBusyError(e)) {
          // 锁被别的进程持有 (EEXIST — 文件确实在那儿) — stale 检测
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
            } catch (e) {
              // 别人先删了 (ENOENT), 没关系, 不记; 其余原因说明这把陈旧锁**没被清掉**,
              // 下一轮还会撞上同一个 stale 判定 —— 见 warnLockCleanupFailed。
              warnLockCleanupFailed('stale-break', lockPath, e);
            }
            continue;
          }
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

      // 1) 写 tmp + fsync 文件: 内容真正落盘 (writeFile 仅写入 page cache, 进程/机器
      //    崩溃时 rename 后可能得到 0 字节或旧内容). 注释承诺 "fsync 后 rename", 这里兑现。
      {
        const fh = await fs.open(tmp, 'w', 0o600);
        try {
          await fh.writeFile(data, { encoding: 'utf8' });
          await fh.sync(); // fsync — 文件内容 durable
        } finally {
          await fh.close();
        }
      }

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

      // 2) 对目录 fsync: 让 rename 产生的目录项 (新文件名 → inode 的绑定) durable,
      //    否则崩溃后目录项可能丢失。跨平台: Windows / 部分 FS 上对目录 open/fsync 会抛
      //    (EISDIR/EPERM/ENOTSUP), 这是平台不支持目录 fsync, 不应让 save 失败 —— 文件内容
      //    已 fsync, 目录项 durability 退化为依赖 OS, 与原 atomic rename 语义一致。
      try {
        const dirHandle = await fs.open(dir, 'r');
        try {
          await dirHandle.sync();
        } finally {
          await dirHandle.close();
        }
      } catch {
        // 平台不支持对目录 fsync — 吞掉, 不影响 save 成功。
      }
    });
  }

  load(): Promise<TokenSet | null> {
    return this.withChain(async () => {
      const fs = await import('node:fs/promises');
      const p = await this.resolvePath();
      try {
        const data = await fs.readFile(p, 'utf8');
        // 损坏 / 截断 JSON / 缺字段 / 旧版本残留 → 视为无有效 token (返回 null),
        // 不抛错: caller (Client.create) 会据此重新走 Login, 而不是整个初始化失败。
        let parsed: unknown;
        try {
          parsed = JSON.parse(data);
        } catch {
          return null;
        }
        if (!isValidTokenSet(parsed)) return null;
        return parsed;
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

/**
 * 锁文件清理失败的唯一日志点。
 *
 * `withLock` 的两个 unlink 调用点 (释放 / stale-break) 此前都是 `catch {}` —— 整段沉默。
 * 失败的后果不是立刻报错, 而是锁文件留在盘上、下一次 acquire 一直退避到 `staleMs`
 * (60 s) 才 break 得掉: 症状是「偶发卡 30~60 秒」, 而日志里一个字都没有。只读挂载 /
 * 权限收紧 / 杀毒软件占用这类真实原因都以这种形状反复发生。
 *
 * **ENOENT 刻意不记**: 锁文件这一刻已经不在盘上, 正是两个调用点都明确允许的竞态
 * (释放期间被 stale-break 删掉 / stale-break 时别人先删了)。恒响的 warn 等于没有 warn。
 *
 * 形态沿用 `client.ts` 的 `[acosmi-sdk] warning: ...` —— 本 SDK 没有日志注入面, 为这一条
 * 新开一个就是新公开 API。**行为不变**: 本函数不抛, 两个调用点的控制流一字未改, `withLock`
 * 仍然 fail-soft。
 */
function warnLockCleanupFailed(
  stage: 'release' | 'stale-break',
  lockPath: string,
  e: unknown,
): void {
  if (isNotExistError(e)) return;
  console.warn(
    `[acosmi-sdk] warning: unlink token file lock (${stage}) failed: ${lockPath}: ${e instanceof Error ? e.message : String(e)}`,
  );
}

function isNotExistError(e: unknown): boolean {
  if (typeof e === 'object' && e !== null && 'code' in e) {
    return (e as { code: unknown }).code === 'ENOENT';
  }
  return false;
}

/**
 * Windows 上 open(...,'wx') 撞 delete-pending 时的表现 (2.19.5)。
 *
 * NT 内核在 `unlink` 之后、最后一个句柄关闭之前把文件置为 STATUS_DELETE_PENDING,
 * 之后任何 open 都被拒; 本仓实测这一窗口下 libuv 给出的是 **EPERM**
 * (`EPERM: operation not permitted, open '<path>.lock'`), EBUSY 作为同机理的
 * 第二种表现一并收下 —— 恰恰**不是** EEXIST。判据只认 EEXIST 时, 同一把锁上的正常交接
 * 会被当成致命错误抛出 (实测: 5 个并发 withLock 中有 store 直接失败)。
 *
 * **EACCES 刻意不收**: 它在 Windows 上更常见的产地是"锁目录只读 / 被策略拒绝"这类真
 * 权限错误。收进来的代价是把一个立刻能看懂的失败 (open EACCES) 拖成 30 秒后一个看不懂的
 * 失败 (acquire timeout); 配置错误必须立刻报。
 *
 * **只在 win32 上收**: POSIX 的 EPERM 是真权限错误, 同理不收。
 */
function isWindowsLockBusyError(e: unknown): boolean {
  if (typeof process === 'undefined' || process.platform !== 'win32') return false;
  if (typeof e !== 'object' || e === null || !('code' in e)) return false;
  const code = (e as { code: unknown }).code;
  return code === 'EPERM' || code === 'EBUSY';
}

/** 「锁被占住了, 该退避重试」的单一判据 = EEXIST ∪ (win32 的 delete-pending 两码)。 */
function isLockContendedError(e: unknown): boolean {
  return isAlreadyExistsError(e) || isWindowsLockBusyError(e);
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
    let parsed: unknown;
    try {
      parsed = JSON.parse(data);
    } catch {
      return null;
    }
    // 与 FileTokenStore 一致: 缺字段 / 类型错 / 旧版本残留 → 当作无 token。
    if (!isValidTokenSet(parsed)) return null;
    return parsed;
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
