// client/agent-runs.ts — SDK-facing Agent Run Gateway client.

import type { APIResponse } from '../shared/api-response';
import { apiResponseBusinessError } from '../shared/api-response';
import { Client, DEFAULT_API_TIMEOUT_MS } from '../core/client';
import {
  iterSSELines,
  maxDownloadSize,
  maxErrorBodySize,
  parseHTTPErrorWithHeader,
  readLimited,
} from '../core/http';
import {
  AgentRunStreamError,
  type AgentRun,
  type AgentRunArtifact,
  type AgentRunCreateRequest,
  type AgentRunCreateResponse,
  type AgentRunDownload,
  type AgentRunErrorPayload,
  type AgentRunListOptions,
  type AgentRunListResult,
  type AgentRunLocalToolHandler,
  type AgentRunLocalToolResult,
  type AgentRunRemoteCreateRequest,
  type AgentRunRunOptions,
  type AgentRunStatus,
  type AgentRunStreamEvent,
  type AgentRunStreamOptions,
  type AgentRunWithLocalToolsOptions,
} from './types';
import {
  isTerminalRemoteEvent,
  parseRemoteControlEvent,
  type AdapterKind,
  type PermissionPolicy,
  type RemoteControlEvent,
  type RemotePermissionResultRequest,
  type RemoteSessionTokenGrant,
  type RemoteUserMessageAck,
  type RemoteUserMessageRequest,
  type RunnerKind,
  type WorkspacePolicy,
} from './remote-control';

declare module '@acosmi/sdk-ts' {
  interface Client {
    /** SDK-facing cloud agent run gateway. */
    readonly agentRuns: AgentRunsClient;
  }
}

const agentRunsByClient = new WeakMap<Client, AgentRunsClient>();

Object.defineProperty(Client.prototype, 'agentRuns', {
  configurable: true,
  enumerable: false,
  get(this: Client): AgentRunsClient {
    let existing = agentRunsByClient.get(this);
    if (!existing) {
      existing = new AgentRunsClient(this);
      agentRunsByClient.set(this, existing);
    }
    return existing;
  },
});

export class AgentRunsClient {
  constructor(private readonly client: Client) {}

  async create(
    req: AgentRunCreateRequest,
    signal?: AbortSignal,
  ): Promise<AgentRunCreateResponse> {
    const resp = await this.requestAPI<WireAgentRunCreateResponse>(
      'POST',
      '/agent-runs',
      toWireCreateRequest(req),
      signal,
      { retryOn401: false },
    );
    return fromWireCreateResponse(resp);
  }

  /**
   * List the caller's own agent runs, newest first (GET /agent-runs, Phase 5C
   * console). Returns view metadata only — never session tokens, policies or
   * messages (contract §6). Filter remote-control runs with
   * `{ runtime: 'crabcode_remote' }`.
   */
  async list(
    opts: AgentRunListOptions = {},
    signal?: AbortSignal,
  ): Promise<AgentRunListResult> {
    const params = new URLSearchParams();
    if (opts.runtime) params.set('runtime', opts.runtime);
    if (opts.status) params.set('status', opts.status);
    if (opts.page != null) params.set('page', String(opts.page));
    if (opts.pageSize != null) params.set('page_size', String(opts.pageSize));
    const qs = params.toString();
    const resp = await this.requestAPI<WireAgentRunListResult>(
      'GET',
      `/agent-runs${qs ? `?${qs}` : ''}`,
      null,
      signal,
      { retryOn401: true },
    );
    return {
      records: (resp.records ?? []).map(fromWireRun),
      total: typeof resp.total === 'number' ? resp.total : 0,
      page: typeof resp.page === 'number' ? resp.page : 1,
      pageSize: typeof resp.pageSize === 'number' ? resp.pageSize : 20,
    };
  }

  get(runId: string, signal?: AbortSignal): Promise<AgentRun> {
    return this.requestAPI<WireAgentRun>(
      'GET',
      `/agent-runs/${encodeURIComponent(runId)}`,
      null,
      signal,
      { retryOn401: true },
    ).then(fromWireRun);
  }

  stream(
    runId: string,
    opts: AgentRunStreamOptions = {},
    signal?: AbortSignal,
  ): AsyncIterable<AgentRunStreamEvent> {
    return {
      [Symbol.asyncIterator]: () => this.streamGen(runId, opts, signal),
    };
  }

