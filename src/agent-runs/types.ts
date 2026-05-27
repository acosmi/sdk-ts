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

export interface AgentRunCreateRequest {
  appId: string;
  mode?: string;
  sessionId?: string;
  input: string;
  messages?: unknown[];
  model?: string;
  activeSkillIds?: string[];
  knowledgeBaseIds?: string[];
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

/** Options for `agentRuns.streamRemoteControl(runId)`. */
export interface RemoteControlStreamOptions {
  /**
   * true by default. When enabled and the stream emits an `error` event with
   * `final_status` set or a `done` event with terminal status, the iteration
   * ends naturally — the consumer can inspect the last event to decide retry.
   * Unlike `AgentRunStreamOptions.throwOnError`, no exception is thrown for
   * non-terminal errors (contract §4: error is non-terminal; done is terminal).
   */
  yieldNonTerminalErrors?: boolean;
}

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
