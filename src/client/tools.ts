// client/tools.ts — 端口自 acosmi-sdk-go/client.go (Unified Tools section)

import type { APIResponse, ToolListResponse, ToolView } from '../types';
import { Client } from '../client';

declare module '@acosmi/sdk-ts' {
  interface Client {
    /** 获取当前用户租户下的所有工具 (Skill 优先 + Plugin 兜底) */
    listTools(signal?: AbortSignal): Promise<ToolView[]>;
    /** 获取单个工具详情 */
    getTool(toolID: string, signal?: AbortSignal): Promise<ToolView>;
  }
}

Client.prototype.listTools = async function (this: Client, signal?: AbortSignal) {
  const resp = await this.doJSON<APIResponse<ToolListResponse>>('GET', '/tools', null, signal);
  return resp.data.skills;
};

Client.prototype.getTool = async function (this: Client, toolID: string, signal?: AbortSignal) {
  const resp = await this.doJSON<APIResponse<ToolView>>(
    'GET',
    `/tools/${encodeURIComponent(toolID)}`,
    null,
    signal,
  );
  return resp.data;
};
