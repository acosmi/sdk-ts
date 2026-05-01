# acosmi-sdk-ts

> Acosmi 模型网关 TypeScript SDK — Go SDK v0.19.0 全量端口

## 状态

- 端口源：[acosmi-sdk-go](../acosmi-sdk-go) **v0.19.0**
- 端口策略：bug-for-bug 一字不差对齐
- 版本号严格对齐 Go SDK

## 设计红线

**双格式等地位**：SDK 同时提供 Anthropic + OpenAI 两条路径，**对应两个不同下游产品**。

| Adapter            | 端点                                       | 用途                              |
| ------------------ | ------------------------------------------ | --------------------------------- |
| `AnthropicAdapter` | `POST /managed-models/:id/anthropic`       | Anthropic 原生格式                |
| `OpenAIAdapter`    | `POST /managed-models/:id/chat`            | OpenAI 兼容格式（DeepSeek/GLM 等） |

路由由 `getAdapterForModel(model)` 按 ManagedModel 的 `preferredFormat` / `supportedFormats` 选择，决策顺序：

1. `preferredFormat` 非空 → 按值（`anthropic` | `openai`）
2. `supportedFormats` 含 `anthropic` → AnthropicAdapter
3. `supportedFormats` 含 `openai` → OpenAIAdapter
4. 两字段均空（旧上游）→ 按 provider 名回落

## 多端

| 平台         | HTTP   | SSE              | WebSocket         | TokenStore                      |
| ------------ | ------ | ---------------- | ----------------- | ------------------------------- |
| 浏览器       | fetch  | ReadableStream   | WebSocket         | LocalStorage / IndexedDB        |
| Node ≥18     | fetch  | ReadableStream   | WebSocket（Node22+）/ `ws` | File `~/.acosmi/tokens.json`    |
| Deno / Bun   | fetch  | ReadableStream   | WebSocket         | File                             |

## 安装

```sh
npm install acosmi-sdk-ts
```

## 用法

```ts
import { Client, allScopes } from 'acosmi-sdk-ts';

const client = new Client({ serverURL: 'https://acosmi.com' });
await client.login('My App', allScopes());

const resp = await client.chat('claude-opus-4-7', {
  messages: [{ role: 'user', content: 'Hello' }],
  maxTokens: 1024,
});
console.log(resp.content);
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
