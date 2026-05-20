# @acosmi/sdk-ts

> Acosmi 模型网关 + Agent Run Gateway TypeScript SDK — 双格式（Anthropic + OpenAI）多端（浏览器 / Node ≥18 / Deno / Bun）

[![npm](https://img.shields.io/npm/v/%40acosmi%2Fsdk-ts.svg)](https://www.npmjs.com/package/@acosmi/sdk-ts)

## 状态

- 端口源：[acosmi-sdk-go](https://github.com/acosmi/acosmi-sdk-go) v1.0.0（与 Go SDK 联动稳定测试版）
- 当前版本：**1.3.1**（修订 npm 包介绍与搜索关键词；`1.3.0` 新增 `client.compliance`、`complianceBaseURL`、合规域 types/errors/status/scopes、示例与文档；详见 [CHANGELOG](./CHANGELOG.md)）
- 测试：发布前需通过 typecheck/lint/vitest/build/packed-tarball smoke (`npm run test:pack`)
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
  maxTokens: 1024,
});
console.log(resp.content);
```

## 双格式红线（设计核心）

SDK 同时提供 **Anthropic + OpenAI 两条 endpoint**，**等地位**，对应两个不同下游产品。

| Adapter            | 端点                                  | 用途                                |
| ------------------ | ------------------------------------- | ----------------------------------- |
| `AnthropicAdapter` | `POST /managed-models/:id/anthropic`  | Anthropic 原生格式（含 thinking 等）|
| `OpenAIAdapter`    | `POST /managed-models/:id/chat`       | OpenAI 兼容格式（DeepSeek/GLM 等）  |

路由由 `getAdapterForModel(model)` 按 ManagedModel 的 `preferredFormat` / `supportedFormats` 决策：

1. `preferredFormat` 非空 → 按值（`anthropic` | `openai`）
2. `supportedFormats` 含 `anthropic` → AnthropicAdapter
3. `supportedFormats` 含 `openai` → OpenAIAdapter
4. 两字段均空（旧上游）→ 按 provider 名回落

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
  maxTokens: 1024,
});

for await (const ev of stream) {
  if (ev.event === 'content_block_delta' && ev.data) {
    // 解析 delta 输出 token
    process.stdout.write(parseDelta(ev.data));
  }
}
```

`chatStreamWithUsage()` 返回带 usage/error/sources 标签的 AsyncIterable，便于聚合统计（详见 `src/client.ts`）。

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

## 认证

### 浏览器内 / 自动 OAuth（推荐）

```ts
await client.login('My App', allScopes());     // 自动跳转浏览器完成 OAuth
const token = await client.ensureToken();      // 拿到当前有效 access token
```

### 手动 OAuth（CLI / 自定义流程）

```ts
import { discover, register, authorize, exchangeCode } from '@acosmi/sdk-ts';

const meta = await discover(process.env.ACOSMI_SERVER_URL!);
const reg = await register(meta, 'My CLI', allScopes());
const result = await authorize(meta, reg, allScopes(), {
  onEvent: (ev) => console.log(ev.type, ev.url),
});
const tokens = await exchangeCode(meta, reg, result.code, result.codeVerifier);
```

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
| **Chat**     | `chat`, `chatStream`, `chatStreamWithUsage`                                          |
| **Agent Runs** | `agentRuns.create`, `agentRuns.stream`, `agentRuns.run`, `agentRuns.cancel`, `agentRuns.get`, `agentRuns.listArtifacts`, `agentRuns.downloadArtifact`, `agentRuns.submitLocalToolResult`, `agentRuns.runWithLocalTools` |
| **Auth**     | `login`, `logout`, `ensureToken`, `forceRefresh`, `discover`, `authorize`, `exchangeCode`, `refreshToken` |
| **Models**   | `listModels`, `listModelsWithStatus`, `getModelCapabilities`, `getQuotaSummary`, `modelSupportsInputModality`, `modelSupportsImageInput`, `findFirstModelByInputModality`, `findDesktopVisualUnderstandingModel` |
| **Skills**   | `browseSkills`, `browseSkillsList`, `getSkillDetail`, `resolveSkill`, `installSkill`, `downloadSkill`, `uploadSkill`, `generateSkill`, `optimizeSkill`, `validateSkill` |
| **Tools**    | `listTools`, `getTool`                                                               |
| **Wallet**   | `getWalletStats`, `getWalletTransactions`                                            |
| **Entitlements** | `getBalance`, `getBalanceDetail`, `listEntitlements`, `claimMonthlyFree`, `getByModel`, `listBuckets`, `listCoefficients` |
| **Packages** | `listTokenPackages`, `buyTokenPackage`, `getOrderStatus`, `waitForPayment`           |
| **Notifications** | `listNotifications`, `getUnreadCount`, `markNotificationRead`, `registerDevice`, `listNotificationPreferences` |
| **Bug Report** | `submitBugReport`, `getBugReport`                                                  |
| **Web Search** | `newWebSearchTool` (factory)                                                       |
| **Compliance** | `compliance.createEvidenceAsset`, `compliance.issueTimestamp`, `compliance.waitForTimestampVerified`, `compliance.buildEvidencePackage`, `compliance.createReport`, `compliance.downloadReport`, `compliance.createSigningEnvelope`, `compliance.signEnvelope`, `compliance.getProviderRequest`, `compliance.waitForProviderRequestTerminal` |

完整签名见 `dist/node/index.d.ts`，IDE 自带补全。

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
  maxTokens: 2048,
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
| `NetworkError`       | TCP/DNS/TLS 失败                                                       |
| `StreamError`        | SSE 流解析失败                                                         |
| `AgentRunStreamError` | Agent Runs 流返回 `error` 事件（默认抛出；可设 `throwOnError:false` 自行消费） |
| `BusinessError`      | 网关返回 `code !== 0`，含 `code` (number) / `message` (字符串)         |
| `RateLimitError`     | 429（含 `retryAfter`）                                                 |
| `OrderTerminalError` | `waitForPayment` 终态失败                                              |
| `CompliancePollError` | `waitForTimestampVerified` / `waitForProviderRequestTerminal` 终态失败或超时 |

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

client.compliance.issueTimestamp(req, options?)
client.compliance.issueTimestampForAsset(assetId, options?)
client.compliance.getTimestamp(id, signal?)
client.compliance.verifyTimestamp(req, options?)
client.compliance.waitForTimestampVerified(id, opts?)

client.compliance.buildEvidencePackage(assetId, timestampTokenId?, options?)

client.compliance.createReport(req, options?)    // 需 compliance:reports:write
client.compliance.getReport(id, signal?)
client.compliance.publishReport(id, options?)    // step-up
client.compliance.downloadReport(id, signal?)    // 离线复核 hash 视图

client.compliance.createSigningEnvelope(req, options?)
client.compliance.getSigningEnvelope(envelopeId, signal?)
client.compliance.signEnvelope(envelopeId, req, options?)            // step-up + gate
client.compliance.createH5SigningUrl(envelopeId, req, options?)      // step-up + gate
client.compliance.syncSigningEnvelopeStatus(envelopeId, options?)

client.compliance.submitSealApproval(req, options?)
client.compliance.approveSealApproval(id, query, options?) // step-up
client.compliance.rejectSealApproval(id, query, options?)
client.compliance.cancelSealApproval(id, query, options?)
client.compliance.listPendingSealApprovals(signal?)
client.compliance.getSealApproval(id, signal?)

client.compliance.getProviderRequest(id, signal?)
client.compliance.waitForProviderRequestTerminal(id, opts?)
```

### 示例

`examples/` 下提供 3 份可直接运行的端到端示例，并随 npm 包一起发布：

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
```

## 更新历史

完整变更日志见 [CHANGELOG.md](./CHANGELOG.md)。

| 版本 | 状态 | 概要 |
| --- | --- | --- |
| 1.3.1 | 当前稳定版 | 修订 npm 包短介绍与搜索关键词，明确模型网关、Agent Run Gateway 与 Compliance 统一客户端定位。 |
| 1.3.0 | 稳定版 | 新增 compliance SDK client、base URL、types/errors/status/scopes、docs/examples/tests，并明确 idempotency/no-retry/no-401-replay 与 provider material 安全边界。 |
| 1.2.0 | 稳定版 | 新增 `ManagedModel.inputModalities`、桌面视觉理解 sidecar capability 与 4 个 catalog helpers。 |
| 1.1.0 | 稳定版 | 新增 SDK-facing `agentRuns` 网关客户端，覆盖 create/stream/cancel/get/artifacts/local-tool-result，并提供本地只读工具桥协议。 |
| 1.0.2 | 稳定版 | 修复多进程共享 token refresh rotation 竞态。 |
| 1.0.1 | 历史稳定版 | 修复 1.0.0 双层 broken packaging:tsup 输出 `.mjs+.cjs` 与 exports 字段对齐;9 处 `declare module` 绑包名 `@acosmi/sdk-ts` 让 d.ts augmentation 在 consumer 视角合并;prepublishOnly 加 packed-tarball 烟测拦截"源码过 / 打包后 broken"。 |
| 1.0.0 | **deprecated** | 双层 broken:(1) `package.json.exports` 8 处 `.mjs` 引用与 tsup 默认 `.js+.cjs` 错位 → bun/Node ESM `Cannot find module`;(2) 9 处 `declare module` 用相对路径,consumer 视角断链 → 50+ 方法 TS2339。`npm install @acosmi/sdk-ts` 自动跳到 1.0.1。 |

## License

[MIT](./LICENSE) — Copyright (c) 2026 Acosmi
