// ws.ts — 端口自 acosmi-sdk-go/ws.go (308 行)
//
// WebSocket 长连接 — Client.prototype 扩展。
// 跨端: 浏览器原生 / Node 22+ 原生 / Node 18-21 + 'ws' 包 (用户自行 polyfill)
//
// Go 用 gorilla/websocket, TS 用全局 WebSocket constructor。

import type { APIResponse } from '../shared/api-response';
import type { WSEvent } from './types';
import { Client } from '../core/client';
import { maxErrorBodySize, parseHTTPErrorWithHeader, readLimited } from '../core/http';
import type { CredentialSnapshot } from '../core/store';

/** WebSocket 长连接配置 */
export interface WSConfig {
  /** 收到服务端事件回调 */
  onEvent?: (ev: WSEvent) => void;
  /** 连接建立回调 */
  onConnect?: () => void;
  /** 断线回调 */
  onDisconnect?: (err: unknown) => void;
  /** 自动订阅的主题 */
  topics?: string[];
  /** 最小重连间隔 (ms, 默认 2000) */
  reconnectMinMs?: number;
  /** 最大重连间隔 (ms, 默认 60000) */
  reconnectMaxMs?: number;
  /** 是否自动重连 (默认 true) */
  autoReconnect?: boolean;
}

interface WSStateImpl {
  conn: WebSocket | null;
  cfg: Required<WSConfig>;
  abort: AbortController;
  done: Promise<void>;
  doneResolve: () => void;
  connected: boolean;
  owner: WSOwner | null;
}

type WSOwner = Pick<CredentialSnapshot, 'storeInstanceId' | 'authSessionId' | 'principal'>;

declare module '@acosmi/sdk-ts' {
  interface Client {
    /**
     * 建立 WebSocket 长连接 — 等待首次连接成功或 abort。
     */
    connect(cfg: WSConfig, signal?: AbortSignal): Promise<void>;

    /** 优雅断开 WebSocket 连接 */
    disconnect(): Promise<void>;

    /** WebSocket 是否已连接 */
    isConnected(): boolean;
  }
}

Client.prototype.connect = async function (this: Client, cfg: WSConfig, signal?: AbortSignal) {
  // 幂等化重复 connect: 已有连接/重连 loop 时先优雅断开旧的, 否则旧 wsLoop 的后台
  // 自动重连定时器会和新连接并存 → 多个 WebSocket + 多个 setTimeout loop 泄漏 (FD + 内存)。
  // disconnect() 会 abort 旧 ws、关旧 conn、并等待旧读循环退出 (最多 5s)。
  const oldDisconnect = this.ws ? this.disconnect() : Promise.resolve();

  const noop = () => {};
  const filledCfg: Required<WSConfig> = {
    onEvent: cfg.onEvent ?? noop,
    onConnect: cfg.onConnect ?? noop,
    onDisconnect: cfg.onDisconnect ?? noop,
    topics: cfg.topics ?? [],
    reconnectMinMs: cfg.reconnectMinMs ?? 2000,
    reconnectMaxMs: cfg.reconnectMaxMs ?? 60_000,
    autoReconnect: cfg.autoReconnect ?? true,
  };

  let resolveDone!: () => void;
  const done = new Promise<void>((r) => {
    resolveDone = r;
  });

  const abort = new AbortController();
  if (signal) {
    if (signal.aborted) abort.abort();
    else signal.addEventListener('abort', () => abort.abort());
  }

  const ws: WSStateImpl = {
    conn: null,
    cfg: filledCfg,
    abort,
    done,
    doneResolve: resolveDone,
    connected: false,
    owner: null,
  };

  // Register before the first await so disconnect/replacement can cancel a
  // ticket request or handshake that has not produced a socket yet.
  this.ws = ws as unknown as Client['ws'];
  try {
    await oldDisconnect;
    await assertCurrent(this, ws);
    await wsConnectOnce(this, ws);
  } catch (error) {
    ws.abort.abort();
    if (this.ws === ws as unknown as Client['ws']) this.ws = null;
    ws.doneResolve();
    throw error;
  }

  // 后台读循环 + 自动重连
  void wsLoop(this, ws);
};