  cancel(runId: string, signal?: AbortSignal): Promise<AgentRun> {
    return this.requestAPI<WireAgentRun>(
      'POST',
      `/agent-runs/${encodeURIComponent(runId)}/cancel`,
      {},
      signal,
      { retryOn401: false },
    ).then(fromWireRun);
  }

  /**
   * Create a CrabCode remote-control agent run (contract §3, ADR-2 + ADR-5).
   *
   * Equivalent to `create()` with `runtime: 'crabcode_remote'` and the required
   * `runner` + `adapter` fields set. Per-session policies (permission/workspace)
   * are forwarded to the gateway, which is the only side allowed to enforce
   * them (contract §6). The SDK never enforces remote permissions client-side.
   *
   * The corresponding stream uses `streamRemoteControl(runId)`, NOT `stream()`,
   * because the event union is different (contract §4).
   */
  async createRemoteRun(
    req: AgentRunRemoteCreateRequest,
    signal?: AbortSignal,
  ): Promise<AgentRunCreateResponse> {
    if (req.runtime !== 'crabcode_remote') {
      throw new Error('createRemoteRun: runtime must be "crabcode_remote"');
    }
    if (!req.runner) throw new Error('createRemoteRun: runner is required');
    if (!req.adapter) throw new Error('createRemoteRun: adapter is required');
    return this.create(req, signal);
  }

  /**
   * Stream remote-control events for a CrabCode remote run (contract §4).
   *
   * Yields the canonical 11-event union: text_delta / reasoning_delta /
   * tool_call / tool_result / permission_request / permission_result /
   * usage / settle / status / error / done.
   *
   * Iteration ends naturally when a terminal event (`done` or `settle`) is
   * observed. Per contract §4, `error` alone is non-terminal — terminal errors
   * are carried by `done.reason` / `done.final_status`.
   *
   * Unknown event types and malformed frames are silently skipped (warn-only),
   * matching `parseRemoteControlEvent`'s null-return contract.
   */
  streamRemoteControl(
    runId: string,
    signal?: AbortSignal,
  ): AsyncIterable<RemoteControlEvent> {
    return {
      [Symbol.asyncIterator]: () => this.streamRemoteControlGen(runId, signal),
    };
  }

  /**
   * Submit a permission decision for a pending `permission_request` event
   * (POST /agent-runs/:runId/permission-results, contract §4/§9/§14).
   *
   * Only `approved` | `rejected` may be submitted by clients — `timeout` /
   * `cancelled` are produced server-side. Requires an OAuth token with the
   * explicit `remote_control` scope (or a web JWT). 409 means the remote
   * session is gone (e.g. already terminated).
   */
  async submitPermissionResult(
    runId: string,
    result: RemotePermissionResultRequest,
    signal?: AbortSignal,
  ): Promise<void> {
    await this.requestAPI<{ ok?: boolean }>(
      'POST',
      `/agent-runs/${encodeURIComponent(runId)}/permission-results`,
      {
        request_id: result.requestId,
        decision: result.decision,
        reason: result.reason,
      },
      signal,
      { retryOn401: false },
    );
  }

  /**
   * Append a mid-session user message to a remote run
   * (POST /agent-runs/:runId/messages, Phase 5C). The message role is
   * hard-coded to 'user' server-side (contract §6 #5 prompt-injection
   * defence); content is limited to 64KB. Requires the explicit
   * `remote_control` scope (or a web JWT).
   */
  async submitUserMessage(
    runId: string,
    message: RemoteUserMessageRequest,
    signal?: AbortSignal,
  ): Promise<RemoteUserMessageAck> {
    const resp = await this.requestAPI<{ ok?: boolean; request_id?: string }>(
      'POST',
      `/agent-runs/${encodeURIComponent(runId)}/messages`,
      { request_id: message.requestId, content: message.content },
      signal,
      { retryOn401: false },
    );
    return {
      ok: resp?.ok === true,
      requestId: resp?.request_id ?? message.requestId ?? '',
    };
  }

