// ws.ts — 端口自 acosmi-sdk-go/ws.go (308 行)
//
// WebSocket 长连接 — Client.prototype 扩展。
// 跨端: 浏览器原生 / Node 22+ 原生 / Node 18-21 + 'ws' 包 (用户自行 polyfill)
//
// Go 用 gorilla/websocket, TS 用全局 WebSocket constructor。

import type { WSEvent } from './types';
import { Client } from './client';

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
}

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
  };

  // 首次连接 — 失败抛出
  await wsConnectOnce(this, ws);
  this.ws = ws as unknown as Client['ws'];

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

async function wsConnectOnce(c: Client, ws: WSStateImpl): Promise<void> {
  const token = await c.ensureToken(ws.abort.signal);
  const url = wsURL(c);
  const WSCtor = getWebSocketCtor();

  // 构造连接 — 浏览器 WebSocket 不支持自定义 header,
  // Authorization 改走 query string 子协议或 cookie (服务端约定).
  // Go 端 header 'Authorization: Bearer <token>'.
  // TS 跨端方案: token 放 URL query (?token=) 或 Sec-WebSocket-Protocol 子协议.
  // 此处用 query, 与 Go 端不完全等价 — 服务端需对应支持.
  // 注: Node 22+ ws 模块通常支持 options.headers; 浏览器不支持.
  const u = new URL(url);
  u.searchParams.set('token', token);

  // Node ws 包 / 浏览器 WebSocket 都支持 1 个 protocols 参数,
  // 我们额外通过 Sec-WebSocket-Protocol 携带 token (可选).
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

    conn.addEventListener('open', () => {
      opened = true;
    });

    conn.addEventListener('error', (e: Event) => {
      clearTimeout(handshakeTimer);
      reject(new Error(`dial: ${(e as ErrorEvent).message ?? 'connection error'}`));
    });

    conn.addEventListener('message', (e: MessageEvent) => {
      // 第一条 message 应为 welcome
      try {
        const msg = e.data as string;
        const welcome = JSON.parse(msg) as WSEvent;
        if (welcome.type !== 'welcome') {
          clearTimeout(handshakeTimer);
          try {
            conn.close();
          } catch {
            /* ignore */
          }
          reject(new Error(`unexpected first message: ${welcome.type}`));
          return;
        }
        clearTimeout(handshakeTimer);
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
      await wsReadLoop(ws);

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

async function wsReadLoop(ws: WSStateImpl): Promise<void> {
  const conn = ws.conn;
  if (!conn) return;

  return new Promise<void>((resolve) => {
    const handleMessage = (e: MessageEvent) => {
      try {
        const data = e.data as string;
        const event = JSON.parse(data) as WSEvent;
        try {
          ws.cfg.onEvent(event);
        } catch {
          // ignore handler 内部错误
        }
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
