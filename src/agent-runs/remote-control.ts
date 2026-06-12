// Acosmi 远程控制 CrabCode 多接入面 — SDK 类型契约 (Phase 3 骨架).
//
// 契约源: docs/audit/sdk-remote-control-contract-2026-05-27.md §3-§4 (Phase 0 frozen).
//
// 设计纪律:
//   - HTTP wire 协议字段为 snake_case (与 Nexus Go side 一致);
//   - 公开 TypeScript API 一律 camelCase;
//   - `parseRemoteControlEvent` 负责 wire -> TS 翻译, 不识别的 type 返回 null;
//   - 11 个 event type 严格对齐契约 §4, 任何新增需先改契约文档再扩本文件;
//   - 严禁复用旧 chat SSE 名 (intent_confirmation / on_session_reset / sources /
//     reasoning_clear / plan_*); 它们在远控 stream 不再存在 (契约 §4 末)。

// =============================================================================
// AdapterKind / RunnerKind (契约 §3 placement 矩阵)
// =============================================================================

export type AdapterKind =
  | 'remote_io'
  | 'app_server_tcp_ws'
  | 'bridge_ccr'
  | 'app_server_uds'
  | 'stdio_stream_json'
  | 'tauri_managed_app_server';

export type RunnerKind = 'cloud' | 'desktop' | 'local_embedded';

// =============================================================================
// Workspace / Permission Policy (与 Go side 字段名一致)
// =============================================================================

export interface WorkspacePolicy {
  readOnly?: boolean;
  allowedPaths?: string[];
  deniedPaths?: string[];
  maxBytes?: number;
}

export interface PermissionPolicy {
  shellAllowed?: boolean;
  shellDenyList?: string[];
  networkAllowed?: boolean;
  writeAllowed?: boolean;
  approvalTimeoutMs?: number;
  requiredActors?: string[];
}

// =============================================================================
// Placement / Ref
// =============================================================================

export interface RemoteSessionPlacement {
  tenantId: string;
  userId: string;
  appId: string;
  runId: string;
  runner: RunnerKind;
  adapter: AdapterKind;
  ttlMs?: number;
  workspace?: WorkspacePolicy;
  permission?: PermissionPolicy;
}

export interface RemoteSessionRef {
  sessionId: string;
  runId: string;
  tenantId: string;
  userId: string;
  adapter: AdapterKind;
  createdAt?: string;
  expiresAt?: string;
}

// =============================================================================
// Event union (契约 §4 — 11 种事件, 严禁扩展)
// =============================================================================

export type RemoteControlEventType =
  | 'text_delta'
  | 'reasoning_delta'
  | 'tool_call'
  | 'tool_result'
  | 'permission_request'
  | 'permission_result'
  | 'usage'
  | 'settle'
  | 'status'
  | 'error'
  | 'done';

export interface RemoteControlTextDelta {
  type: 'text_delta';
  index: number;
  text: string;
}

export interface RemoteControlReasoningDelta {
  type: 'reasoning_delta';
  index: number;
  text: string;
}

export interface RemoteControlToolCall {
  type: 'tool_call';
  toolCallId: string;
  name: string;
  input?: unknown;
  source?: string;
}

export interface RemoteControlToolResult {
  type: 'tool_result';
  toolCallId: string;
  ok: boolean;
  output?: unknown;
  error?: string;
}

export interface RemoteControlPermissionRequest {
  type: 'permission_request';
  requestId: string;
  kind: string;
  payload?: unknown;
  deadlineMs?: number;
}

export interface RemoteControlPermissionResult {
  type: 'permission_result';
  requestId: string;
  decision: 'allow' | 'deny' | string;
  actor?: string;
  decidedAt?: string;
}

export interface RemoteControlUsage {
  type: 'usage';
  inputTokens?: number;
  outputTokens?: number;
  cacheRead?: number;
  cacheCreate?: number;
  exact?: boolean;
}

export interface RemoteControlSettle {
  type: 'settle';
  status: string;
  billed?: boolean;
}

export interface RemoteControlStatus {
  type: 'status';
  phase:
    | 'created'
    | 'connecting'
    | 'connected'
    | 'running'
    | 'cancelling'
    | 'terminating'
    | string;
  message?: string;
}