  /**
   * Reveal the one-shot remote session token for a desktop-runner run
   * (POST /agent-runs/:runId/remote-token, Phase 5B; contract §18.1).
   *
   * Desktop launcher only: the token is single-consumption (a second call
   * returns 409) and must never touch browser storage — receive it in the
   * native layer and inject it into the CrabCode child-process env only
   * (contract §6). Cloud / local_embedded runners never expose tokens over
   * HTTP (403). Requires the explicit `remote_control` scope.
   */
  async revealRemoteToken(
    runId: string,
    signal?: AbortSignal,
  ): Promise<RemoteSessionTokenGrant> {
    const resp = await this.requestAPI<WireRemoteSessionTokenGrant>(
      'POST',
      `/agent-runs/${encodeURIComponent(runId)}/remote-token`,
      {},
      signal,
      { retryOn401: false },
    );
    return {
      accessToken: resp?.access_token ?? '',
      sessionUrl: resp?.session_url ?? '',
      tenantId: resp?.tenant_id ?? '',
      workspace: resp?.workspace || undefined,
    };
  }

  private async *streamRemoteControlGen(
    runId: string,
    signal?: AbortSignal,
  ): AsyncGenerator<RemoteControlEvent, void, void> {
    const resp = await this.requestRaw(
      'GET',
      `/agent-runs/${encodeURIComponent(runId)}/stream`,
      null,
      signal,
      { retryOn401: true, accept: 'text/event-stream' },
    );
    if (!resp.body) {
      throw new Error('remote-control stream: empty response body');
    }
    for await (const rawEvent of readAgentRunSSEFrames(resp.body)) {
      const ev = parseRemoteControlEvent(rawEvent);
      if (!ev) continue;
      yield ev;
      if (isTerminalRemoteEvent(ev)) return;
    }
  }

  listArtifacts(runId: string, signal?: AbortSignal): Promise<AgentRunArtifact[]> {
    return this.requestAPI<WireAgentRunArtifactList>(
      'GET',
      `/agent-runs/${encodeURIComponent(runId)}/artifacts`,
      null,
      signal,
      { retryOn401: true },
    ).then((r) => (r.artifacts ?? []).map(fromWireArtifact));
  }

  async downloadArtifact(
    runId: string,
    artifactId: string,
    signal?: AbortSignal,
  ): Promise<AgentRunDownload> {
    const resp = await this.requestRaw(
      'GET',
      `/agent-runs/${encodeURIComponent(runId)}/artifacts/${encodeURIComponent(artifactId)}`,
      null,
      signal,
      { retryOn401: true },
    );
    const contentType = resp.headers.get('Content-Type') ?? undefined;
    const filename = filenameFromContentDisposition(resp.headers.get('Content-Disposition')) ?? artifactId;
    // 多读 1 字节探测超限 — 与 skills.downloadSkill 一致, 拒绝静默截断 (否则下游拿到
    // 被砍断的不完整产物却毫无感知)。
    const data = await readLimited(resp.body!, maxDownloadSize + 1);
    if (data.byteLength > maxDownloadSize) {
      throw new Error(`download artifact: response exceeds ${maxDownloadSize >> 20}MB limit`);
    }
    return { data, filename, contentType };
  }

  submitLocalToolResult(
    runId: string,
    result: AgentRunLocalToolResult,
    signal?: AbortSignal,
  ): Promise<AgentRun> {
    return this.requestAPI<WireAgentRun>(
      'POST',
      `/agent-runs/${encodeURIComponent(runId)}/local-tool-results`,
      toWireLocalToolResult(result),
      signal,
      { retryOn401: false },
    ).then(fromWireRun);
  }

  run(
    req: AgentRunCreateRequest,
    opts: AgentRunRunOptions = {},
    signal?: AbortSignal,
  ): AsyncIterable<AgentRunStreamEvent> {
    return {
      [Symbol.asyncIterator]: () => this.runGen(req, opts, signal),
    };
  }

  runWithLocalTools(
    req: AgentRunCreateRequest,
    handlers: Record<string, AgentRunLocalToolHandler>,
    opts: AgentRunWithLocalToolsOptions = {},
    signal?: AbortSignal,
  ): AsyncIterable<AgentRunStreamEvent> {
    return {
      [Symbol.asyncIterator]: () => this.runWithLocalToolsGen(req, handlers, opts, signal),
    };
  }

  private async *runGen(
    req: AgentRunCreateRequest,
    opts: AgentRunRunOptions,
    signal?: AbortSignal,
  ): AsyncGenerator<AgentRunStreamEvent, void, void> {
    const created = await this.create(req, signal);
    yield* this.stream(created.runId, opts, signal);
  }

