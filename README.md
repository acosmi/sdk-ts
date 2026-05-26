# @acosmi/sdk-ts

> Acosmi 模型网关 + Agent Run Gateway TypeScript SDK — 双格式（Anthropic + OpenAI）多端（浏览器 / Node ≥18 / Deno / Bun）

[![npm](https://img.shields.io/npm/v/%40acosmi%2Fsdk-ts.svg)](https://www.npmjs.com/package/@acosmi/sdk-ts)

## 状态

- 主实现 / 事实标准：本 TS SDK 现为 Acosmi SDK 的主力实现。Go SDK [acosmi-sdk-go](https://github.com/acosmi/acosmi-sdk-go) 已暂停维护，待 TS 稳定后再从 TS 反向翻译补齐
- 当前版本：**2.0.0**（Phase 3 复核 + 全量根治 BREAKING 升级，2026-05-25）。**Phase 3 复核**: 主仓 9 commit 闭环 20 P0 (RBAC 表达式统一 / PII 真落盘加密链 / K7 视频 webhook 幂等 / K8 OCR SSRF / K9 KYC main flow / admin 写端点错误码契约). **SDK 同步**: 新增 `casehall.getMyLawyerCredentialStatus()` + `enterprise.getMyEnterpriseKycStatus()` 律师/企业 OWNER 自查端点; `finance/types.ts` P2-016 PII 注释升级 (含 keyVersion v1/v2 payload 协议); 新建 `docs/pii-role-matrix.md` (4 角色 × 3 PII 级矩阵); admin 写端点错误码改 HTTP 状态码语义 (`200+{ok:false}` → `403/404/501`). **v1.x 历史**: 1.9.0 finance / 1.8.1 enterprise / 1.8.0 casehall / 1.7.0 csign+pricing / 1.6.0 endUserId+11min 保活. 详见 [CHANGELOG](./CHANGELOG.md).
- 测试：发布前需通过 typecheck/lint/vitest/build/packed-tarball smoke (`npm run test:pack`)
- API 参考文档：`npm run docs` 经 TypeDoc 生成到 `docs/api/`
- 包链接：[npm](https://www.npmjs.com/package/@acosmi/sdk-ts) · [GitHub Releases](https://github.com/acosmi/sdk-ts/releases)

## 安装

```sh
npm install @acosmi/sdk-ts
```

## 快速开始

```ts
import { Client, allScopes } from '@acosmi/sdk-ts';

const client = new Client({ serverURL: process.env.ACOSMI_SERVER_URL! });
await client.login('My App', allScopes());

const resp = await client.chat('claude-opus-4-7', {
  messages: [{ role: 'user', content: 'Hello' }],
  max_tokens: 1024, // ChatRequest 走 snake_case wire 字段（与上游 Go json tag 对齐）
  endUserId: 'user-abc-123', // v1.6.0+ 业务侧稳定 id, 启用上游隔离 / KV-cache / 调度策略
});
console.log(resp.content);
```

### 用户隔离 (v1.6.0+)

`ChatRequest.endUserId` — 业务侧终端用户的稳定标识, **跨 provider 通用语义**, 不绑死 DeepSeek。SDK 自动按 wire-format 注入: OpenAI 顶层 `user_id` / Anthropic `metadata.user_id`; 网关侧校验并派生后送达上游, 命中三项隔离能力 (内容安全 / KV-cache / 调度)。

**约束**: 字符集 `[a-zA-Z0-9_-]+`, 长度 ≤ 512, **禁止包含 PII** (邮箱 / 手机 / 真名等)。可用 `validateEndUserId(s)` helper 自校验。

```ts
import { validateEndUserId } from '@acosmi/sdk-ts';

const err = validateEndUserId(uid);
if (err) {
  // 处理: PII / 长度 / 字符集不合规
  throw new Error(err);
}
```

不传 `endUserId` 时网关从认证身份 HMAC-SHA256 自动派生 32 字符稳定 id, 业务无感知。流式 + 同步 + Anthropic + OpenAI 四条路径均支持。

## 双格式红线（设计核心）

SDK 同时提供 **Anthropic + OpenAI 两条 endpoint**，**等地位**，对应两个不同下游产品。

| Adapter            | 端点                                  | 用途                                |
| ------------------ | ------------------------------------- | ----------------------------------- |
| `AnthropicAdapter` | `POST /managed-models/:id/anthropic`  | Anthropic 原生格式（含 thinking 等）|
| `OpenAIAdapter`    | `POST /managed-models/:id/chat`       | OpenAI 兼容格式（DeepSeek/GLM 等）  |

路由由 `getAdapterForModel(model)` 按 ManagedModel 的 `preferred_format` / `supported_formats` 决策（wire-format 字段，snake_case 与上游 Go json tag 严格对齐；ManagedModel 上其余顶层字段如 `modelId` / `isEnabled` / `inputModalities` 走 camelCase，详见 `src/models/types.ts`）：

1. `preferred_format` 非空 → 按值（`anthropic` | `openai`）
2. `supported_formats` 含 `anthropic` → AnthropicAdapter
3. `supported_formats` 含 `openai` → OpenAIAdapter
4. 两字段均空（旧上游）→ 按 `provider` 名回落

`client.chat()` / `client.chatStream()` 内部自动调 `getAdapterForModel`，使用方无需关心。

## 多端

| 平台            | HTTP   | SSE              | WebSocket                                | TokenStore                       |
| --------------- | ------ | ---------------- | ---------------------------------------- | -------------------------------- |
| 浏览器          | fetch  | ReadableStream   | WebSocket                                | `LocalStorageTokenStore`         |
| Node ≥18        | fetch  | ReadableStream   | WebSocket（Node 22+）/ `ws`（18-21 自装）| `FileTokenStore` (~/.acosmi/)    |
| Deno / Bun      | fetch  | ReadableStream   | WebSocket                                | File                             |

构建产物：`dist/{node,browser}/` 各自 ESM + CJS + `.d.ts`，主入口约 120 KB。

## 流式

```ts
const stream = client.chatStream('claude-opus-4-7', {
  messages: [{ role: 'user', content: '写一首诗' }],
  max_tokens: 1024,
});

for await (const ev of stream) {
  if (ev.event === 'content_block_delta' && ev.data) {
    // 解析 delta 输出 token
    process.stdout.write(parseDelta(ev.data));
  }
}
```

`chatStreamWithUsage()` 返回带 usage/error/sources 标签的 AsyncIterable，便于聚合统计（详见 `src/core/client.ts`）。

## Agent Runs

`client.agentRuns` 是下游产品接入 Acosmi 云端智能体循环的正式 SDK 边界。CrabDesign、CrabCode、CrabClaw 等产品应通过这里创建、流式消费、取消、查询和下载智能体任务，不要直连 Nexus 内部 `/api/v4/chat/completions`。

服务端 Agent Run Gateway 会按认证上下文做 `tenantId + userId` 隔离，run 状态、SSE event、artifact 和 local tool result 都是 durable store；任务执行会进入 Acosmi 统一 entitlement 预扣/结算/释放链路。结算只使用 provider/ADK 透传的精确 usage；如果 provider 未返回 `exact: true` usage，服务端会释放 hold，不会使用估算 token 扣费。

```ts
import { Client, allScopes } from '@acosmi/sdk-ts';

const client = new Client({ serverURL: process.env.ACOSMI_SERVER_URL! });
await client.login('CrabDesign', allScopes());

const run = await client.agentRuns.create({
  appId: 'crabdesign',
  mode: 'design',
  sessionId: 'session-optional',
  input: 'Create a landing page mockup for a fintech dashboard',
  activeSkillIds: ['brand-system'],
  knowledgeBaseIds: ['kb-product'],
  localContextPolicy: {
    enabled: true,
    readonly: true,
    maxBytes: 128_000,
    allowedTools: ['read_file'],
  },
  artifactPolicy: { enabled: true, maxFiles: 10 },
});

for await (const event of client.agentRuns.stream(run.runId, { throwOnError: false })) {
  switch (event.type) {
    case 'text_delta':
      process.stdout.write(event.text);
      break;
    case 'reasoning_delta':
      console.debug('[reasoning]', event.text);
      break;
    case 'local_tool_request': {
      // SDK only defines the protocol. Product code owns local read-only tools.
      const content = await readReadonlyLocalContext(event.name, event.input);
      await client.agentRuns.submitLocalToolResult(run.runId, {
        requestId: event.requestId,
        ok: true,
        content,
      });
      break;
    }
    case 'artifact': {
      const file = await client.agentRuns.downloadArtifact(run.runId, event.artifact.id);
      console.log('artifact', file.filename, file.contentType, file.data.byteLength);
      break;
    }
    case 'error':
      throw new Error(event.error.message);
  }
}

await client.agentRuns.cancel(run.runId); // safe to call from UI cancel buttons
```

本地工具桥是显式 opt-in：SDK 不内置任何 CrabDesign/CrabCode 专属文件读取逻辑。`local_tool_request` 由下游处理，结果通过 `submitLocalToolResult({ requestId, ok, content | error })` 返回；拒绝、超时和取消都由下游 handler 控制。`allowedTools` 必须使用稳定的 ASCII function name，例如 `read_file`。

`stream(runId)` 支持 durable replay：断线后重新连接同一个 run，会先回放已持久化的 Agent Run SSE 事件，再继续消费运行中的事件。`usage` / `settle` 事件会暴露 `exact`、`cacheReadTokens`、`cacheCreateTokens` 等字段，便于下游展示真实结算状态。

**`AgentRunStreamEvent` 完整事件类型**（union，详见 `src/agent-runs/types.ts`；上面示例只演示了 4 种常见分支）：

| `type` | 触发 / 含义 | 关键字段 |
| --- | --- | --- |
| `run_started` | 流首事件，确认服务端已开始执行 | `runId`、`sessionId` |
| `status` | 任务粗粒度状态变化 | `status` (`queued`/`running`/`completed`/`failed`/`cancelled`)、`message?` |
| `text_delta` | 主要文本输出增量 | `text` |
| `reasoning_delta` | 推理 / 思考过程增量（debug 用，不一定向终端用户展示） | `text` |
| `tool_call` | Agent 发起内置 / 网关工具调用 | `id`、`name`、`input?` |
| `tool_result` | 内置 / 网关工具调用结果 | `id`、`name?`、`result?`、`error?` |
| `local_tool_request` | Agent 请求宿主提供本地只读工具结果，宿主须用 `submitLocalToolResult` 回填 | `requestId`、`name`、`input` |
| `artifact` | 产出文件（图片 / 代码 / 文档等）；用 `downloadArtifact(runId, artifact.id)` 下载 | `artifact: AgentRunArtifact` |
| `sources` | 网络检索 / RAG 来源信息 | `sources` |
| `usage` | provider/ADK 透传的 token usage | `usage.exact`、`inputTokens`、`outputTokens`、`totalTokens`、`cacheReadTokens`、`cacheCreateTokens` |
| `settle` | 服务端结算事件 | `settlement.status`、`tokenRemaining`、`callRemaining`、`exact`、`retryQueued` |
| `error` | 失败事件（`throwOnError:true` 默认会转 `AgentRunStreamError` 抛出） | `error.code`、`error.message`、`error.stage`、`error.retryable` |
| `done` | 流终止 | `runId`、`status` |

## 认证

### 浏览器内 / 自动 OAuth（推荐）

```ts
await client.login('My App', allScopes());     // 自动跳转浏览器完成 OAuth
const token = await client.ensureToken();      // 拿到当前有效 access token
```

### 手动 OAuth（CLI / 自定义流程）

底层 helper 适用于自管 token 的 CLI / 自定义授权 UI。**大多数场景直接用 `client.login(appName, scopes)` 即可**——它内部封装了下面全部步骤。完整可运行示例见 [`examples/auth-oauth-flow.ts`](./examples/auth-oauth-flow.ts)。

```ts
import {
  discover,           // RFC 8414 元数据发现
  register,           // RFC 7591 动态客户端注册
  authorize,          // 本地 loopback PKCE（仅 Node）
  exchangeCode,       // code + verifier → token
  refreshToken,       // 续期
  newTokenSet,        // 把 TokenResponse 包成可持久化 TokenSet
  FileTokenStore,
  allScopes,
} from '@acosmi/sdk-ts';

const meta = await discover(process.env.ACOSMI_SERVER_URL!);
const reg = await register(meta, 'My CLI');            // 不接 scopes 参数
const scopes = allScopes();

// authorize 返回 { result, verifier }，result.code + result.redirectURI 给 exchangeCode
const { result, verifier } = await authorize(meta, reg.client_id, scopes, {
  handler: (ev) => {
    if (ev.type === 'auth_url') console.log('open in browser:', ev.url);
  },
});

const tokenResp = await exchangeCode(
  meta,
  reg.client_id,
  result.code,
  result.redirectURI,      // 来自 authorize 返回；不是手动构造的 redirect_uri
  verifier,                 // 来自 authorize 返回；不是 result.* 上的字段
);

const tokens = newTokenSet(tokenResp, reg.client_id, process.env.ACOSMI_SERVER_URL!);
await new FileTokenStore('./tokens.json').save(tokens);
```

> 浏览器侧（无法启 loopback HTTP server）请改用 v1.4.0+ Web OAuth 原语 `discoverWebOAuthMetadata` + `registerWebOAuthClient` + `createWebAuthorizationRequest` + `completeWebAuthorizationRequest`，由调用方实现 popup / 同窗口 redirect handler，SDK 负责 PKCE / state 校验 / token 兑换。

### Token 持久化

```ts
import { Client, FileTokenStore, LocalStorageTokenStore } from '@acosmi/sdk-ts';

// Node — 默认 ~/.acosmi/tokens.json，可自定义路径
const client = new Client({ serverURL: process.env.ACOSMI_SERVER_URL!, store: new FileTokenStore('./my-tokens.json') });

// 浏览器 — 自动用 LocalStorage（无 LocalStorage 时退化为内存）
```

## API 总览

| 模块         | 主要方法                                                                             |
| ------------ | ------------------------------------------------------------------------------------ |
| **Client 构造** | `new Client(cfg)`（同步），`Client.create(cfg)`（async；预加载已有 TokenStore）            |
| **Chat**     | `chat`, `chatStream`, `chatStreamWithUsage`, `chatMessages`, `chatMessagesStream`, `buildChatRequest` |
| **Agent Runs** | `agentRuns.create`, `agentRuns.stream`, `agentRuns.run`, `agentRuns.cancel`, `agentRuns.get`, `agentRuns.listArtifacts`, `agentRuns.downloadArtifact`, `agentRuns.submitLocalToolResult`, `agentRuns.runWithLocalTools` |
| **Auth — 内置 Loopback OAuth** | `login`, `loginWithHandler`, `logout`, `ensureToken`, `forceRefresh`, `isAuthorized`, `getTokenSet` |
| **Auth — 手动 OAuth 原语** | `discover`, `discoverWithProfile`, `register`, `authorize`, `exchangeCode`, `refreshToken`, `revokeToken`, `generateState` |
| **Auth — 浏览器 Web OAuth (v1.4.0+)** | `discoverWebOAuthMetadata`, `registerWebOAuthClient`, `createWebAuthorizationRequest`, `completeWebAuthorizationRequest` |
| **Models**   | `listModels`, `listModelsWithStatus`, `getModelCapabilities`, `getQuotaSummary`, `ensureModelCached`, `modelSupportsInputModality`, `modelSupportsImageInput`, `findFirstModelByInputModality`, `findDesktopVisualUnderstandingModel` |
| **Skills**   | `browseSkillStore`, `browseSkills`, `browseSkillsList`, `getSkillDetail`, `getSkillSummary`, `resolveSkill`, `installSkill`, `downloadSkill`, `uploadSkill`, `generateSkill`, `optimizeSkill`, `validateSkill`, `certifySkill`, `getCertificationStatus` |
| **Tools**    | `listTools`, `getTool`                                                               |
| **Wallet**   | `getWalletStats`, `getWalletTransactions`                                            |
| **Entitlements** | `getBalance`, `getBalanceDetail`, `listEntitlements`, `listConsumeRecords`, `claimMonthlyFree`, `getByModel`, `listBuckets`, `listCoefficients`, `invalidateCoefficientCache` |
| **Packages** | `listTokenPackages`, `getTokenPackageDetail`, `buyTokenPackage`, `getOrderStatus`, `listMyOrders`, `waitForPayment` |
| **Notifications** | `listNotifications`, `getUnreadCount`, `markNotificationRead`, `markAllNotificationsRead`, `deleteNotification`, `registerDevice`, `unregisterDevice`, `listNotificationPreferences`, `updateNotificationPreference` |
| **Notifications — WebSocket** | `connect`, `disconnect`, `isConnected` (实时推送订阅；浏览器走原生 WebSocket，Node 18-21 需自装 `ws`，Node 22+ 用原生) |
| **Bug Report** | `submitBugReport`, `getBugReport`                                                  |
| **Web Search** | `newWebSearchTool` (factory)                                                       |
| **Compliance** | `compliance.createEvidenceAsset`, `compliance.issueTimestamp`, `compliance.waitForTimestampVerified`, `compliance.buildEvidencePackage`, `compliance.createReport`, `compliance.downloadReport`, `compliance.createSigningEnvelope`, `compliance.signEnvelope`, `compliance.getProviderRequest`, `compliance.waitForProviderRequestTerminal` |
| **Compliance — 分页列表** | `compliance.listEvidenceAssets`, `compliance.listTimestamps`, `compliance.listEvidencePackages`, `compliance.listReports`, `compliance.listSigningEnvelopes`, `compliance.listSealApprovals`, `compliance.listSealUses`（均返回 `PageResult<T>`） |
| **Compliance — 能力与操作投影** | `compliance.getCapabilities`, `compliance.getFeatureGate`, `compliance.listOperations`, `compliance.getOperation` |
| **Compliance — TSA 只读视图** | `compliance.listTsaProviders`, `compliance.getTsaStats` |
| **Compliance — envelope 收尾** | `compliance.listEnvelopeContracts`, `compliance.listEnvelopeProviderRequests`, `compliance.voidEnvelope`（`void` 为写、带 `Idempotency-Key`） |
| **Compliance — 合同模板** | `compliance.createContractTemplate`, `compliance.updateContractTemplate`, `compliance.deleteContractTemplate`, `compliance.getContractTemplate`, `compliance.listContractTemplates`, `compliance.uploadContractTemplatePdf`, `compliance.publishContractTemplate`, `compliance.archiveContractTemplate`, `compliance.listContractTemplateVersions`（写均带 `Idempotency-Key`） |

完整签名见 `dist/node/index.d.ts`，IDE 自带补全。

### 跨域共享 DTO（`shared`，v1.5.0）

`src/shared/` 收口跨域基础设施类型，从根入口直接导出，供各业务域统一引用：

| 文件 | 导出 | 说明 |
| --- | --- | --- |
| `pagination` | `PageRequest`、`PageResult<T>`、`SortDirection` | `PageResult<T>` 是 `YudaoPageResult<T>` 的别名，全 SDK 单一分页结果结构 |
| `operation` | `OperationId`、`OperationSource`、`OperationStatus`、`VerifyStatus`、`IdempotencyKey`、`IdempotencyKeyHeader`、`ProviderRequestStatus` | `operationId` 跨来源关联键；`IdempotencyKeyHeader` 写接口幂等键 header 单一真相源 |
| `retry-advice` | `RetryAdvice`、`RetryAdviceReason`、`retryReasonForComplianceKey()`、`retryReasonForOAuthError()`、`complianceErrorToRetryAdvice()` | 统一失败补救建议——**叠加**在 `RetryPolicy` / `ComplianceErrorInfo` 之上，不替换 |
| `principal` | `PrincipalRef`、`TenantRef`、`ApiClientRef` | 轻量身份 / 租户引用 |
| `gate` | `FeatureGateStatus`、`FeatureGateState`、`StepUpStatus`、`GateQuota`、`BillingPreflightResult` | gate / capability / step-up / preflight 查询形态 |

> 这些是为后续平台控制面（`tenant` / `iam` / `operations` / `gateway` 等）与
> `compliance` 分页 / gate 能力预沉淀的【共享原语】；消费这些类型的命名空间方法
> 须待对应后端端点就绪后才落地，当前 8 个占位命名空间尚未从根入口导出。

### `sanitize` 命名空间（历史消息清理）

`@acosmi/sdk-ts` 把 `src/sanitize/` 整体以命名空间方式导出（`import { sanitize } from '@acosmi/sdk-ts'`），同时也通过 `@acosmi/sdk-ts/sanitize` 子路径单独导入。Client 与 ChatRequest 的粘合（`Client.prototype.applyRequestSanitizers`）由 `src/core/sanitize-bridge.ts` 通过 declaration merging 自动注入。**默认零开销**——只有显式调用 `client.setDefensiveSanitize(cfg)` 或 `client.setAutoStripEphemeralHistory(true)` 后才走流水线。

| 公开符号 | 形态 | 用途 |
| --- | --- | --- |
| `client.setDefensiveSanitize(cfg)` | Client 方法（runtime 注入） | 配置请求前底线防御（`maxMessagesTurns` 历史轮深度、`permanentDenyBlocks` block 类型黑名单、`maxImageBytes` / `maxVideoBytes` / `maxPDFBytes` base64 内联媒体上限）；传 `{}` 关闭 |
| `client.setAutoStripEphemeralHistory(on)` | Client 方法（runtime 注入） | 开启后每次请求自动从 `rawMessages` 剥除带 `acosmi_ephemeral:true` 标记的 block，并联动剥引用已剥 `tool_use_id` 的 `tool_result` |
| `client.applyRequestSanitizers(req)` | Client 方法（buildChatRequest 内部自动调用） | 一般无需手动调；自定义 build 链路时可直接复用 |
| `sanitize.sanitize(messages, cfg)` | 函数 | 对消息历史做白名单过滤 + 深度 / 尺寸校验 + ephemeral 剥离，返回新数组 |
| `sanitize.dropBlocks(messages, predicate)` | 函数 | 按谓词剔除 content blocks（联动剔除引用同 tool_use_id 的 tool_result） |
| `sanitize.stripEphemeral(messages)` | 函数 | 剥离 `acosmi_ephemeral:true` 块（端口自 Go `sanitize.StripEphemeral`，bug-for-bug） |
| `sanitize.MinimalSanitizeConfig` | 类型 | sanitize 配置 |
| `sanitize.BlockType` / `BlockText` / `BlockImage` / `BlockVideo` / `BlockDocument` / `BlockSearchResult` / `BlockThinking` / `BlockRedactedThinking` / `BlockToolUse` / `BlockToolResult` / `BlockToolReference` / `BlockServerToolUse` / `BlockWebSearchToolResult` / `BlockCodeExecutionToolResult` / `BlockMCPToolUse` / `BlockMCPToolResult` / `BlockContainerUpload` | 类型 + 常量 | 已知 block 类型常量 |
| `sanitize.HistoryTooDeepError` / `BlockDeniedError` / `SizeError` | 错误 | sanitize 规则不通过时分类抛出（也导出对应单例 `ErrHistoryTooDeep` / `ErrBlockDenied`） |

```ts
import { Client, sanitize } from '@acosmi/sdk-ts';

const client = new Client({ serverURL });

// 启用底线防御 + 自动剥 ephemeral
client.setDefensiveSanitize({
  maxMessagesTurns: 64,
  // 其他字段按 MinimalSanitizeConfig 形态填充
});
client.setAutoStripEphemeralHistory(true);

// 之后 chat / chatStream 走 buildChatRequest 时自动应用 applyRequestSanitizers。
```

> 红线：**thinking 块在 Anthropic 续轮的"上一轮返回什么、下一轮就必须原样回传"硬约束下走豁免**，禁止从历史中剔除；`tool_use_id` 联动剔除规则参考 `test/sanitize/history.test.ts` 的 P0 红线测试。详细行为见 `src/sanitize/history.ts` + `defensive.ts`。

### 示例：Skill 商店搜索

```ts
import { Client } from '@acosmi/sdk-ts';

const client = new Client({ serverURL: process.env.ACOSMI_SERVER_URL! });

// 公共端点 — 无需登录
const result = await client.browseSkills(
  1, 20,            // page, pageSize
  'ACTION',         // category: ACTION|TRIGGER|TRANSFORM|''
  '关键词',         // keyword
  '',               // tag
  'BUILTIN',        // source: BUILTIN|COMMUNITY|USER|''
);
console.log(result.total, result.items);
```

### 示例：LLM 联网搜索（Anthropic Web Search Tool）

```ts
import { Client, newWebSearchTool } from '@acosmi/sdk-ts';

const tool = newWebSearchTool({
  max_uses: 5,
  allowed_domains: ['anthropic.com', 'developer.mozilla.org'],
});

const resp = await client.chat('claude-opus-4-7', {
  messages: [{ role: 'user', content: '查一下 Web Components 最新规范' }],
  max_tokens: 2048,
  tools: [tool],
});
```

`AllowedDomains` / `BlockedDomains` 互斥，同时传入抛 `Error`。

### 示例：桌面视觉理解 sidecar 选模型（CrabCode desktop automation / computer-use）

```ts
import {
  Client,
  findDesktopVisualUnderstandingModel,
  modelSupportsImageInput,
} from '@acosmi/sdk-ts';

const client = new Client({ serverURL: process.env.ACOSMI_SERVER_URL! });
const models = await client.listModels();

// 1) 主模型是否能直接吃截图？
const primaryCanSeeImages = modelSupportsImageInput(
  models.find((m) => m.modelId === 'deepseek-v4') ?? null,
);

// 2) 不能 → 走桌面视觉 sidecar：截图先送 sidecar 解析为结构化 UI 描述，再喂主模型
const sidecar = findDesktopVisualUnderstandingModel(models);
if (!sidecar) {
  throw new Error('No desktop visual understanding model available — 让管理员在网关启用一个 sidecar 模型');
}
console.log('sidecar →', sidecar.modelId);
```

红线：

- `ManagedModel.inputModalities` 用于客户端判断模型可接收的用户输入类型（'text' | 'image'）。
- `capabilities.supports_desktop_visual_understanding` 用于选择专门解析桌面截图的视觉 sidecar 模型，与 `inputModalities` 是正交两件事（普通视觉模型不一定擅长 UI 解析）。
- 客户端不应硬编码模型名做能力推断，应完全依赖 SDK catalog 字段。
- 上游未下发 `inputModalities` 时 SDK 保持 `undefined`，调用方必须保守按 text-only / unknown 处理。

### 示例：钱包 + 余额 + 流量包购买

```ts
// 金额字段是 string（Go json.Number 端口，避免浮点精度丢失）
const stats = await client.getWalletStats();
// { balance: "100.00", monthlyConsumption: "32.50", monthlyRecharge: "150.00" }

const balance = await client.getBalance();             // 聚合权益余额

const pkgs = await client.listTokenPackages();
const order = await client.buyTokenPackage(pkgs[0].id, { payMethod: 'wechat' });
const status = await client.waitForPayment(order.id, 2000);  // 2s 轮询直到终态
```

### 示例：Bug Report（CrabCode CLI 反馈端点）

```ts
// reportData 任意 JSON 可编码对象，后端做脱敏 + 字段抽取（无须客户端过滤密钥）
const result = await client.submitBugReport({
  description: 'Stream 卡住',
  platform: 'darwin',
  version: '1.0.0',
  errors: [/* ... */],
  transcript: [/* ... */],
});
console.log(result.feedback_id, result.detail_url);

// 公开页 ViewModel（无需 auth）
const view = await client.getBugReport(result.feedback_id);
```

## 错误处理

所有方法 `throw` 类型化错误（不是 Go 风格多返回值）：

| 错误类型             | 触发                                                                   |
| -------------------- | ---------------------------------------------------------------------- |
| `HTTPError`          | 4xx/5xx，含 `statusCode` / `body` / `type` / `retryAfter`              |
| `NetworkError`       | TCP/DNS/TLS 失败；含 `isTimeout()` / `isEOF()` 便捷判定                  |
| `StreamError`        | gateway `managed_model_stream_failed` 事件解析（含 `code` / `stage` / `retryable`） |
| `AgentRunStreamError` | Agent Runs 流返回 `error` 事件（默认抛出；可设 `throwOnError:false` 自行消费） |
| `BusinessError`      | 网关返回 `code !== 0`，含 `code` (number) / `message` (字符串)         |
| `RateLimitError`     | 429（含 `retryAfter`）                                                 |
| `OrderTerminalError` | `waitForPayment` 终态失败                                              |
| `ModelNotFoundError` | `chat` / `ensureModelCached`：listModels 自动刷新一次后仍未命中目标 modelId（v0.13.x 起替代旧硬返 anthropic 占位的行为，含 `modelId` 字段） |
| `CompliancePollError` | `waitForTimestampVerified` / `waitForProviderRequestTerminal` 终态失败或超时（含 `kind: 'timeout' | 'terminal_failure' | 'unknown'`） |

```ts
import { HTTPError, BusinessError } from '@acosmi/sdk-ts';

try {
  await client.chat(...);
} catch (e) {
  if (e instanceof HTTPError && e.statusCode === 401) await client.login(...);
  if (e instanceof BusinessError) console.error(e.code, e.message);
  throw e;
}
```

### Compliance 错误分类

合规域使用 Java 数值错误码（1-031-xxx-xxx），SDK 通过 `classifyComplianceError` 把
`BusinessError` 映射到 symbolic key，便于分支判断：

```ts
import { BusinessError, classifyComplianceError, isComplianceBusinessError } from '@acosmi/sdk-ts';

try {
  await client.compliance.publishReport(reportId, { idempotencyKey });
} catch (e) {
  if (e instanceof BusinessError && isComplianceBusinessError(e)) {
    const info = classifyComplianceError(e);
    if (info.stepUpRequired) {
      // 引导用户重新做 OAuth introspection / 重新登录后用同一 idempotency-key 再试
    } else if (info.terminal) {
      // 终态错误（gate closed / provider not configured 等），不要 retry，用新 key 重发
    }
  }
  throw e;
}
```

## Compliance (时间章 / 电子证据 / 合同签署)

合规域走独立子客户端 `client.compliance.*`，使用独立 base URL。**SDK 永远不接触
provider endpoint、证书/密钥材料、provider raw payload / callback billing commit**；
所有 provider 选择由服务端按配置决定，调用方不传 `provider` 字段。

完整 API 指南见 [docs/compliance.md](./docs/compliance.md)。

```ts
import { Client, complianceScopes } from '@acosmi/sdk-ts';

// 1. 配置 — complianceBaseURL 默认 ${serverURL}/admin-api
const client = await Client.create({
  serverURL: process.env.ACOSMI_SERVER_URL!,
  // complianceBaseURL: process.env.ACOSMI_COMPLIANCE_BASE_URL,  // 独立 ingress 时显式覆盖
});

// 2. 登录 — OAuth scope 申请按业务最小集合
await client.login('My App', complianceScopes());

// 3. 申请时间章（写操作；strongly recommended 持久化 idempotency-key）
const idempotencyKey = `ts-${orderId}-${Date.now()}`;
await persistKey(idempotencyKey);
const token = await client.compliance.issueTimestamp(
  { name: 'release-artifact', hashAlgorithm: 'sha256', digest: sha256Hex },
  { idempotencyKey },
);

// 4. 轮询到本地 verify 通过
const verified = await client.compliance.waitForTimestampVerified(token.id, {
  timeoutMs: 60_000,
});

// 5. 公开 verify — 不要求登录、不暴露 PII / 合同原文
const result = await client.compliance.verifyEvidencePublic({ evidenceNo: 'EV-001' });
console.log(result.manifestOfflineVerify);
```

### 公开 verify 匿名语义

`verifyEvidencePublic` 可匿名调用：未 `login()` 时 SDK 直接发匿名请求，不会抛
`not authorized, call login() first`。客户端已持有 token 时请求会附带 `Authorization`，
便于后端保留审计上下文。与认证 GET 读不同，public verify 收到 `401` 不会触发
`forceRefresh`、不做 refresh replay。

### 写操作幂等与 401 策略

合规域写操作有别于普通 API：

- **Idempotency-Key**：所有 POST 写操作支持 `Idempotency-Key` header；调用方必须**持久化**
  key（重启后仍可用）。同一 key 重发等价于"对账查询同一业务结果"，避免 provider 侧重复
  请求 / 重复扣费。
- **401 不自动重放**：写操作 401 直接抛 `HTTPError`，**不会自动 refresh + replay**。
  调用方需要重新登录后用**同一 idempotency-key** 调用同一方法。GET 读操作仍走单次 401
  refresh 重试。
- **5xx / timeout 不自动重试**：合规域写操作完全禁用自动重试。
- **step-up 错误（`COMPLIANCE_STEP_UP_REQUIRED`，code=1031000013）**：通过
  `classifyComplianceError` 识别后引导用户重新做 OAuth introspection / 升级 token 等级。
- **gate closed / provider not configured / unknown**：terminal 错误，禁止自动重发原请求。

### 隐私边界

`verifyEvidencePublic` 返回字段：`evidenceNo` / `assetType` / `hashAlgorithm` / `contentHash` /
`size` / `manifestHash` / `packageHash` / `manifestOfflineVerify` / `verifiedAt`。**不暴露**
PII / 合同原文 / storage bucket+key / subject snapshot / provider raw / TSA 证书内部字段。

### 完整 API 列表

```ts
client.compliance.createEvidenceAsset(req, options?)
client.compliance.getEvidenceAsset(id, signal?)
client.compliance.verifyEvidencePublic(req, signal?)
client.compliance.listEvidenceAssets(req?, signal?)        // 分页 → PageResult
client.compliance.listEvidencePackages(req?, signal?)      // 分页 → PageResult

client.compliance.issueTimestamp(req, options?)
client.compliance.issueTimestampForAsset(assetId, options?)
client.compliance.getTimestamp(id, signal?)
client.compliance.verifyTimestamp(req, options?)
client.compliance.waitForTimestampVerified(id, opts?)
client.compliance.listTimestamps(req?, signal?)            // 分页 → PageResult

client.compliance.buildEvidencePackage(assetId, timestampTokenId?, options?)

client.compliance.createReport(req, options?)    // 需 compliance:reports:write
client.compliance.getReport(id, signal?)
client.compliance.publishReport(id, options?)    // step-up
client.compliance.downloadReport(id, signal?)    // 离线复核 hash 视图
client.compliance.listReports(req?, signal?)               // 分页 → PageResult

client.compliance.createSigningEnvelope(req, options?)
client.compliance.getSigningEnvelope(envelopeId, signal?)
client.compliance.signEnvelope(envelopeId, req, options?)            // step-up + gate
client.compliance.createH5SigningUrl(envelopeId, req, options?)      // step-up + gate
client.compliance.syncSigningEnvelopeStatus(envelopeId, options?)
client.compliance.listSigningEnvelopes(req?, signal?)      // 分页 → PageResult
client.compliance.listEnvelopeContracts(envelopeId, signal?)         // 合同列表（数组）
client.compliance.listEnvelopeProviderRequests(envelopeId, signal?)  // provider 请求列表（数组）
client.compliance.voidEnvelope(envelopeId, req, options?)            // 作废 envelope（写）

client.compliance.submitSealApproval(req, options?)
client.compliance.approveSealApproval(id, query, options?) // step-up
client.compliance.rejectSealApproval(id, query, options?)
client.compliance.cancelSealApproval(id, query, options?)
client.compliance.listPendingSealApprovals(signal?)
client.compliance.getSealApproval(id, signal?)
client.compliance.listSealApprovals(req?, signal?)         // 分页 → PageResult
client.compliance.listSealUses(req?, signal?)              // 用印执行分页 → PageResult

client.compliance.getProviderRequest(id, signal?)
client.compliance.waitForProviderRequestTerminal(id, opts?)

client.compliance.getCapabilities(signal?)                 // 能力闸门列表
client.compliance.getFeatureGate(action, signal?)          // 单动作能力（便捷，一次网络请求）
client.compliance.listOperations(req?, signal?)            // 操作投影分页 → PageResult
client.compliance.getOperation(id, signal?)                // 操作投影详情
client.compliance.classifyError(err)                       // BusinessError → ComplianceErrorInfo | null（同顶层 classifyComplianceError，便于在 catch 块上链式调用）

client.compliance.listTsaProviders(signal?)                // TSA provider 只读列表
client.compliance.getTsaStats(signal?)                     // 时间章统计只读视图

client.compliance.createContractTemplate(req, options?)              // 创建合同模板（DRAFT）
client.compliance.updateContractTemplate(id, req, options?)          // 更新模板（仅 DRAFT）
client.compliance.deleteContractTemplate(id, options?)               // 删除模板（仅 DRAFT）
client.compliance.getContractTemplate(id, signal?)                   // 模板详情
client.compliance.listContractTemplates(req?, signal?)               // 模板分页 → PageResult
client.compliance.uploadContractTemplatePdf(id, req, options?)       // 上传 PDF（base64）
client.compliance.publishContractTemplate(id, options?)              // DRAFT → PUBLISHED
client.compliance.archiveContractTemplate(id, options?)              // PUBLISHED → ARCHIVED
client.compliance.listContractTemplateVersions(id, signal?)          // 版本快照列表（数组）
```

> 6 个 `list*` 分页方法（compliance gateway S1）均走 `GET .../page`，返回
> yudao `PageResult<T>`（`{ total, list }`）。请求参数继承共享 `PageRequest`
> （`pageNo` / `pageSize` / `sortBy` / `sortDirection`，全部可选）+ 各自的过滤项。
> `createTimeStart` / `createTimeEnd` 由调用方按 `yyyy-MM-dd HH:mm:ss` 字符串提供，
> SDK 原样透传、不做格式校验。

> compliance gateway S2 新增能力闸门查询（`getCapabilities` / `getFeatureGate`）
> 与操作投影读（`listOperations` / `getOperation`）。`getCapabilities` 为每个高
> 风险 / 收费动作返回 `executable` / `state` / `requiredScopes` / `requiredStepUp`
> ——拿不到能力时必须 fail-closed。均走 GET 读路径（`401` 单次刷新重放）。

> compliance gateway S4 新增 envelope 收尾方法：`listEnvelopeContracts` /
> `listEnvelopeProviderRequests` 走 GET 读路径返回普通数组（非 `PageResult`），
> `listEnvelopeProviderRequests` 复用操作投影类型 `OperationPageItem`；
> `voidEnvelope` 为写方法——走 compliance 写路径（`Idempotency-Key`、不重试、
> `401` 不重放），`reason` 随 JSON body 提交。envelope 的 send / remind /
> authorize / download / token 等动作在后端 S4 范围之外暂缓。

> compliance gateway S5 新增合同模板（contract template）9 个方法：DRAFT →
> PUBLISHED → ARCHIVED 全生命周期。读方法（`getContractTemplate` /
> `listContractTemplates` / `listContractTemplateVersions`）走 GET 读路径；写
> 方法（`createContractTemplate` / `updateContractTemplate` /
> `deleteContractTemplate` / `uploadContractTemplatePdf` /
> `publishContractTemplate` / `archiveContractTemplate`）走 compliance 写路径
> （`Idempotency-Key`、不重试、`401` 不重放）。新增 2 个 scope —
> `compliance:contract_template:read` / `compliance:contract_template:write` —
> 不要求 step-up。版本列表与列表项视图都不下发模板【字段叠加】，字段只在详情 /
> 版本快照里返回。

> compliance gateway S6 新增用印执行（seal use）分页只读方法：`listSealUses`。
> 走 `GET /compliance/seal-uses/page`，返回 yudao `PageResult<SealUsePageItem>`；
> 过滤支持 `sealId` / `envelopeId` / `usageStatus` / `createTimeStart` /
> `createTimeEnd`。复用既有 `compliance:contract_signing:read` scope，不引入新
> scope。印章授权 / 印章 CRUD（U-3 / U-11）仍为后端推迟项（CFCA 私有 jar /
> W3 闸门），本版本不引入 SDK 方法。

### 示例

`examples/` 下提供可直接运行的端到端示例，并随 npm 包一起发布：

- `examples/core-chat.ts` — Client 构造 / 配置 / 模型列举 / 同步与流式 chat
- `examples/auth-oauth-flow.ts` — 手动 OAuth 2.1 PKCE 流程（discover / register / authorize / exchangeCode / refreshToken / token store）
- `examples/agent-runs-stream.ts` — Agent Run Gateway 创建 / 流式消费 / 本地工具桥 / 产物下载
- `examples/compliance-read.ts` — 只读 / public verify 流程
- `examples/compliance-evidence-timestamp.ts` — hash-only evidence + timestamp + package 链路
- `examples/compliance-envelope.ts` — envelope 创建 / 错误正确处理（step-up / gate closed）

### 后端边界

- Java compliance 后端负责 provider 集成、受控材料、provider raw payload、local verify、
  billing 状态机和对外 public DTO 收敛。
- Go OAuth/JWKS 层负责 token 签发、scope 与 step-up/introspection 语义。
- TS SDK 只申请 scope、发送公共 DTO、传递 `Idempotency-Key`、分类公开错误码并轮询脱敏状态视图。

## AbortSignal

每个异步方法都接 `signal?: AbortSignal`，用于取消请求或流：

```ts
const ctl = new AbortController();
setTimeout(() => ctl.abort(), 5000);

await client.chat('claude-opus-4-7', { ... }, ctl.signal);
```

## 开发

```sh
npm install
npm run typecheck
npm run lint
npm test
npm run build
npm run docs    # 经 TypeDoc 生成 API 参考到 docs/api/
```

## 更新历史

完整变更日志见 [CHANGELOG.md](./CHANGELOG.md)。

| 版本 | 状态 | 概要 |
| --- | --- | --- |
| 1.5.1 | 当前稳定版 | **Docs / examples / 源码注释全量复核与修订 — 无 API 变化**。修补 8 项漂移与遗漏：README API 总览补 25+ 漏列方法（Chat 内部方法、Auth 浏览器 Web OAuth 4 原语、Skills/Notifications/Entitlements/Packages 全量、WS `connect/disconnect/isConnected`）；重写 §"手动 OAuth" 段对齐 `auth.ts` 真实签名；§"双格式红线" + 三个 chat 示例 `maxTokens` → snake_case `max_tokens`；错误表补 `ModelNotFoundError`；§Agent Runs 补 13 类 stream event 完整表；新增 §`sanitize` 命名空间小节；`docs/compliance.md` 6 处 `Since v1.6/.../1.10` 统一为 `v1.5.0 (originally planned as ...)`；手册 §7 scope 数 12 → 15 + 新增 S1-S6 rollup 段；`examples/compliance-evidence-timestamp.ts` 补 `ScopeComplianceReportsWrite`（v1.3.2 漂移生产 401 隐患）；`examples/auth-oauth-flow.ts` + `examples/core-chat.ts` 注释对齐当前契约；`src/index.ts` + `src/browser.ts` + `src/auth/auth.ts` 注释从 Go-port 语义改为"TS 主实现 + Web OAuth 替代品"。`typecheck` / `lint` / `vitest`(214) / `build` / `test:pack` 全绿。 |
| 1.5.0 | 稳定版 | 沉淀 `src/shared/` 跨域共享 DTO（`PageRequest`/`PageResult` 别名、`OperationId`/`OperationStatus`/`IdempotencyKeyHeader`、`RetryAdvice` 叠加层、`PrincipalRef`/`TenantRef`、`FeatureGateStatus`/`StepUpStatus`/`BillingPreflightResult`）。**同时全量 rollup compliance gateway S1-S6** 能力（原 1.6.0-1.11.0 roadmap，见 [CHANGELOG.md](./CHANGELOG.md)）：S1 6 个分页列表、S2 capabilities + operations 投影、S3 TSA 只读视图、S4 envelope 收尾 + void、S5 合同模板全生命周期 + 2 新 scope（`compliance:contract_template:{read,write}`）、S6 用印执行分页（`listSealUses`）。当前 compliance scope 总数 **15** 个（`complianceScopes()` 返回）。纯增量；8 个平台控制面占位命名空间仍待后端契约就绪后落地。 |
| 1.4.2 | 稳定版 | `src/` 从扁平 36 文件按业务域重组为 per-domain 目录；公共导出符号集合、`exports`、`dist/` 路径一字未变（纯内部重组）。新增 TypeDoc API 文档。 |
| 1.4.1 | 稳定版 | 新增 `Config.browserRefreshMode` / `refreshProxyURL`——浏览器 Web OAuth token 刷新策略（规避 issuer CORS 403）。 |
| 1.4.0 | 稳定版 | 新增浏览器 Web OAuth 原语 `discoverWebOAuthMetadata` / `registerWebOAuthClient`（csign `/login` Web OAuth 接入）。 |
| 1.3.2 | 稳定版 | `verifyEvidencePublic` 匿名公开验真链路收口（未登录不抛 `not authorized`）；新增第 13 个 compliance scope `compliance:reports:write`（创建出证报告改用写 scope）；`docs/compliance.md` 新增方法状态四档分级（production-ready / gated / draft contract / internal-only）。 |
| 1.3.1 | 稳定版 | 修订 npm 包短介绍与搜索关键词，明确模型网关、Agent Run Gateway 与 Compliance 统一客户端定位。 |
| 1.3.0 | 稳定版 | 新增 compliance SDK client、base URL、types/errors/status/scopes、docs/examples/tests，并明确 idempotency/no-retry/no-401-replay 与 provider material 安全边界。 |
| 1.2.0 | 稳定版 | 新增 `ManagedModel.inputModalities`、桌面视觉理解 sidecar capability 与 4 个 catalog helpers。 |
| 1.1.0 | 稳定版 | 新增 SDK-facing `agentRuns` 网关客户端，覆盖 create/stream/cancel/get/artifacts/local-tool-result，并提供本地只读工具桥协议。 |
| 1.0.2 | 稳定版 | 修复多进程共享 token refresh rotation 竞态。 |
| 1.0.1 | 历史稳定版 | 修复 1.0.0 双层 broken packaging:tsup 输出 `.mjs+.cjs` 与 exports 字段对齐;9 处 `declare module` 绑包名 `@acosmi/sdk-ts` 让 d.ts augmentation 在 consumer 视角合并;prepublishOnly 加 packed-tarball 烟测拦截"源码过 / 打包后 broken"。 |
| 1.0.0 | **deprecated** | 双层 broken:(1) `package.json.exports` 8 处 `.mjs` 引用与 tsup 默认 `.js+.cjs` 错位 → bun/Node ESM `Cannot find module`;(2) 9 处 `declare module` 用相对路径,consumer 视角断链 → 50+ 方法 TS2339。`npm install @acosmi/sdk-ts` 自动跳到 1.0.1。 |

## License

[MIT](./LICENSE) — Copyright (c) 2026 Acosmi
