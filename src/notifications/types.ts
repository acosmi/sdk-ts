// notifications/types.ts — 通知 / WebSocket 推送域类型。
//
// 端口自 acosmi-sdk-go/types.go (v0.19.0) 的 Notifications / WebSocket 类型 段。
//
// 命名约定：字段名 = Go json tag 字面量 (wire format), 不做 camelCase 重映射。

// =============================================================================
// Notifications
// =============================================================================

/** 单条通知 */
export interface Notification {
  id: string;
  title: string;
  content: string;
  /** system | billing | security | task | commission | entitlement */
  type: string;
  isRead: boolean;
  createdAt: string;
}

/** 分页通知列表 */
export interface NotificationList {
  list: Notification[];
  unreadCount: number;
  total: number;
  page: number;
  pageSize: number;
}

/** 未读通知计数 */
export interface NotificationUnreadCount {
  unreadCount: number;
}

/** 通知偏好 (按类型+渠道) */
export interface NotificationPreference {
  typeCode: string;
  channelInApp: boolean;
  channelEmail: boolean;
  channelSms: boolean;
  channelPush: boolean;
}

/** 推送设备注册 */
export interface DeviceRegistration {
  /** android | ios | harmony */
  platform: string;
  token: string;
  appVersion: string;
}

// =============================================================================
// WebSocket 类型 (forward-declared 这里, 实现在 ws.ts)
// =============================================================================

/** 服务端推送事件 */
export interface WSEvent {
  type: string;
  topic?: string;
  /** json.RawMessage in Go */
  data?: unknown;
  connId?: string;
  timestamp?: string;
  message?: string;
}

/**
 * 从 WSEvent 中解析通知
 * 返回 null 表示该事件不是系统通知
 */
export function parseNotificationEvent(ev: WSEvent): Notification | null {
  if (ev.type !== 'event' || ev.topic !== 'system') {
    return null;
  }
  if (ev.data == null) return null;
  let n: Notification;
  try {
    // ev.data 在 wire 上是 raw JSON, 但 JSON.parse 接收 string;
    // 接收方反序列化时可能已经是对象。两种形态都接住:
    if (typeof ev.data === 'string') {
      n = JSON.parse(ev.data);
    } else {
      n = ev.data as Notification;
    }
  } catch {
    return null;
  }
  if (!n.id) return null;
  return n;
}