  private async *runWithLocalToolsGen(
    req: AgentRunCreateRequest,
    handlers: Record<string, AgentRunLocalToolHandler>,
    opts: AgentRunWithLocalToolsOptions,
    signal?: AbortSignal,
  ): AsyncGenerator<AgentRunStreamEvent, void, void> {
    let currentRunId = '';
    for await (const event of this.run(req, opts, signal)) {
      if (event.type === 'run_started') {
        currentRunId = event.runId;
      }

      if (opts.onEvent) await opts.onEvent(event);

      let localToolTask: Promise<void> | undefined;
      if (event.type === 'local_tool_request') {
        if (currentRunId === '') {
          throw new Error('local tool request arrived before run_started');
        }
        localToolTask = this.invokeLocalTool(currentRunId, event, handlers, opts.timeoutMs, signal).then(async (result) => {
          await this.submitLocalToolResult(currentRunId, result, signal);
        });
      }

      yield event;
      if (localToolTask) await localToolTask;
    }
  }

  private async invokeLocalTool(
    runId: string,
    event: Extract<AgentRunStreamEvent, { type: 'local_tool_request' }>,
    handlers: Record<string, AgentRunLocalToolHandler>,
    timeoutMs = 30_000,
    signal?: AbortSignal,
  ): Promise<AgentRunLocalToolResult> {
    const handler = handlers[event.name];
    if (!handler) {
      return {
        requestId: event.requestId,
        ok: false,
        error: `local tool rejected: no handler for ${event.name}`,
      };
    }

    const ctl = new AbortController();
    let parentAbort: (() => void) | undefined;
    if (signal) {
      if (signal.aborted) ctl.abort();
      else {
        parentAbort = () => ctl.abort();
        signal.addEventListener('abort', parentAbort);
      }
    }

    // 硬超时根因修复: 即使 handler 完全忽略 ctx.signal (不响应协作式取消) 也不会永挂。
    // Promise.race 一边跑 handler, 一边跑一个在 timeoutMs 后 resolve 为稳定失败结果的
    // promise; 超时方胜出即立刻返回, 不再等 handler。ctl.signal 仍传给 handler 以便
    // 配合的实现尽早收手。
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeoutResult: Promise<AgentRunLocalToolResult> = new Promise((resolve) => {
      timer = setTimeout(() => {
        ctl.abort(); // 协作式取消提示 (handler 若监听 signal 可尽早退出)
        resolve({
          requestId: event.requestId,
          ok: false,
          error: `local tool timed out after ${timeoutMs}ms`,
        });
      }, timeoutMs);
    });

    const handlerTask: Promise<AgentRunLocalToolResult> = (async () => {
      const content = await handler(event.input, {
        runId,
        requestId: event.requestId,
        name: event.name,
        signal: ctl.signal,
      });
      return { requestId: event.requestId, ok: true, content };
    })();
    // 超时方先胜出时, handler 后续 reject 不能逃逸成未捕获异常。
    handlerTask.catch(() => {});

    try {
      return await Promise.race([handlerTask, timeoutResult]);
    } catch (e) {
      // 仅 handler 抢先 reject 会落这里 (超时分支永不 reject)。
      if (signal?.aborted) throw e;
      const timedOut = ctl.signal.aborted;
      return {
        requestId: event.requestId,
        ok: false,
        error: timedOut ? `local tool timed out after ${timeoutMs}ms` : errorMessage(e),
      };
    } finally {
      clearTimeout(timer);
      if (parentAbort && signal) signal.removeEventListener('abort', parentAbort);
    }
  }

  private async *streamGen(
    runId: string,
    opts: AgentRunStreamOptions,
    signal?: AbortSignal,
  ): AsyncGenerator<AgentRunStreamEvent, void, void> {
    const resp = await this.requestRaw(
      'GET',
      `/agent-runs/${encodeURIComponent(runId)}/stream`,
      null,
      signal,
      { retryOn401: true, accept: 'text/event-stream' },
    );
    if (!resp.body) {
      throw new Error('agent run stream: empty response body');
    }

    for await (const event of readAgentRunEvents(resp.body)) {
      if (event.type === 'error' && opts.throwOnError !== false) {
        throw new AgentRunStreamError(event);
      }
      yield event;
    }
  }

