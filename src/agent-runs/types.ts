// Agent Runs public SDK protocol.
//
// Public TypeScript API uses camelCase. The HTTP wire protocol uses snake_case
// and is converted in client/agent-runs.ts.

import type {
  AdapterKind,
  PermissionPolicy,
  RunnerKind,
  WorkspacePolicy,
} from './remote-control';

export type AgentRunStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';

/**
 * Remote-control runtime selector (Phase 3 / contract §3).
 *   - 'standard'         existing chat/workflow path (default; backward compatible)
 *   - 'crabcode_remote'  CrabCode remote-control session; requires runner + adapter
 */
export type AgentRunRuntime = 'standard' | 'crabcode_remote';

export interface AgentRunLocalContextPolicy {
  enabled?: boolean;
  readonly?: boolean;
  maxBytes?: number;
  allowedTools?: string[];
}

export interface AgentRunArtifactPolicy {
  enabled?: boolean;
  maxFiles?: number;
}

/**
 * Run metadata 约定键 (契约 §18.3 r4, additive)。
 *
 * 服务端防滥用上限: ≤32 条 / 键 ≤64B / 值 ≤2KB (`validateAgentRunMetadata`)。
 *   - `title`     列表显示标题; 缺省由服务端从 input 首行派生 (60 rune 截断)。
 *   - `workspace` 用户声明的期望项目目录; desktop runner 经
 *     `revealRemoteToken()` 响应的 `workspace` 字段回传, 由桌面 launcher
 *     决定是否 chdir 采纳 (路径不存在/越权时回退本机当前目录并提示)。
 */
export const AGENT_RUN_META_TITLE = 'title';
export const AGENT_RUN_META_WORKSPACE = 'workspace';

export interface AgentRunCreateRequest {
  appId: string;
  mode?: string;
  sessionId?: string;
  input: string;
  messages?: unknown[];
  model?: string;
  activeSkillIds?: string[];
  knowledgeBaseIds?: string[];
  /**
   * 自由 KV 元数据。远控 run 的约定键见 {@link AGENT_RUN_META_TITLE} /
   * {@link AGENT_RUN_META_WORKSPACE} (契约 §18.3 r4)。
   */
  metadata?: Record<string, string>;
  localContextPolicy?: AgentRunLocalContextPolicy;
  artifactPolicy?: AgentRunArtifactPolicy;

  // Phase 3+ remote-control extension (contract §3 / ADR-2):
  //   When `runtime === 'crabcode_remote'`, `runner` + `adapter` are required and
  //   the per-session permission/workspace policies are sent to the gateway.
  //   Wire-format snake_case; SDK forwards even on older backends that ignore
  //   unknown fields (forward compatible by design).
  runtime?: AgentRunRuntime;
  runner?: RunnerKind;
  adapter?: AdapterKind;
  permissionPolicy?: PermissionPolicy;
  workspacePolicy?: WorkspacePolicy;
  /**
   * BYO 模型密钥公开引用 (契约 §18.2; 仅远控 runtime + runner='cloud')。
   * 只传 `crabcodeByok.create()` 返回的 credentialRef; 明文/密文绝不过此请求 —
   * 解密只发生在网关 launchCloudRunner 的子进程 env 注入点。
   */
  byokCredentialRef?: string;
}

/**
 * Narrow type for `agentRuns.createRemoteRun(req)`:
 *   - runtime is fixed to `'crabcode_remote'`;
 *   - runner + adapter are required;
 *   - inherits everything else from AgentRunCreateRequest.
 */
export interface AgentRunRemoteCreateRequest extends AgentRunCreateRequest {
  runtime: 'crabcode_remote';
  runner: RunnerKind;
  adapter: AdapterKind;
}

// 注: streamRemoteControl 不接受 options。按契约 §4, `error` 事件恒为非终结
// (终结性错误由 `done.reason` / `done.final_status` 承载), 流仅在 `done` / `settle`
// 终结事件后自然结束, 从不抛异常; 因此无需 yield/throw 开关 (此前的
// RemoteControlStreamOptions.yieldNonTerminalErrors 是从不被读取的 no-op, 已删除)。

export interface AgentRun {
  runId: string;
  sessionId: string;
  appId?: string;
  mode?: string;
  status: AgentRunStatus;
  createdAt?: string;
  startedAt?: string;
  completedAt?: string;
  error?: AgentRunErrorPayload;
  metadata?: Record<string, string>;
  // 远控元数据 (Phase 5C 控制台列表; 标准 run 为 'standard'/缺省)。
  // view 永不携带 session token / policy / messages 任何形态 (契约 §6)。
  runtime?: AgentRunRuntime | string;
  runner?: RunnerKind | string;
  adapter?: AdapterKind | string;
}