Client.prototype.disconnect = async function (this: Client) {
  const ws = this.ws as unknown as WSStateImpl | null;
  this.ws = null;
  if (!ws) return;

  ws.abort.abort();
  ws.connected = false;

  if (ws.conn) {
    try {
      ws.conn.close(1000, '');
    } catch {
      /* ignore */
    }
  }

  // 等待读循环退出 (最多 5s)
  await Promise.race([
    ws.done,
    new Promise<void>((resolve) => setTimeout(resolve, 5000)),
  ]);
};

Client.prototype.isConnected = function (this: Client) {
  const ws = this.ws as unknown as WSStateImpl | null;
  if (!ws) return false;
  return ws.connected;
};

// ============================================================================
// 内部实现
// ============================================================================

function wsURL(c: Client): string {
  const base = c.apiURL('/ws');
  return base.replace(/^http:\/\//, 'ws://').replace(/^https:\/\//, 'wss://');
}

function getWebSocketCtor(): typeof WebSocket {
  const WSCtor = (globalThis as { WebSocket?: typeof WebSocket }).WebSocket;
  if (!WSCtor) {
    throw new Error(
      'WebSocket not available — on Node ≤21 set globalThis.WebSocket = require("ws") before connect',
    );
  }
  return WSCtor;
}

function sameOwner(a: WSOwner | null, b: WSOwner | null): boolean {
  return a?.storeInstanceId === b?.storeInstanceId &&
    a?.authSessionId === b?.authSessionId &&
    a?.principal?.issuer === b?.principal?.issuer &&
    a?.principal?.subject === b?.principal?.subject &&
    a?.principal?.organizationId === b?.principal?.organizationId;
}

async function readOwner(c: Client, signal: AbortSignal): Promise<WSOwner | null> {
  if (c.credentialMode !== 'versioned') return null;
  const snapshot = await c.getCredentialSnapshot(signal);
  return { storeInstanceId: snapshot.storeInstanceId, authSessionId: snapshot.authSessionId,
    principal: snapshot.principal };
}

async function assertCurrent(c: Client, ws: WSStateImpl): Promise<void> {
  if (ws.abort.signal.aborted || c.ws !== ws as unknown as Client['ws']) throw new Error('websocket connection superseded');
  if (ws.owner !== null && !sameOwner(ws.owner, await readOwner(c, ws.abort.signal))) {
    ws.abort.abort();
    throw new Error('websocket credential owner changed');
  }
}

async function wsConnectOnce(c: Client, ws: WSStateImpl): Promise<void> {
  const observedOwner = await readOwner(c, ws.abort.signal);
  if (ws.owner === null) ws.owner = observedOwner;
  else if (!sameOwner(ws.owner, observedOwner)) throw new Error('websocket credential owner changed');
  await assertCurrent(c, ws);
  const url = wsURL(c);
  const WSCtor = getWebSocketCtor();

  // 鉴权 — 一次性 stream ticket 流程 (D7 根因修复).
  // 网关 /ws 守卫为 StreamTicketOr(...): 优先消费 ?ticket=, 回退读 Authorization
  // **请求头** (extractBearerToken), 而非旧实现假设的 ?token= query。浏览器原生
  // WebSocket 无法传自定义 header, 故旧的 ?token= 既对浏览器失效, 又把长效 JWT
  // 明文暴露在反代/网关/devtools 的 access log 里。
  //
  // 现改为: 每次 (重)连接前用已鉴权客户端 POST /ws/stream-ticket 换一张短时
  // 一次性 ticket (~30-60s TTL, 单次使用), 放入 ?ticket= query。ticket 即便落日志
  // 也已失效, 不泄露长效凭证。重连必须重新铸新 ticket (旧 ticket 已被消费/过期)。
  const token = await c.ensureToken(ws.abort.signal);
  await assertCurrent(c, ws);
  const ticketURL = c.apiURL('/ws/stream-ticket');
  await assertCurrent(c, ws);
  const ticketHTTP = await c.doRequest({ method: 'POST', url: ticketURL,
    headers: { Authorization: `Bearer ${token}` } }, ws.abort.signal);
  if (!ticketHTTP.ok) {
    const body = ticketHTTP.body ? await readLimited(ticketHTTP.body, maxErrorBodySize) : new Uint8Array();
    throw parseHTTPErrorWithHeader(ticketHTTP.status, body, ticketHTTP.headers);
  }
  const ticketResp = await ticketHTTP.json() as APIResponse<{ ticket: string; expiresIn: number }>;
  await assertCurrent(c, ws);
  const ticket = ticketResp.data.ticket;

  const u = new URL(url);
  u.searchParams.set('ticket', ticket);

  let conn: WebSocket;
  try {
    conn = new WSCtor(u.toString());
  } catch (e) {
    throw new Error(`dial: ${e instanceof Error ? e.message : String(e)}`);
  }

  // 等待 open + welcome 消息
  await new Promise<void>((resolve, reject) => {
    let opened = false;
    const handshakeTimer = setTimeout(() => {
      if (!opened) {
        try {
          conn.close();
        } catch {
          /* ignore */
        }
        reject(new Error('dial: handshake timeout'));
      }
    }, 30_000);
    const abortHandshake = () => {
      clearTimeout(handshakeTimer);
      try { conn.close(); } catch { /* ignore */ }
      reject(new Error('websocket connection aborted'));
    };
    ws.abort.signal.addEventListener('abort', abortHandshake, { once: true });

    conn.addEventListener('open', () => {
      if (ws.abort.signal.aborted || c.ws !== ws as unknown as Client['ws']) {
        try { conn.close(); } catch { /* ignore */ }
        return;
      }
      opened = true;
    });

    conn.addEventListener('error', (e: Event) => {
      clearTimeout(handshakeTimer);
      ws.abort.signal.removeEventListener('abort', abortHandshake);
      reject(new Error(`dial: ${(e as ErrorEvent).message ?? 'connection error'}`));
    });

    conn.addEventListener('message', (e: MessageEvent) => {
      // 第一条 message 应为 welcome
      try {
        const msg = e.data as string;
        const welcome = JSON.parse(msg) as WSEvent;
        if (welcome.type !== 'welcome') {
          clearTimeout(handshakeTimer);
          ws.abort.signal.removeEventListener('abort', abortHandshake);
          try {
            conn.close();
          } catch {
            /* ignore */
          }
          reject(new Error(`unexpected first message: ${welcome.type}`));
          return;
        }
        void assertCurrent(c, ws).then(() => {
        clearTimeout(handshakeTimer);
        ws.abort.signal.removeEventListener('abort', abortHandshake);
        ws.conn = conn;
        ws.connected = true;

        // 自动订阅主题
        if (ws.cfg.topics.length > 0) {
          try {
            conn.send(
              JSON.stringify({
                type: 'subscribe',
                topics: ws.cfg.topics,
              }),
            );
          } catch (sendErr) {
            ws.conn = null;
            ws.connected = false;
            try {
              conn.close();
            } catch {
              /* ignore */
            }
            reject(new Error(`send subscribe: ${sendErr instanceof Error ? sendErr.message : String(sendErr)}`));
            return;
          }
        }

        ws.cfg.onConnect();
        // eslint-disable-next-line no-console
        console.log(`[acosmi-sdk] websocket connected, connId=${welcome.connId ?? ''}`);
        resolve();
        }).catch(reject);
      } catch (parseErr) {
        clearTimeout(handshakeTimer);
        try {
          conn.close();
        } catch {
          /* ignore */
        }
        reject(new Error(`parse welcome: ${parseErr instanceof Error ? parseErr.message : String(parseErr)}`));
      }
    }, { once: true });
  });
}

async function wsLoop(c: Client, ws: WSStateImpl): Promise<void> {
  try {
    while (true) {
      // 读循环
      await wsReadLoop(c, ws);

      // 检查是否该退出
      if (ws.abort.signal.aborted) return;

      // 关闭旧连接, 防止 FD 泄漏
      if (ws.conn) {
        try {
          ws.conn.close();
        } catch {
          /* ignore */
        }
        ws.conn = null;
      }
      ws.connected = false;

      if (!ws.cfg.autoReconnect) return;

      // 自动重连 (指数退避)
      let delay = ws.cfg.reconnectMinMs;
      while (true) {
        if (ws.abort.signal.aborted) return;
        await sleepWithSignal(delay, ws.abort.signal).catch(() => {
          /* aborted */
        });
        if (ws.abort.signal.aborted) return;

        // eslint-disable-next-line no-console
        console.log(`[acosmi-sdk] websocket reconnecting (delay=${delay}ms)...`);
        try {
          await wsConnectOnce(c, ws);
          break; // 重连成功
        } catch (err) {
          // eslint-disable-next-line no-console
          console.log(`[acosmi-sdk] websocket reconnect failed: ${err instanceof Error ? err.message : String(err)}`);
          delay = Math.min(delay * 2, ws.cfg.reconnectMaxMs);
        }
      }
    }
  } finally {
    ws.doneResolve();
  }
}

async function wsReadLoop(c: Client, ws: WSStateImpl): Promise<void> {
  const conn = ws.conn;
  if (!conn) return;

  return new Promise<void>((resolve) => {
    const handleMessage = (e: MessageEvent) => {
      try {
        const data = e.data as string;
        const event = JSON.parse(data) as WSEvent;
        void assertCurrent(c, ws).then(() => {
          try { ws.cfg.onEvent(event); } catch { /* observer isolation */ }
        }).catch(() => {
          try { conn.close(); } catch { /* ignore */ }
        });
      } catch {
        // 解析失败忽略
      }
    };

    const handleClose = (e: CloseEvent) => {
      conn.removeEventListener('message', handleMessage);
      conn.removeEventListener('close', handleClose);
      conn.removeEventListener('error', handleError);
      try {
        ws.cfg.onDisconnect(new Error(`closed: code=${e.code} reason=${e.reason}`));
      } catch {
        // ignore
      }
      resolve();
    };

    const handleError = (e: Event) => {
      conn.removeEventListener('message', handleMessage);
      conn.removeEventListener('close', handleClose);
      conn.removeEventListener('error', handleError);
      try {
        ws.cfg.onDisconnect(e);
      } catch {
        // ignore
      }
      resolve();
    };

    conn.addEventListener('message', handleMessage);
    conn.addEventListener('close', handleClose);
    conn.addEventListener('error', handleError);

    if (ws.abort.signal.aborted) {
      try {
        conn.close();
      } catch {
        /* ignore */
      }
    } else {
      ws.abort.signal.addEventListener(
        'abort',
        () => {
          try {
            conn.close();
          } catch {
            /* ignore */
          }
        },
        { once: true },
      );
    }
  });
}

async function sleepWithSignal(ms: number, signal: AbortSignal): Promise<void> {
  if (ms <= 0) return;
  if (signal.aborted) throw new Error('aborted');
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => {
      signal.removeEventListener('abort', abortHandler);
      resolve();
    }, ms);
    const abortHandler = () => {
      clearTimeout(t);
      signal.removeEventListener('abort', abortHandler);
      reject(new Error('aborted'));
    };
    signal.addEventListener('abort', abortHandler);
  });
}