  private async requestAPI<T>(
    method: string,
    path: string,
    body: unknown | null,
    signal: AbortSignal | undefined,
    opts: RequestOptions,
  ): Promise<T> {
    // 非流式 JSON 请求套默认超时 (调用方可经 opts.timeoutMs 覆盖)。
    // stream / download 路径直接调 requestRaw 且不带 timeoutMs, 保留长连接语义。
    const resp = await this.requestRaw(method, path, body, signal, {
      ...opts,
      timeoutMs: opts.timeoutMs ?? DEFAULT_API_TIMEOUT_MS,
    });
    const text = await resp.text();
    // 空 body 的成功响应 (HTTP 204 / 200 空体) — 不要 JSON.parse('') (抛 SyntaxError)。
    // 与 core doJSONFullInternal / compliance executeJson 一致, 空响应返回 undefined。
    if (!text) return undefined as unknown as T;
    const result = JSON.parse(text) as APIResponse<T>;
    const bizErr = apiResponseBusinessError(result);
    if (bizErr) throw bizErr;
    return result.data;
  }

  private async requestRaw(
    method: string,
    path: string,
    body: unknown | null,
    signal: AbortSignal | undefined,
    opts: RequestOptions,
    retried = false,
  ): Promise<Response> {
    // opts.timeoutMs 仅由非流式 JSON 路径 (requestAPI) 设置 — 用组合 signal (超时 + 用户 signal,
    // 任一触发都 abort) 替换裸 signal; 流式/下载路径不带 timeoutMs, signal 原样透传保留长连接。
    if (opts.timeoutMs != null && opts.timeoutMs > 0) {
      const ctl = this.client.withRequestTimeout(opts.timeoutMs, signal);
      try {
        return await this.requestRawInner(method, path, body, ctl.signal, opts, retried);
      } finally {
        ctl.dispose();
      }
    }
    return this.requestRawInner(method, path, body, signal, opts, retried);
  }

  private async requestRawInner(
    method: string,
    path: string,
    body: unknown | null,
    signal: AbortSignal | undefined,
    opts: RequestOptions,
    retried: boolean,
  ): Promise<Response> {
    const token = await this.client.ensureToken(signal);
    const url = this.client.apiURL(path);
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      Accept: opts.accept ?? 'application/json',
    };
    let bodyStr: string | undefined;
    if (body != null) {
      bodyStr = typeof body === 'string' ? body : JSON.stringify(body);
      headers['Content-Type'] = 'application/json';
    }

    const resp = await this.client.doRequest({ method, url, headers, body: bodyStr }, signal);

    if (resp.status === 401 && opts.retryOn401 && !retried) {
      try {
        await resp.body?.cancel();
      } catch {}
      await this.client.forceRefresh(signal);
      // 复用同一组合 signal (含剩余超时预算): 直接走 inner, 不再重套超时。
      return this.requestRawInner(method, path, body, signal, opts, true);
    }

    if (resp.status < 200 || resp.status >= 300) {
      const bodyBytes = resp.body ? await readLimited(resp.body, maxErrorBodySize) : new Uint8Array();
      throw parseHTTPErrorWithHeader(resp.status, bodyBytes, resp.headers);
    }
    return resp;
  }
}

interface RequestOptions {
  retryOn401: boolean;
  accept?: string;
  /** 非流式 JSON 请求的超时上限 (毫秒); 未设置 = 无超时 (流式/下载路径)。 */
  timeoutMs?: number;
}

interface WireAgentRunCreateRequest {
  app_id: string;
  mode?: string;
  session_id?: string;
  input: string;
  messages?: unknown[];
  model?: string;
  active_skill_ids?: string[];
  knowledge_base_ids?: string[];
  metadata?: Record<string, string>;
  local_context_policy?: {
    enabled?: boolean;
    readonly?: boolean;
    max_bytes?: number;
    allowed_tools?: string[];
  };
  artifact_policy?: {
    enabled?: boolean;
    max_files?: number;
  };
  // Phase 3+ remote-control wire fields (contract §3 + §6).
  runtime?: string;
  runner?: RunnerKind;
  adapter?: AdapterKind;
  permission_policy?: WirePermissionPolicy;
  workspace_policy?: WireWorkspacePolicy;
  byok_credential_ref?: string;
}

interface WirePermissionPolicy {
  shell_allowed?: boolean;
  shell_deny_list?: string[];
  network_allowed?: boolean;
  write_allowed?: boolean;
  approval_timeout_ms?: number;
  required_actors?: string[];
}

interface WireWorkspacePolicy {
  read_only?: boolean;
  allowed_paths?: string[];
  denied_paths?: string[];
  max_bytes?: number;
}

interface WireAgentRun {
  run_id?: string;
  session_id?: string;
  app_id?: string;
  mode?: string;
  status?: string;
  created_at?: string;
  started_at?: string;
  completed_at?: string;
  error?: unknown;
  metadata?: Record<string, string>;
  // 远控 view 元数据 (Phase 5C; 标准 run 缺省)。
  runtime?: string;
  runner?: string;
  adapter?: string;
}