/** `agentRuns.list()` 过滤/分页参数 (GET /agent-runs, Phase 5C 控制台)。 */
export interface AgentRunListOptions {
  /** 按 runtime 过滤, 例 'crabcode_remote' (远控控制台列表)。 */
  runtime?: AgentRunRuntime | string;
  /** 按状态过滤, 例 'running'。 */
  status?: AgentRunStatus | string;
  /** 页码, 1 起; 缺省 1。 */
  page?: number;
  /** 每页条数; 缺省 20, 服务端上限 100。 */
  pageSize?: number;
}

/** `agentRuns.list()` 结果 — 分页形状对齐 listConsumeRecords ({records,total,page,pageSize})。 */
export interface AgentRunListResult {
  records: AgentRun[];
  total: number;
  page: number;
  pageSize: number;
}

export interface AgentRunCreateResponse {
  runId: string;
  sessionId: string;
  status: AgentRunStatus;
}

export interface AgentRunArtifact {
  id: string;
  filename: string;
  contentType?: string;
  size?: number;
  type?: string;
  metadata?: Record<string, string>;
}

export interface AgentRunArtifactList {
  artifacts: AgentRunArtifact[];
}

export interface AgentRunDownload {
  data: Uint8Array;
  filename: string;
  contentType?: string;
}

export interface AgentRunUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  cacheReadTokens?: number;
  cacheCreateTokens?: number;
  exact?: boolean;
  source?: string;
  [key: string]: unknown;
}

export interface AgentRunSettlement {
  requestId?: string;
  status?: string;
  consumeStatus?: string;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  cacheReadTokens?: number;
  cacheCreateTokens?: number;
  tokenRemaining?: number;
  callRemaining?: number;
  retryQueued?: boolean;
  exact?: boolean;
  [key: string]: unknown;
}

export interface AgentRunErrorPayload {
  code?: string;
  message: string;
  stage?: string;
  retryable?: boolean;
  raw?: unknown;
}

export interface AgentRunLocalToolResult {
  requestId: string;
  ok: boolean;
  content?: unknown;
  error?: string;
}

export interface AgentRunLocalToolHandlerContext {
  runId: string;
  requestId: string;
  name: string;
  signal: AbortSignal;
}

export type AgentRunLocalToolHandler = (
  input: unknown,
  context: AgentRunLocalToolHandlerContext,
) => Promise<unknown> | unknown;

export interface AgentRunStreamOptions {
  /**
   * true by default. When enabled, an error event is converted into
   * AgentRunStreamError after the event has been parsed.
   */
  throwOnError?: boolean;
}

export interface AgentRunRunOptions extends AgentRunStreamOptions {}

export interface AgentRunWithLocalToolsOptions extends AgentRunRunOptions {
  timeoutMs?: number;
  onEvent?: (event: AgentRunStreamEvent) => void | Promise<void>;
}

export type AgentRunStreamEvent =
  | { type: 'run_started'; runId: string; sessionId: string }
  | { type: 'status'; status: AgentRunStatus | string; message?: string }
  | { type: 'text_delta'; text: string }
  | { type: 'reasoning_delta'; text: string }
  | { type: 'tool_call'; id: string; name: string; input?: unknown }
  | { type: 'tool_result'; id: string; name?: string; result?: unknown; error?: string }
  | { type: 'local_tool_request'; requestId: string; name: string; input: unknown }
  | { type: 'artifact'; artifact: AgentRunArtifact }
  | { type: 'sources'; sources: unknown }
  | { type: 'usage'; usage: AgentRunUsage }
  | { type: 'settle'; settlement: AgentRunSettlement }
  | { type: 'error'; error: AgentRunErrorPayload }
  | { type: 'done'; runId: string; status: AgentRunStatus | string };

export class AgentRunStreamError extends Error {
  event: Extract<AgentRunStreamEvent, { type: 'error' }>;
  code: string;
  stage: string;
  retryable: boolean;

  constructor(event: Extract<AgentRunStreamEvent, { type: 'error' }>) {
    const err = event.error;
    super(err.stage ? `agent run failed: ${err.stage}: ${err.message}` : `agent run failed: ${err.message}`);
    this.name = 'AgentRunStreamError';
    this.event = event;
    this.code = err.code ?? '';
    this.stage = err.stage ?? '';
    this.retryable = err.retryable ?? false;
  }
}
