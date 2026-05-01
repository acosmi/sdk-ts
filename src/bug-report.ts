// bug-report.ts — 端口自 acosmi-sdk-go/bug_report.go (v0.17.0)
//
// V30 CrabCode CLI bug 报告端点封装:
//   - POST /api/v4/crabcode_cli_feedback  — Bearer JWT (account scope), 限流 20/h/user
//   - GET  /api/v4/crabcode/bug/:bug_id   — 公开 (无 auth), 限流 60/min/IP
//
// 设计要点:
//   - reportData 用 unknown (调用方任意 JSON 可编码对象), 后端只解析为 map 用于脱敏 + 字段抽取,
//     不做严格 schema 校验
//   - 服务端兜底脱敏 6 类正则 (anthropic-key/openai-key/github/aws/google/bearer),
//     调用方无须自行做密钥过滤
//   - 公开 GET 端点走 doPublicJSON, 无 token 也能调

import type { APIResponse } from './types';
import { Client } from './client';

/** POST /api/v4/crabcode_cli_feedback 返回体 */
export interface BugReportResult {
  /** 服务端生成的 UUID (写入 GitHub Issue body 用) */
  feedback_id: string;
  /** 公开页链接, 形如 https://<base>/chat/crabcode/bug/<uuid> */
  detail_url: string;
}

/**
 * GET /api/v4/crabcode/bug/:id 返回体 (公开 ViewModel)
 *
 * errors / transcript / extras 用 unknown[] / Record<string, unknown>:
 * 客户端 reportData schema 会随版本变, SDK 不强 typed.
 */
export interface BugView {
  id: string;
  description: string;
  platform?: string;
  terminal?: string;
  version?: string;
  messageCount: number;
  hasErrors: boolean;
  status: string;
  clientDatetime?: string;
  createdAt: string;
  errors?: unknown[];
  transcript?: unknown[];
  extras?: Record<string, unknown>;
}

declare module '@acosmi/sdk-ts' {
  interface Client {
    /**
     * 上报一份 CrabCode bug 报告.
     *
     * reportData 是任意 JSON 可编码对象, 后端只解析为 map 做脱敏 + 字段抽取.
     *
     * 错误:
     *   - HTTPError 401 — token 过期 (内部已做一次 refresh + retry, 仍 401 抛出)
     *   - HTTPError 403 type="permission_error" message 含 "Custom data retention settings"
     *     — 用户所在组织 ZDR, 拒绝收集 (调用方应提示用户走外部渠道)
     *   - HTTPError 400 type="invalid_request_error" — content 不是合法 JSON 或 reportData 编码失败
     *   - HTTPError 429 — 限流 20/h/user (retryAfter 字段含建议等待秒数)
     *   - NetworkError — 传输层错误 (timeout / EOF / unreachable)
     */
    submitBugReport(reportData: unknown, signal?: AbortSignal): Promise<BugReportResult>;

    /**
     * 取公开 ViewModel (无需 auth, 任意人凭 ID 可读).
     *
     * 用途: SSR 公开页后端 fetch / 维护者诊断 CLI / 集成测试.
     *
     * 错误:
     *   - HTTPError 404 — bug 不存在或被软删
     *   - HTTPError 429 — 限流 60/min/IP
     *   - NetworkError — 传输层错误
     */
    getBugReport(bugID: string, signal?: AbortSignal): Promise<BugView>;
  }
}

Client.prototype.submitBugReport = async function (
  this: Client,
  reportData: unknown,
  signal?: AbortSignal,
) {
  if (reportData == null) {
    throw new Error('acosmi: reportData required');
  }
  let contentStr: string;
  try {
    contentStr = JSON.stringify(reportData);
  } catch (e) {
    throw new Error(`acosmi: marshal reportData: ${e instanceof Error ? e.message : String(e)}`);
  }
  const result = await this.doJSON<APIResponse<BugReportResult>>(
    'POST',
    '/crabcode_cli_feedback',
    { content: contentStr },
    signal,
  );
  return result.data;
};

Client.prototype.getBugReport = async function (this: Client, bugID: string, signal?: AbortSignal) {
  const trimmed = bugID.trim();
  if (trimmed === '') {
    throw new Error('acosmi: bugID required');
  }
  // 公开端点 — 不强制 token (账号系统未登录 / token 过期场景下也能查)
  const resp = await this.doPublicJSON<APIResponse<BugView>>(
    'GET',
    `/crabcode/bug/${trimmed}`,
    null,
    signal,
  );
  return resp.data;
};