// List 分页信封 — 外层键对齐 listConsumeRecords ({records,total,page,pageSize},
// 注意 pageSize 是 camelCase), records 内元素仍为 snake_case 的 run view。
interface WireAgentRunListResult {
  records?: WireAgentRun[];
  total?: number;
  page?: number;
  pageSize?: number;
}

interface WireRemoteSessionTokenGrant {
  access_token?: string;
  session_url?: string;
  tenant_id?: string;
  workspace?: string;
}

interface WireAgentRunCreateResponse {
  run_id?: string;
  session_id?: string;
  status?: string;
}

interface WireAgentRunArtifact {
  id?: string;
  artifact_id?: string;
  filename?: string;
  name?: string;
  content_type?: string;
  mime_type?: string;
  size?: number;
  type?: string;
  metadata?: Record<string, string>;
}

interface WireAgentRunArtifactList {
  artifacts?: WireAgentRunArtifact[];
}

function toWirePermissionPolicy(p: PermissionPolicy): WirePermissionPolicy {
  return {
    shell_allowed: p.shellAllowed,
    shell_deny_list: p.shellDenyList,
    network_allowed: p.networkAllowed,
    write_allowed: p.writeAllowed,
    approval_timeout_ms: p.approvalTimeoutMs,
    required_actors: p.requiredActors,
  };
}

function toWireWorkspacePolicy(p: WorkspacePolicy): WireWorkspacePolicy {
  return {
    read_only: p.readOnly,
    allowed_paths: p.allowedPaths,
    denied_paths: p.deniedPaths,
    max_bytes: p.maxBytes,
  };
}

function toWireCreateRequest(req: AgentRunCreateRequest): WireAgentRunCreateRequest {
  return {
    app_id: req.appId,
    mode: req.mode,
    session_id: req.sessionId,
    input: req.input,
    messages: req.messages,
    model: req.model,
    active_skill_ids: req.activeSkillIds,
    knowledge_base_ids: req.knowledgeBaseIds,
    metadata: req.metadata,
    local_context_policy: req.localContextPolicy
      ? {
          enabled: req.localContextPolicy.enabled,
          readonly: req.localContextPolicy.readonly,
          max_bytes: req.localContextPolicy.maxBytes,
          allowed_tools: req.localContextPolicy.allowedTools,
        }
      : undefined,
    runtime: req.runtime,
    runner: req.runner,
    adapter: req.adapter,
    permission_policy: req.permissionPolicy ? toWirePermissionPolicy(req.permissionPolicy) : undefined,
    workspace_policy: req.workspacePolicy ? toWireWorkspacePolicy(req.workspacePolicy) : undefined,
    byok_credential_ref: req.byokCredentialRef,
    artifact_policy: req.artifactPolicy
      ? {
          enabled: req.artifactPolicy.enabled,
          max_files: req.artifactPolicy.maxFiles,
        }
      : undefined,
  };
}

function toWireLocalToolResult(result: AgentRunLocalToolResult): Record<string, unknown> {
  return {
    request_id: result.requestId,
    ok: result.ok,
    content: result.content,
    error: result.error,
  };
}

function fromWireCreateResponse(resp: WireAgentRunCreateResponse): AgentRunCreateResponse {
  return {
    runId: resp.run_id ?? '',
    sessionId: resp.session_id ?? '',
    status: toStatus(resp.status),
  };
}

function fromWireRun(resp: WireAgentRun): AgentRun {
  return {
    runId: resp.run_id ?? '',
    sessionId: resp.session_id ?? '',
    appId: resp.app_id,
    mode: resp.mode,
    status: toStatus(resp.status),
    createdAt: resp.created_at,
    startedAt: resp.started_at,
    completedAt: resp.completed_at,
    error: normalizeError(resp.error),
    metadata: resp.metadata,
    runtime: resp.runtime,
    runner: resp.runner,
    adapter: resp.adapter,
  };
}

function fromWireArtifact(resp: WireAgentRunArtifact): AgentRunArtifact {
  return {
    id: resp.id ?? resp.artifact_id ?? '',
    filename: resp.filename ?? resp.name ?? resp.id ?? resp.artifact_id ?? 'artifact',
    contentType: resp.content_type ?? resp.mime_type,
    size: typeof resp.size === 'number' ? resp.size : undefined,
    type: resp.type,
    metadata: resp.metadata,
  };
}

