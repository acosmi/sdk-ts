# @acosmi/sdk-ts

> Acosmi 模型网关 TypeScript SDK — 双格式（Anthropic + OpenAI）多端（浏览器 / Node ≥18 / Deno / Bun）

[![npm](https://img.shields.io/npm/v/%40acosmi%2Fsdk-ts.svg)](https://www.npmjs.com/package/@acosmi/sdk-ts)

## 状态

- 端口源：[acosmi-sdk-go](https://github.com/acosmi/acosmi-sdk-go) v1.0.0（与 Go SDK 联动稳定测试版）
- 当前版本：1.0.0（稳定测试版，与 Go SDK 联动 1.0.x）
- 测试：36/36 vitest 全绿，typecheck/lint/build 0 错误

## 安装

```sh
npm install @acosmi/sdk-ts
```

## 快速开始

```ts
import { Client, allScopes } from '@acosmi/sdk-ts';

const client = new Client({ serverURL: 'https://acosmi.com' });
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

## 认证

### 浏览器内 / 自动 OAuth（推荐）

```ts
await client.login('My App', allScopes());     // 自动跳转浏览器完成 OAuth
const token = await client.ensureToken();      // 拿到当前有效 access token
```

### 手动 OAuth（CLI / 自定义流程）

```ts
import { discover, register, authorize, exchangeCode } from '@acosmi/sdk-ts';

const meta = await discover('https://acosmi.com');
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
const client = new Client({ serverURL: 'https://acosmi.com', tokenStore: new FileTokenStore('./my-tokens.json') });

// 浏览器 — 自动用 LocalStorage（无 LocalStorage 时退化为内存）
```

## API 总览

| 模块         | 主要方法                                                                             |
| ------------ | ------------------------------------------------------------------------------------ |
| **Chat**     | `chat`, `chatStream`, `chatStreamWithUsage`                                          |
| **Auth**     | `login`, `logout`, `ensureToken`, `forceRefresh`, `discover`, `authorize`, `exchangeCode`, `refreshToken` |
| **Models**   | `listModels`, `listModelsWithStatus`, `getModelCapabilities`, `getQuotaSummary`      |
| **Skills**   | `browseSkills`, `browseSkillsList`, `getSkillDetail`, `resolveSkill`, `installSkill`, `downloadSkill`, `uploadSkill`, `generateSkill`, `optimizeSkill`, `validateSkill` |
| **Tools**    | `listTools`, `getTool`                                                               |
| **Wallet**   | `getWalletStats`, `getWalletTransactions`                                            |
| **Entitlements** | `getBalance`, `getBalanceDetail`, `listEntitlements`, `claimMonthlyFree`, `getByModel`, `listBuckets`, `listCoefficients` |
| **Packages** | `listTokenPackages`, `buyTokenPackage`, `getOrderStatus`, `waitForPayment`           |
| **Notifications** | `listNotifications`, `getUnreadCount`, `markNotificationRead`, `registerDevice`, `listNotificationPreferences` |
| **Bug Report** | `submitBugReport`, `getBugReport`                                                  |
| **Web Search** | `newWebSearchTool` (factory)                                                       |

完整签名见 `dist/node/index.d.ts`，IDE 自带补全。

### 示例：Skill 商店搜索

```ts
import { Client } from '@acosmi/sdk-ts';

const client = new Client({ serverURL: 'https://acosmi.com' });

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

| 错误类型             | 触发                                         |
| -------------------- | -------------------------------------------- |
| `HTTPError`          | 4xx/5xx，含 `status` / `body` / `requestID`  |
| `NetworkError`       | TCP/DNS/TLS 失败                             |
| `StreamError`        | SSE 流解析失败                               |
| `BusinessError`      | 网关返回 `code !== 0`，含 `code` / `bizMsg`  |
| `RateLimitError`     | 429（含 `retryAfter`）                       |
| `OrderTerminalError` | `waitForPayment` 终态失败                    |

```ts
import { HTTPError, BusinessError } from '@acosmi/sdk-ts';

try {
  await client.chat(...);
} catch (e) {
  if (e instanceof HTTPError && e.status === 401) await client.login(...);
  if (e instanceof BusinessError) console.error(e.code, e.bizMsg);
  throw e;
}
```

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

## License

[MIT](./LICENSE) — Copyright (c) 2026 Acosmi
