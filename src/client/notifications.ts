// client/notifications.ts — 端口自 acosmi-sdk-go/client.go (Notifications section)

import type {
  APIResponse,
  DeviceRegistration,
  NotificationList,
  NotificationPreference,
  NotificationUnreadCount,
} from '../types';
import { Client } from '../client';

declare module '../client' {
  interface Client {
    /** 分页查询通知列表 */
    listNotifications(
      page: number,
      pageSize: number,
      typeFilter: string,
      signal?: AbortSignal,
    ): Promise<NotificationList>;
    /** 获取未读通知数量 */
    getUnreadCount(signal?: AbortSignal): Promise<number>;
    /** 标记单条通知已读 */
    markNotificationRead(id: string, signal?: AbortSignal): Promise<void>;
    /** 标记全部通知已读 */
    markAllNotificationsRead(signal?: AbortSignal): Promise<void>;
    /** 删除通知 */
    deleteNotification(id: string, signal?: AbortSignal): Promise<void>;
    /** 注册推送设备 token */
    registerDevice(reg: DeviceRegistration, signal?: AbortSignal): Promise<void>;
    /** 注销推送设备 token */
    unregisterDevice(token: string, signal?: AbortSignal): Promise<void>;
    /** 获取通知偏好设置 */
    listNotificationPreferences(signal?: AbortSignal): Promise<NotificationPreference[]>;
    /** 更新通知偏好 */
    updateNotificationPreference(
      typeCode: string,
      pref: NotificationPreference,
      signal?: AbortSignal,
    ): Promise<void>;
  }
}

Client.prototype.listNotifications = async function (
  this: Client,
  page: number,
  pageSize: number,
  typeFilter: string,
  signal?: AbortSignal,
) {
  let path = `/notifications?page=${page}&pageSize=${pageSize}`;
  if (typeFilter) path += `&type=${encodeURIComponent(typeFilter)}`;
  const resp = await this.doJSON<APIResponse<NotificationList>>('GET', path, null, signal);
  return resp.data;
};

Client.prototype.getUnreadCount = async function (this: Client, signal?: AbortSignal) {
  const resp = await this.doJSON<APIResponse<NotificationUnreadCount>>(
    'GET',
    '/notifications/unread-count',
    null,
    signal,
  );
  return resp.data.unreadCount;
};

Client.prototype.markNotificationRead = async function (
  this: Client,
  id: string,
  signal?: AbortSignal,
) {
  await this.doJSON<APIResponse<unknown>>(
    'PUT',
    `/notifications/${encodeURIComponent(id)}/read`,
    null,
    signal,
  );
};

Client.prototype.markAllNotificationsRead = async function (this: Client, signal?: AbortSignal) {
  await this.doJSON<APIResponse<unknown>>('PUT', '/notifications/read-all', null, signal);
};

Client.prototype.deleteNotification = async function (
  this: Client,
  id: string,
  signal?: AbortSignal,
) {
  await this.doJSON<APIResponse<unknown>>(
    'DELETE',
    `/notifications/${encodeURIComponent(id)}`,
    null,
    signal,
  );
};

Client.prototype.registerDevice = async function (
  this: Client,
  reg: DeviceRegistration,
  signal?: AbortSignal,
) {
  await this.doJSON<APIResponse<unknown>>('POST', '/devices/register', reg, signal);
};

Client.prototype.unregisterDevice = async function (
  this: Client,
  token: string,
  signal?: AbortSignal,
) {
  await this.doJSON<APIResponse<unknown>>(
    'DELETE',
    `/devices/${encodeURIComponent(token)}`,
    null,
    signal,
  );
};

Client.prototype.listNotificationPreferences = async function (this: Client, signal?: AbortSignal) {
  const resp = await this.doJSON<APIResponse<NotificationPreference[]>>(
    'GET',
    '/notification-preferences',
    null,
    signal,
  );
  return resp.data;
};

Client.prototype.updateNotificationPreference = async function (
  this: Client,
  typeCode: string,
  pref: NotificationPreference,
  signal?: AbortSignal,
) {
  await this.doJSON<APIResponse<unknown>>(
    'PUT',
    `/notification-preferences/${encodeURIComponent(typeCode)}`,
    pref,
    signal,
  );
};