/**
 * readAgentRunSSEFrames — emits raw parsed JSON payloads from the SSE body,
 * one per SSE event. Used by `streamRemoteControl` to feed
 * `parseRemoteControlEvent` (contract §4 union).
 *
 * Skips empty frames, `[DONE]` markers, comments, and JSON parse errors.
 * Returns `event_name` injected into the payload as `__event__` when the
 * payload itself does not carry a `type` field, so downstream parsers can
 * recover the SSE event name.
 */
async function* readAgentRunSSEFrames(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<Record<string, unknown>, void, void> {
  let eventName = '';
  let dataLines: string[] = [];

  const flush = (): Record<string, unknown> | null => {
    if (dataLines.length === 0) return null;
    const data = dataLines.join('\n');
    dataLines = [];
    if (data === '[DONE]') return null;
    try {
      const parsed = JSON.parse(data);
      if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
        const obj = parsed as Record<string, unknown>;
        if (!('type' in obj) && eventName) {
          obj.type = eventName;
        }
        return obj;
      }
    } catch {
      // malformed frame: skip
    }
    return null;
  };

  for await (const line of iterSSELines(body)) {
    if (line === '') {
      const frame = flush();
      eventName = '';
      if (frame) yield frame;
      continue;
    }
    if (line.startsWith(':')) continue;
    if (line.startsWith('event:')) {
      eventName = line.slice('event:'.length).trim();
      continue;
    }
    if (line.startsWith('data:')) {
      dataLines.push(line.slice('data:'.length).trimStart());
    }
  }

  const frame = flush();
  if (frame) yield frame;
}