export interface RemoteControlError {
  type: 'error';
  code: string;
  message: string;
  retryable?: boolean;
  kind?: string;
}

export interface RemoteControlDone {
  type: 'done';
  reason: string;
  runId: string;
  finalStatus: string;
}

export type RemoteControlEvent =
  | RemoteControlTextDelta
  | RemoteControlReasoningDelta
  | RemoteControlToolCall
  | RemoteControlToolResult
  | RemoteControlPermissionRequest
  | RemoteControlPermissionResult
  | RemoteControlUsage
  | RemoteControlSettle
  | RemoteControlStatus
  | RemoteControlError
  | RemoteControlDone;

// =============================================================================
// Wire -> TS 解析
// =============================================================================

type WireRecord = Record<string, unknown>;

function asRecord(v: unknown): WireRecord | null {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return null;
  return v as WireRecord;
}

function str(rec: WireRecord, key: string): string | undefined {
  const v = rec[key];
  return typeof v === 'string' ? v : undefined;
}

function num(rec: WireRecord, key: string): number | undefined {
  const v = rec[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

function bool(rec: WireRecord, key: string): boolean | undefined {
  const v = rec[key];
  return typeof v === 'boolean' ? v : undefined;
}

/**
 * 把后端 SSE/JSON wire payload 翻译成强类型 RemoteControlEvent。
 *
 * - wire 字段 snake_case (text_delta / tool_call_id / permission_request ...);
 * - TS API 字段 camelCase (toolCallId / requestId ...);
 * - 未知 type / 缺失关键字段返回 null, 调用方应当忽略并打 warn;
 * - 不抛异常: 一律返回 null。
 */
export function parseRemoteControlEvent(raw: unknown): RemoteControlEvent | null {
  const rec = asRecord(raw);
  if (!rec) return null;
  const type = str(rec, 'type');
  if (!type) return null;

  switch (type as RemoteControlEventType) {
    case 'text_delta': {
      const index = num(rec, 'index');
      const text = str(rec, 'text');
      if (typeof index !== 'number' || typeof text !== 'string') return null;
      return { type: 'text_delta', index, text };
    }
    case 'reasoning_delta': {
      const index = num(rec, 'index');
      const text = str(rec, 'text');
      if (typeof index !== 'number' || typeof text !== 'string') return null;
      return { type: 'reasoning_delta', index, text };
    }
    case 'tool_call': {
      const toolCallId = str(rec, 'tool_call_id') ?? str(rec, 'toolCallId');
      const name = str(rec, 'name');
      if (!toolCallId || !name) return null;
      return {
        type: 'tool_call',
        toolCallId,
        name,
        input: rec['input'],
        source: str(rec, 'source'),
      };
    }
    case 'tool_result': {
      const toolCallId = str(rec, 'tool_call_id') ?? str(rec, 'toolCallId');
      const ok = bool(rec, 'ok');
      if (!toolCallId || typeof ok !== 'boolean') return null;
      return {
        type: 'tool_result',
        toolCallId,
        ok,
        output: rec['output'],
        error: str(rec, 'error'),
      };
    }
    case 'permission_request': {
      const requestId = str(rec, 'request_id') ?? str(rec, 'requestId');
      const kind = str(rec, 'kind');
      if (!requestId || !kind) return null;
      return {
        type: 'permission_request',
        requestId,
        kind,
        payload: rec['payload'],
        deadlineMs: num(rec, 'deadline_ms') ?? num(rec, 'deadlineMs'),
      };
    }
    case 'permission_result': {
      const requestId = str(rec, 'request_id') ?? str(rec, 'requestId');
      const decision = str(rec, 'decision');
      if (!requestId || !decision) return null;
      return {
        type: 'permission_result',
        requestId,
        decision,
        actor: str(rec, 'actor'),
        decidedAt: str(rec, 'decided_at') ?? str(rec, 'decidedAt'),
      };
    }
    case 'usage': {
      return {
        type: 'usage',
        inputTokens: num(rec, 'input_tokens') ?? num(rec, 'inputTokens'),
        outputTokens: num(rec, 'output_tokens') ?? num(rec, 'outputTokens'),
        cacheRead: num(rec, 'cache_read') ?? num(rec, 'cacheRead'),
        cacheCreate: num(rec, 'cache_create') ?? num(rec, 'cacheCreate'),
        exact: bool(rec, 'exact'),
      };
    }
    case 'settle': {
      const status = str(rec, 'status');
      if (!status) return null;
      return { type: 'settle', status, billed: bool(rec, 'billed') };
    }
    case 'status': {
      const phase = str(rec, 'phase');
      if (!phase) return null;
      return { type: 'status', phase, message: str(rec, 'message') };
    }
    case 'error': {
      const code = str(rec, 'code');
      const message = str(rec, 'message');
      if (!code || !message) return null;
      return {
        type: 'error',
        code,
        message,
        retryable: bool(rec, 'retryable'),
        kind: str(rec, 'kind'),
      };
    }
    case 'done': {
      const reason = str(rec, 'reason');
      const runId = str(rec, 'run_id') ?? str(rec, 'runId');
      const finalStatus = str(rec, 'final_status') ?? str(rec, 'finalStatus');
      if (!reason || !runId || !finalStatus) return null;
      return { type: 'done', reason, runId, finalStatus };
    }
    default:
      return null;
  }
}

/**
 * isTerminalRemoteEvent — 仅 `done` 与 `settle` 终结一个 stream。
 *
 * 注意契约 §4 关于 error:
 *   - 终结性错误进入 `done`;
 *   - 非终结 error 不结束 stream;
 *   因此 `error` 本身不算 terminal, `done` 才是。
 */
export function isTerminalRemoteEvent(ev: RemoteControlEvent): boolean {
  return ev.type === 'done' || ev.type === 'settle';
}

// =============================================================================
// 远控管理面请求/响应类型 (契约 §18.1 附录 A; Phase 5B/5C)
// =============================================================================

/**
 * C 端/平台可下达的 permission 决策 (契约 §14)。
 *
 * 仅 `approved` | `rejected` — `timeout` / `cancelled` 由服务端 reaper/cancel
 * 路径产生, 客户端不可下达。
 */
export type RemotePermissionDecision = 'approved' | 'rejected';

/** `agentRuns.submitPermissionResult()` 请求 — 回写 permission_request 的决策。 */
export interface RemotePermissionResultRequest {
  /** 对应 permission_request 事件的 requestId。 */
  requestId: string;
  decision: RemotePermissionDecision;
  /** 可选决策理由 (透传给 CrabCode control_response)。 */
  reason?: string;
}

/** `agentRuns.submitUserMessage()` 请求 — 会话中途追加用户消息 (Phase 5C 输入框)。 */
export interface RemoteUserMessageRequest {
  /** 消息正文; 服务端上限 64KB。Role 由服务端硬编码 'user' (契约 §6 #5 防注入)。 */
  content: string;
  /** 幂等键; 缺省由服务端生成并在 ack 中返回。 */
  requestId?: string;
}

/** `agentRuns.submitUserMessage()` 确认。 */
export interface RemoteUserMessageAck {
  ok: boolean;
  /** 服务端最终采用的幂等键 (请求未带时为服务端生成值)。 */
  requestId: string;
}

/**
 * `agentRuns.revealRemoteToken()` 响应 — desktop launcher 一次性 session token
 * (Phase 5B; 仅 runner='desktop')。
 *
 * 安全红线 (契约 §6): token 一次性消费 (重复调用 409), TTL ≤ 1h; 永不落
 * 浏览器存储 (localStorage/cookie), 应由 native 层接收后只注入 CrabCode
 * 子进程 env。
 */
export interface RemoteSessionTokenGrant {
  accessToken: string;
  /** CrabCode 回连的 RemoteIO WS 完整地址 (公网 wss 基址 + run 路径 + tenant_id)。 */
  sessionUrl: string;
  tenantId: string;
  /**
   * 用户在 metadata.workspace 声明的期望项目目录 (契约 §18.3 r4); 缺省 undefined。
   * 桌面端决定是否 chdir 采纳 (路径不存在/越权时回退并提示)。
   */
  workspace?: string;
}