async function* readAgentRunEvents(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<AgentRunStreamEvent, void, void> {
  let eventName = '';
  let dataLines: string[] = [];

  const flush = (): AgentRunStreamEvent | null => {
    if (dataLines.length === 0) return null;
    const data = dataLines.join('\n');
    dataLines = [];
    if (data === '[DONE]') return null;
    return parseAgentRunEvent(eventName, data);
  };

  for await (const line of iterSSELines(body)) {
    if (line === '') {
      const event = flush();
      eventName = '';
      if (event) yield event;
      continue;
    }
    if (line.startsWith(':')) continue;
    if (line.startsWith('event:')) {
      eventName = line.slice('event:'.length).trim();
      continue;
    }
    if (line.startsWith('data:')) {
      dataLines.push(line.slice('data:'.length).trimStart());
    }
  }

  const event = flush();
  if (event) yield event;
}

function parseAgentRunEvent(eventName: string, data: string): AgentRunStreamEvent {
  const payload = JSON.parse(data) as unknown;
  const obj = isRecord(payload) ? payload : { type: eventName, data: payload };
  const type = stringField(obj, 'type') || eventName;

  switch (type) {
    case 'run_started':
      return {
        type: 'run_started',
        runId: stringField(obj, 'run_id', 'runId'),
        sessionId: stringField(obj, 'session_id', 'sessionId'),
      };
    case 'status':
      return {
        type: 'status',
        status: stringField(obj, 'status'),
        message: optionalStringField(obj, 'message'),
      };
    case 'text_delta':
      return { type: 'text_delta', text: stringField(obj, 'text') };
    case 'reasoning_delta':
      return { type: 'reasoning_delta', text: stringField(obj, 'text') };
    case 'tool_call':
      return {
        type: 'tool_call',
        id: stringField(obj, 'id'),
        name: stringField(obj, 'name'),
        input: obj.input,
      };
    case 'tool_result':
      return {
        type: 'tool_result',
        id: stringField(obj, 'id'),
        name: optionalStringField(obj, 'name'),
        result: obj.result,
        error: optionalStringField(obj, 'error'),
      };
    case 'local_tool_request':
      return {
        type: 'local_tool_request',
        requestId: stringField(obj, 'request_id', 'requestId'),
        name: stringField(obj, 'name'),
        input: obj.input,
      };
    case 'artifact':
      return {
        type: 'artifact',
        artifact: fromWireArtifact((isRecord(obj.artifact) ? obj.artifact : obj) as WireAgentRunArtifact),
      };
    case 'sources':
      return { type: 'sources', sources: obj.sources };
    case 'usage':
      return {
        type: 'usage',
        usage: normalizeUsage(isRecord(obj.usage) ? obj.usage : obj),
      };
    case 'settle':
      return {
        type: 'settle',
        settlement: normalizeSettlement(isRecord(obj.settlement) ? obj.settlement : obj),
      };
    case 'error':
      return { type: 'error', error: normalizeError(obj.error) ?? normalizeError(obj)! };
    case 'done':
      return {
        type: 'done',
        runId: stringField(obj, 'run_id', 'runId'),
        status: stringField(obj, 'status'),
      };
    default:
      return {
        type: 'error',
        error: {
          code: 'unknown_event',
          message: `unknown agent run event: ${type}`,
          raw: obj,
        },
      };
  }
}

function normalizeUsage(value: Record<string, unknown>) {
  return {
    ...value,
    inputTokens: numberField(value, 'input_tokens', 'inputTokens'),
    outputTokens: numberField(value, 'output_tokens', 'outputTokens'),
    totalTokens: numberField(value, 'total_tokens', 'totalTokens'),
    cacheReadTokens: numberField(value, 'cache_read_tokens', 'cacheReadTokens'),
    cacheCreateTokens: numberField(value, 'cache_create_tokens', 'cacheCreateTokens'),
    exact: booleanField(value, 'exact'),
    source: optionalStringField(value, 'source'),
  };
}

function normalizeSettlement(value: Record<string, unknown>) {
  return {
    ...value,
    requestId: optionalStringField(value, 'request_id', 'requestId'),
    status: optionalStringField(value, 'status'),
    consumeStatus: optionalStringField(value, 'consume_status', 'consumeStatus'),
    inputTokens: numberField(value, 'input_tokens', 'inputTokens'),
    outputTokens: numberField(value, 'output_tokens', 'outputTokens'),
    totalTokens: numberField(value, 'total_tokens', 'totalTokens'),
    cacheReadTokens: numberField(value, 'cache_read_tokens', 'cacheReadTokens'),
    cacheCreateTokens: numberField(value, 'cache_create_tokens', 'cacheCreateTokens'),
    tokenRemaining: numberField(value, 'token_remaining', 'tokenRemaining'),
    callRemaining: numberField(value, 'call_remaining', 'callRemaining'),
    retryQueued: booleanField(value, 'retry_queued', 'retryQueued'),
    exact: booleanField(value, 'exact'),
  };
}

function normalizeError(value: unknown): AgentRunErrorPayload | undefined {
  if (value == null) return undefined;
  if (typeof value === 'string') return { message: value, raw: value };
  if (!isRecord(value)) return { message: String(value), raw: value };
  return {
    code: optionalStringField(value, 'code', 'error_code', 'errorCode'),
    message: stringField(value, 'message', 'error') || 'agent run failed',
    stage: optionalStringField(value, 'stage'),
    retryable: typeof value.retryable === 'boolean' ? value.retryable : undefined,
    // 窗口限额扩展 (code="window_limit_exceeded"): 契约 wire 为 camelCase, 蛇形兼容兜底。
    windowKind: optionalStringField(value, 'windowKind', 'window_kind'),
    windowResetAt: optionalStringField(value, 'windowResetAt', 'window_reset_at'),
    raw: value,
  };
}

function toStatus(status: string | undefined): AgentRunStatus {
  switch (status) {
    case 'running':
    case 'completed':
    case 'failed':
    case 'cancelled':
      return status;
    default:
      return 'queued';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

function stringField(obj: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const value = obj[key];
    if (typeof value === 'string') return value;
  }
  return '';
}

function optionalStringField(obj: Record<string, unknown>, ...keys: string[]): string | undefined {
  const value = stringField(obj, ...keys);
  return value === '' ? undefined : value;
}

function numberField(obj: Record<string, unknown>, ...keys: string[]): number | undefined {
  for (const key of keys) {
    const value = obj[key];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
  }
  return undefined;
}

function booleanField(obj: Record<string, unknown>, ...keys: string[]): boolean | undefined {
  for (const key of keys) {
    const value = obj[key];
    if (typeof value === 'boolean') return value;
  }
  return undefined;
}

function filenameFromContentDisposition(value: string | null): string | null {
  if (!value) return null;
  const utf8 = /filename\*=UTF-8''([^;]+)/i.exec(value);
  if (utf8?.[1]) {
    try {
      return decodeURIComponent(utf8[1]);
    } catch {
      return utf8[1];
    }
  }
  const plain = /filename="?([^";]+)"?/i.exec(value);
  return plain?.[1] ?? null;
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
