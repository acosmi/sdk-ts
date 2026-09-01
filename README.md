# @acosmi/sdk-ts

> Acosmi 模型网关 + Agent Run Gateway TypeScript SDK — 双格式（Anthropic + OpenAI）多端（浏览器 / Node ≥18 / Deno / Bun）

[![npm](https://img.shields.io/npm/v/%40acosmi%2Fsdk-ts.svg)](https://www.npmjs.com/package/@acosmi/sdk-ts)

## 状态

- **主实现 / 事实标准**：本 TS SDK 现为 Acosmi SDK 的主力实现。Go SDK [acosmi-sdk-go](https://github.com/acosmi/acosmi-sdk-go) 已暂停维护，待 TS 稳定后再从 TS 反向翻译补齐。
- **当前版本：`2.18.0`**（`ManagedModel.thinking_levels` 类型面对齐，2026-08-29）。
- **`v2.18.0`（加性类型发布）**：`ManagedModel` 新增可选字段 `thinking_levels?: string[]` —— 网关下发的**升序思考档位 id 列表**（`ThinkingOff`/`ThinkingHigh`/`ThinkingMax` 的子集）。`listModels` 对它原样透传，公开签名向后兼容、零行为变化；`[]` = 该模型无思考档，`undefined` = 旧网关未播报（按"未知"处理，严禁自行推档）。详见〈思考档位 `thinking_levels`〉。
- **`v2.17.0`（安全修复发布）**：桌面 loopback `authorize()` 对 `/callback` 的**一切形态**（成功 / OAuth error / 畸形）先行校验 CSRF `state`，且必须"恰好一个"并严格等值 —— 缺失、重复（含重复的正确值）、错值一律以稳定错误码 `state_mismatch` 拒绝本次登录；此前携带 OAuth error 的回调绕过 state 直接结算 `auth_denied`，本机任意进程零知识即可打断/塑形等待中的登录，且 `?code=…&state=<正确值>&state=x` 这类重复参数可蒙混通过。`finally` 补 `closeIdleConnections()`，每条终止路径以端口完全关闭收尾。公开 API 签名零变化；回归闸门 `test/auth/desktop-loopback-state.test.ts` 十路终止矩阵。
- **`v2.15.0`（加性兼容发布）**：新增 `classifySourcesEvent()`、`SourcesEventParseResult` 与稳定 issue code，把 `not_sources`、合法 `empty_sources`、非空 `sources`、`malformed_sources` 明确分开。既有 `parseSourcesEvent()` 的代码路径、宽松判定、`null` 条件和返回对象形状保持原样；现有 consumer 无需改动，新 consumer 才选择严格 API。
- **`v2.6.0`（会员订阅查询 + 类型修正，2026-06-04）**：新增 `subscription.getMembership()` / `getSubscriptionTier()` / `subscriptionPrecheck()`；`ManagedModel` 补档位门控字段（`locked`/`freeTier`/`minPlanTier`/`chatRuntimeSupported`/`defaultToolIds`）；auth 新增 `ScopeChatBridge`(+read/write/rotate) 与 `chatBridgeScopes()`。**破坏性类型修正**：`BalanceDetail` 形状对齐网关 `InternalBalanceResponse`、`Order` 拆为 `BuyResponse`/`OrderListItem`、`getOrderStatus`/`waitForPayment` 改用 `BuyResponse.paymentStatus`（修死循环）、`PayPayload.payMethod`→`paymentMethod`、`TokenPackage` 对齐 `toProductView`、`WalletStats`/`Transaction` `amount` 由 string 改 number、consume-records 分页修正、notifications WebSocket 用一次性 `stream-ticket` 取代 URL `?token=` JWT。废弃 `listUserSubscriptions`（改用 `getMembership`）、`ModelCoefficient`/`listCoefficients`（系数退役恒空）、`ManagedModel.pricePerMTok`/`isDefault`（公开端点不返回）；notifications 设备/偏好方法标 `@experimental`。详见 CHANGELOG。
- **`v2.5.1`（格式一致性护栏，2026-05-31）**：`getAdapterForModel` 路由加固 —— `preferred_format` 现仅在**确被 `supported_formats` 收录**时才采信（或 `supported_formats` 未声明时维持原样）。防止上游元数据漂移（如 `preferred_format=anthropic` 但 `supported_formats=[openai]`）把 SDK 路由到模型并不支持的格式端点，撞 `/anthropic`「未绑定 Anthropic」4xx。`supported_formats` 为空/未知（旧上游）时**行为逐字节不变**。新增 3 条 routing 用例钉死矛盾场景。
- **`v2.5.0`（健康度审计根因修复，2026-05-31）**：源码深度审计后修复一批真实运行时缺陷 —— `agentRuns.downloadArtifact()` 超限不再静默截断而是抛错；本地工具回调 `Promise.race` 硬超时（忽略 `signal` 的 handler 也不再永挂）；OpenAI 流式 `reasoning_content` 后直接 `tool_calls`（无 text）时 block index 不再错乱；非法 `expires_at` 视为过期 + TokenStore 形状校验；OAuth 发现/注册/换/吊销链路统一走注入 `fetchImpl`；空成功响应（204）不再抛 JSON parse error；`apiBaseURL`/`complianceBaseURL` 与 gateway base 同级校验（拒 ws/wss/query/hash）；非流式请求默认超时；WebSocket 重复 connect 先关旧连接；`FileTokenStore.save()` 真 fsync；chat 请求对象不再被原地 mutate；Anthropic `extraBody` 不能覆盖 SDK 管理字段。**公开类型/方法签名零移除、零改名**（新增导出 `normalizeOverrideBaseURL` / `DEFAULT_API_TIMEOUT_MS`）。casehall/finance/enterprise 业务域路径经生产实证确认正确（同源代理直连 tk-dist），**未改**，并新增 URL 组装回归测试钉死契约。
- **`v2.1.0`（已发布）**：远程控制 CrabCode 多接入面 —— `serverURL`/`baseURL` Gateway URL 公共契约（见下方小节）、`agentRuns.createRemoteRun` / `agentRuns.streamRemoteControl` + 11 事件 union（见 §Agent Runs → 远程控制）、`chatbridge` 第三方聊天平台桥接类型（types-only 骨架，见 §Chat Bridge）、专用 `remote_control` scope（不进 `allScopes()`）。契约见 `docs/audit/sdk-remote-control-contract-2026-05-27.md`。
- **v2.0.0 BREAKING（Phase 3 复核 + 全量根治，2026-05-25）摘要**：
  - SDK 同步主仓 9 commit 闭环 20 P0（RBAC 表达式统一 / PII 真落盘加密链 / K7 视频 webhook 幂等 / K8 OCR SSRF / K9 KYC main flow / admin 写端点错误码契约）。
  - 新增 `casehall.getMyLawyerCredentialStatus()` + `enterprise.getMyEnterpriseKycStatus()` 律师 / 企业 OWNER 自查端点（纯增量）。
  - `finance/types.ts` P2-016 PII Javadoc 升级（含 `keyVersion` v1/v2 payload 协议 + 4 角色 × 3 PII 级矩阵）。
  - 新建 `docs/pii-role-matrix.md`（4 角色：`platform_admin` / `s2s` / `lawyer` / `consumer`）。
  - admin 写端点错误码改 HTTP 状态码语义（`200+{ok:false}` → `403/404/501`），上游契约整流。
  - **升级路径详见下方 "v2.0.0 升级指引"**。
- **v1.x 历史链**：1.9.0 finance / 1.8.1 enterprise / 1.8.0 casehall / 1.7.0 csign+pricing+products+subscription / 1.6.0 endUserId+11min 保活 / 1.5.x 跨域共享 DTO + Compliance S1-S6 rollup / 1.4.x 浏览器 Web OAuth / 1.3.x compliance SDK / 1.2.x InputModality / 1.1.x agentRuns / 1.0.x 包发布修复。详见 [CHANGELOG](./CHANGELOG.md)。
- **测试**：发布前需通过 `typecheck` / `lint` / `vitest` / `build` / `test:pack`（packed-tarball consumer smoke）。
- **API 参考文档**：`npm run docs`（TypeDoc）生成到 `docs/api/`。
- **包链接**：[npm](https://www.npmjs.com/package/@acosmi/sdk-ts) · [GitHub Releases](https://github.com/acosmi/sdk-ts/releases)。

### v2.0.0 升级指引

v2.0.0 标 BREAKING，但 **TS SDK 公开类型与方法签名零移除、零改名**；BREAKING 范围在网关后端，集成方按以下清单核对：

| 受影响场景 | 集成方动作 | 关联 |
|------------|----------|------|
| 持有 `ROLE_ADMIN` 角色（不是 `platform_admin`）想读 PII L3 字段（如发票税号、律师执照号） | **必须 review** — 网关 `SensitiveSerializer` 不再把 `ROLE_ADMIN` 当 `platform_admin` 别名 fail-OPEN，统一收敛为 4 角色严格白名单。仍需 PII L3 read 的角色须重新申请 `platform_admin` | `docs/pii-role-matrix.md` |
| 持有 admin 写端点 (`/admin/**/...`) 旧契约 — 期望 `200+{ok:false,code:xxx}` 业务错误码 | **必须改** — 改读 HTTP 状态码：`403` 鉴权不足 / `404` 资源不存在 / `501` `NOT_CONFIGURED_CODE` 网关未配置 provider；body 不再保证带业务码 | 主仓 `K10AdminController` |
| 用 `client.casehall.*` / `client.enterprise.*` 调律师 / 企业 OWNER 资质相关接口 | **零改动** — 新增 `getMyLawyerCredentialStatus()` / `getMyEnterpriseKycStatus()` 是纯增量，不影响既有方法 | `src/casehall/client.ts`、`src/enterprise/client.ts` |
| 读 `Invoice.taxId` / `Invoice.bankAccount` 等 PII 字段 | **零代码改动** — 字段名 / wire-format 不变，仅 Javadoc 标注从"脱敏"升级为"keyVersion v1/v2 真加密 + AAD field binding"，运行时 transparent | `src/finance/types.ts` |
| 集成 v1.x 时按"`ROLE_ADMIN` 自动当 `platform_admin`"测试用例 | **必须改** — 删掉别名假设；测试角色显式写 `platform_admin` / `s2s` / `lawyer` / `consumer` 之一 | `docs/pii-role-matrix.md` §角色映射表 |

> v2.0.0 → v2.0.1 是纯 packaging fix（`package.json.files` 数组补 2 个 docs），无源码改动；从 v2.0.0 升 v2.0.1 不需要任何 review。

## 安装

```sh
npm install @acosmi/sdk-ts
```

## 快速开始

```ts
import { Client, allScopes } from '@acosmi/sdk-ts';

const client = new Client({ baseURL: process.env.ACOSMI_BASE_URL! });
await client.login('My App', allScopes());

const resp = await client.chat('claude-opus-4-7', {
  messages: [{ role: 'user', content: 'Hello' }],
  max_tokens: 1024, // ChatRequest 走 snake_case wire 字段（与上游 Go json tag 对齐）
  endUserId: 'user-abc-123', // v1.6.0+ 业务侧稳定 id, 启用上游隔离 / KV-cache / 调度策略
});
console.log(resp.content);
```

### Acosmi Gateway URL — `serverURL` / `baseURL` 公共契约 (v2.1+)

`Client` 配置中 `serverURL` / `baseURL` / `baseUrl` 三字段同语义、互为 alias，归一化后必须相等；任传其一即可，多写时 normalize 后冲突会立刻抛错。

```ts
// 推荐拼写
const client = new Client({ baseURL: 'https://acosmi.com' });

// 与历史 serverURL 完全等价
const same = new Client({ serverURL: 'https://acosmi.com' });

// 多写一致 OK; 不一致抛错
new Client({ serverURL: 'https://a.example', baseURL: 'https://b.example' });
// → Error: Acosmi Gateway URL conflict: …
```

**红线 (Phase 0 契约 §1-§2)** — Acosmi Gateway URL 是 `@acosmi/sdk-ts` 调 Acosmi nexus-v4 API 的根：

- 只接受 `http:` / `https:`；`ws:` / `wss:` 是 CrabCode `--sdk-url` RemoteIO 会话通道，**不是** SDK gateway URL，传入立刻抛错。
- agent-runs / managed-models / notifications WS / compliance 都从同一个 normalized base 派生；SDK 内部 `apiURL()` 自动追加 `/api/v4`，不会重复拼。
- 不推荐 runtime mutate `client.serverURL`；多 base 用 per-instance Client cache（例如 `Map<normalizedGatewayURL, Promise<Client>>`）。
- `complianceBaseURL` 是独立第二根地址，不被 `baseURL` alias 覆盖。

公共 helper：

```ts
import { Client, normalizeGatewayBaseURL, DEFAULT_GATEWAY_BASE_URL } from '@acosmi/sdk-ts';

normalizeGatewayBaseURL('https://gw.example/api/v4/'); // → 'https://gw.example/api/v4'
normalizeGatewayBaseURL('wss://session.example');      // → throw: only allows http/https
DEFAULT_GATEWAY_BASE_URL;                              // → 'https://acosmi.com'

const c = new Client({ baseURL: 'https://gw.example' });
c.getBaseURL();   // → 'https://gw.example'  (= c.getServerURL())
c.apiURL('/agent-runs'); // → 'https://gw.example/api/v4/agent-runs'
```

详见 `docs/audit/sdk-remote-control-contract-2026-05-27.md`。

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

## 图片 / 视频生成（托管模型网关，v2.2+）

图片生成、视频生成与文本对话**同属托管模型网关**（同一个 `Client`、同一套 `models:chat` 鉴权面），**不是工作流**。只有 `capabilities.supports_image_generation` / `supports_video_generation` 为真的模型可调；计费结算在营销系统，SDK / 网关只做调用与用量上报。

**先按 capability 筛模型**：

```ts
const models = await client.listModels();
const imageModel = models.find((m) => m.capabilities?.supports_image_generation);
const videoModel = models.find((m) => m.capabilities?.supports_video_generation);
```

> 这两个能力字段随 catalog 下发：`capabilities` 是 `ManagedModel` 的必填字段，`listModels` 对 `capabilities` 对象**原样透传**（保持 wire snake_case，不归一化为 camelCase）。字段为可选——上游未声明时为 `undefined`（按 false 处理），**严禁用模型名 substring 推断**。注意目前**没有**图片/视频生成的专用 catalog helper（不像 `inputModalities` 那条线有 `modelSupportsImageInput` 等），按上面直接读字段筛即可。

### 图片生成（同步）

`generateImage` 一次调用直接拿图（内部超时与 chat 同级 11min，容纳上游耗时；DashScope 万相图片在网关内部建任务并轮询到终态后同步返回，对 SDK 仍是一次调用）。

```ts
const img = await client.generateImage(imageModel!.id, {
  prompt: '一只在雪地里奔跑的柴犬，电影感光影',
  width: 1024,   // 缺省 1024
  height: 1024,  // 缺省 1024
  style: 'cinematic', // 可选
});
console.log(img.url ?? img.b64_json); // ImageGenerationResponse: url / b64_json / revised_prompt / requestId
```

### 视频生成（异步：建任务 → 轮询）

`generateVideo` 返回 `taskId`，再用 `pollVideoTask` 轮询到 `completed`。`durationSeconds` 务必回传创建时的秒数——网关在 `completed` 时据此上报真实视频时长用量。

```ts
const task = await client.generateVideo(videoModel!.id, {
  prompt: '海浪拍打礁石的慢镜头',
  resolution: '1280x720', // 可选
  duration: 5,            // 秒
});

let res = task;
while (res.status !== 'completed' && res.status !== 'failed') {
  await new Promise((r) => setTimeout(r, 3000));
  res = await client.pollVideoTask(videoModel!.id, task.taskId, 5); // 回传 duration=5
}
if (res.status === 'failed') throw new Error(res.error);
console.log(res.videoUrl); // VideoTaskResponse: taskId / status / videoUrl / error / requestId
```

**请求字段速查**

| | 图片 `ImageGenerationRequest` | 视频 `VideoGenerationRequest` |
| --- | --- | --- |
| 必填 | `prompt` | `prompt` |
| 尺寸 | `width` / `height`（缺省 1024） | `resolution`（如 `"1280x720"`） |
| 其他 | `style` | `duration`（秒） |

> 字段是网关**通用契约**；某厂商支持哪些取值由上游模型决定（如万相尺寸 `宽*高` 星号格式由网关代转）。网关适配范围：OpenAI 兼容图片 + 火山引擎（即梦/豆包）视频 + DashScope 通义万相（wanx）原生异步任务（图片+视频）。

## 思考档位 `thinking_levels`（v2.18+）

`ManagedModel.thinking_levels?: string[]` —— 该模型**可选的思考深度档位 id**，升序下发，取值是 `ThinkingOff` / `ThinkingHigh` / `ThinkingMax`（`'off'` / `'high'` / `'max'`）的子集。网关按「admin 声明 ∩ wire 层真投递」读时派生；`listModels` 对它**原样透传**（与 `supported_formats` / `preferred_format` 同为 wire snake_case，不做 camelCase 重映射）。

**三态必须分开处理 —— `[]` 与 `undefined` 不是同一件事**：

```ts
const m = (await client.listModels()).find((x) => x.id === modelId)!;
if (m.thinking_levels === undefined) renderThinkingUnknown();     // 旧网关未播报 → 按"未知"处理
else if (m.thinking_levels.length === 0) hideThinkingPicker();    // 该模型没有思考档 → 不渲染档位选择
else renderThinkingPicker(m.thinking_levels);                     // 升序档位, 原样渲染
```

缺失时**严禁**自己推档或按模型名 substring 猜 —— 档位值域归网关模型目录所有，靠运营动作扩张，不靠发 SDK 新版（同 `inputModalities` 开放值域的教训，见 v2.14.0）。该字段与 `capabilities.supports_thinking` / `supports_max_effort` 是**正交**两件事：后者描述模型有无该能力，前者描述**这条链路上此刻真能选哪几档**。

## 向量 / 重排序（托管模型网关，v2.9+）

向量（embedding）与重排序（rerank）走与 chat 同一套**会员计费**（Hold→Settle→Release，按 `total_tokens` 套 input 费率），上游接阿里云百炼 DashScope。仅 `capabilities.supports_embedding` / `supports_rerank` 的托管模型可用；具体上游模型名由管理员在后台自填。

### 向量（同步）

`embeddings` 一次调用拿向量，响应即 OpenAI `/v1/embeddings` 标准格式。

```ts
const models = await client.listModels();
const embModel = models.find((m) => m.capabilities?.supports_embedding);

const resp = await client.embeddings(embModel!.id, {
  input: ['第一段文本', '第二段文本'], // string 或 string[]
  dimensions: 1024,                   // 可选
});
console.log(resp.data[0].embedding);  // number[]
console.log(resp.usage.total_tokens);
```

### 重排序（同步）

`rerank` 传入 query + 候选文档，返回按相关性排序的下标与得分。

```ts
const rerankModel = models.find((m) => m.capabilities?.supports_rerank);

const resp = await client.rerank(rerankModel!.id, {
  query: '什么是文本排序模型',
  documents: ['文档A', '文档B', '文档C'],
  top_n: 3,              // 可选
  return_documents: true, // 可选：结果内回传文档原文
});
for (const r of resp.results) {
  console.log(r.index, r.relevance_score, r.document);
}
```

> 重排序对外是**统一扁平契约**；网关内部按模型绑定的线路（DashScope 原生嵌套 `gte-rerank-v2` / OpenAI 兼容扁平 `qwen3-rerank`）自动转换并归一化响应，SDK 侧无需关心。

### 多模态向量 / 重排序（v2.10+，text / image / video）

对接 DashScope `qwen3-vl-embedding`（多模态向量）与 `qwen3-vl-rerank`（多模态重排序）。向量用 `contents` 取代 `input`；重排序的 `query` / `documents` 接受多模态对象（`{ text? , image?, video? }`）。适用于自建搜索引擎的图文 / 视频检索。

```ts
// 多模态向量：图 / 视频 / 文本混合
const emb = await client.embeddings(mmEmbModel!.id, {
  contents: [{ text: '一只橘猫' }, { image: 'https://…/cat.png' }, { video: 'https://…/clip.mp4' }],
  output_type: 'dense', // 可选
  fps: 2,               // 可选：视频抽帧率
});

// 多模态重排序：query 与候选可为多模态对象，也可混入纯文本字符串
const rr = await client.rerank(mmRerankModel!.id, {
  query: { text: '红色跑车' },
  documents: [{ image: 'https://…/car.png' }, { video: 'https://…/road.mp4' }, '一段描述文字'],
  fps: 1.5, // 可选
});
```

> 文本调用完全向后兼容：`input` / 字符串 `query` / 字符串 `documents` 行为不变。多模态托管模型须由管理员在后台勾选对应能力位与输入模态（text/image/video）。

## 双格式红线（设计核心）

SDK 同时提供 **Anthropic + OpenAI 两条 endpoint**，**等地位**，对应两个不同下游产品。

| Adapter            | 端点                                  | 用途                                |
| ------------------ | ------------------------------------- | ----------------------------------- |
| `AnthropicAdapter` | `POST /managed-models/:id/anthropic`  | Anthropic 原生格式（含 thinking 等）|
| `OpenAIAdapter`    | `POST /managed-models/:id/chat`       | OpenAI 兼容格式（DeepSeek/GLM 等）  |

路由由 `getAdapterForModel(model)` 按 ManagedModel 的 `preferred_format` / `supported_formats` 决策（wire-format 字段，snake_case 与上游 Go json tag 严格对齐；ManagedModel 上其余顶层字段如 `modelId` / `isEnabled` / `inputModalities` 走 camelCase，详见 `src/models/types.ts`）：

1. `preferred_format` 非空 **且**该格式在 `supported_formats` 内（或 `supported_formats` 未声明）→ 按值（`anthropic` | `openai`）
2. `supported_formats` 含 `anthropic` → AnthropicAdapter
3. `supported_formats` 含 `openai` → OpenAIAdapter
4. 两字段均空（旧上游）→ 按 `provider` 名回落

> **格式一致性护栏（v2.5.1）**：第 1 步收紧后，`preferred_format` 与 `supported_formats` 矛盾时（如 `preferred_format=anthropic` 但 `supported_formats=[openai]`）不再盲信 `preferred_format`，而落到第 2/3 步按实际支持的格式选择，避免路由到模型并不支持的端点。`supported_formats` 未声明（旧上游）时 `preferred_format` 仍直接采信，向后兼容。

`client.chat()` / `client.chatStream()` 内部自动调 `getAdapterForModel`，使用方无需关心。

## 多端

| 平台            | HTTP   | SSE              | WebSocket                                | TokenStore                       |
| --------------- | ------ | ---------------- | ---------------------------------------- | -------------------------------- |
| 浏览器          | fetch  | ReadableStream   | WebSocket                                | `LocalStorageTokenStore`         |
| Node ≥18        | fetch  | ReadableStream   | WebSocket（Node 22+）/ `ws`（18-21 自装）| `FileTokenStore` (~/.acosmi/)    |
| Deno / Bun      | fetch  | ReadableStream   | WebSocket                                | File                             |

构建产物：`dist/{node,browser}/` 各自 ESM + CJS + `.d.ts`，主入口约 120 KB。

> **安全权衡（集成方必读）**：
> - **浏览器 `LocalStorageTokenStore`**：token 落在 `localStorage`，受同源 XSS 威胁可被读取，且不随标签页关闭清除。仅在可接受该风险的场景使用；高安全场景应改用内存 store + 服务端 session/同源代理（Route Handler）持有 token。
> - **Notifications WebSocket 把 token 放 URL query（`?token=`）**：query string 可能进入 nginx access log / 代理日志 / 浏览器历史。浏览器端 WebSocket 无法设自定义 header 是此设计的根因；Node 环境（`ws` 包支持 `options.headers`）应优先 header 或 `Sec-WebSocket-Protocol` 子协议承载 token，部署上需对 WS 端点关闭 query 日志。

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

### 上游活性回调 `onUpstreamActivity`（v2.16+）

如果你的集成层自带**流空闲看门狗**（"多久没收到事件就判定连接死了"），必须接这个回调，否则看门狗会误杀健康连接。

SSE 上有两类**有字节、无事件**的情形，看门狗对它们完全失明：

1. 上游（如 DeepSeek）与网关在开始推理前发的保活注释行 `: keep-alive` —— 按 SSE 规范它们不构成事件，被 `isSSECommentLine` 跳过；
2. OpenAI 格式下 converter 对某些 data 行返回零事件。

两种情形连接都健康、字节都在流动。**心跳只有在抵达做判决的那一层时才叫心跳** —— 网关补了心跳而 SDK 吞掉，等于没补。

```ts
let lastActivity = Date.now();

const stream = client.chatMessagesStream(
  modelId,
  { messages, max_tokens: 4096 },
  abortSignal,
  () => { lastActivity = Date.now(); },   // ← 每条 SSE 行触发一次，含注释行
);
```

语义是「链路刚刚有动静」，不是「来了一个事件」；对每条 SSE 行触发一次，早于任何过滤与解析。回调抛出的错误会被吞掉且不中断流（旁路信号不该有能力杀死主链路）。不传时行为逐字节不变。

### 网关请求 ID 回调 `onGatewayRequestID`（v2.19+）

如果你要把**用户可见的失败**关联回上游那一次网关调用与它产生的计费行，接这个回调。

网关在响应头 `X-Acosmi-Request-Id`（常量 `GATEWAY_REQUEST_ID_HEADER`）里下发 `consumeRequestID` —— 它就是 `managed_model_usage_logs.request_id` 的值，是能 join 到计费行的那个键。

> ⚠️ 它**不是**网关的传输层 `X-Request-ID`。那一个独立生成、从不写进任何计费表，两者永不相等。用错的后果是恒空 join —— 不报错，只是下次事故照样查不动。

```ts
let gatewayRequestId: string | undefined;

const stream = client.chatMessagesStream(
  modelId,
  { messages, max_tokens: 4096 },
  abortSignal,
  onUpstreamActivity,
  id => { gatewayRequestId = id; },   // ← 响应头到达时触发，早于第一个事件
);
```

回调在响应头到达后触发**至多一次**，且在第一个 SSE 事件之前 —— 因此它覆盖「流中段被掐断」「上游 200 但零事件」「HTTP 错误」全部形态；流内事件在「事件根本没来」的场景里恰恰不存在，而那正是最需要诊断的那一种。

同步路径 `chatMessages` / `chat` 的第 4 个实参是同一个回调。

网关没下发（旧版本 / 非托管路径）时回调**一次都不触发**，SDK 绝不合成占位值；流照常出。浏览器端消费方还需网关 CORS `Access-Control-Expose-Headers` 放行该头（网关 v2026-09-01 起已放行）。

### Sources SSE 四态分类（v2.15+）

`sources: []` 是检索成功但没有可展示引用的合法零结果，不是传输损坏。需要精确区分状态的新 consumer 使用加性接口 `classifySourcesEvent()`：

```ts
import { classifySourcesEvent, type StreamEvent } from '@acosmi/sdk-ts';

function consume(event: StreamEvent) {
  const result = classifySourcesEvent(event);
  switch (result.kind) {
    case 'not_sources':
      return; // 交给其他 SSE 事件处理器
    case 'empty_sources':
      return; // 合法 no-op；不得升级为 turn/runtime fatal
    case 'sources':
      renderSources(result.value.sources);
      return;
    case 'malformed_sources':
      recordCompatibilityCode(result.code); // 只记录稳定机器码，不记录来源内容
  }
}
```

分类器同时识别 SSE `event: sources` 和 JSON payload `type: "sources"`，校验数组、item、`title`、`url`、可选 `snippet` 与 `session_id` 的类型，并允许未知额外字段。JSON 无法解析但 SSE 已声明为 sources 时返回 `malformed_sources/invalid_json`。

`parseSourcesEvent()` 保留给既有集成：它仍按历史宽松规则解析，空数组、缺失数组、非 sources 或 JSON 损坏仍返回 `null`，非空时仍只返回 `{ sources, session_id }`。它没有改为调用严格分类器，避免严格字段校验改变旧 consumer 对历史/第三方 frame 的接受范围。升级到 2.15.0 不要求关联方迁移；只有需要四态语义的调用方才采用新 API。

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

### 远程控制 — CrabCode remote-control（v2.1.0）

远程控制是 Agent Run 的一个独立 runtime（`runtime: 'crabcode_remote'`），用于把 CrabCode 子进程的会话/工具/权限循环经服务端适配成 C 端可消费的事件流。它**不复用** `agentRuns.stream` 的旧事件 union，事件协议另成一套（契约 §4 的 11 事件）。

```ts
import { Client, remoteControlScopes } from '@acosmi/sdk-ts';

const client = new Client({ baseURL: process.env.ACOSMI_BASE_URL! });
// 远控是高风险 scope，不在 allScopes() 内，必须显式申请
await client.login('CrabCode Remote', remoteControlScopes());

const run = await client.agentRuns.createRemoteRun({
  appId: 'crabcode',
  input: '重构这个函数并跑测试',
  runtime: 'crabcode_remote', // 固定值
  runner: 'cloud',            // 'cloud' | 'desktop' | 'local_embedded'
  adapter: 'remote_io',       // 6 选 1，见下表
  permissionPolicy: { shellAllowed: true, shellDenyList: ['rm', 'shutdown'], approvalTimeoutMs: 30_000 },
  workspacePolicy: { readOnly: false, deniedPaths: ['/etc', '/root'] },
});

for await (const ev of client.agentRuns.streamRemoteControl(run.runId)) {
  switch (ev.type) {
    case 'text_delta':         process.stdout.write(ev.text); break;
    case 'permission_request': // 渲染审批卡片后回写决策 (仅 approved|rejected, 契约 §14)
      await client.agentRuns.submitPermissionResult(run.runId, {
        requestId: ev.requestId, decision: 'approved',
      });
      break;
    case 'settle':             console.log('billed', ev.billed); break;
  }
}

// 会话中途追加用户消息 (role 服务端硬编码 user, ≤64KB)
await client.agentRuns.submitUserMessage(run.runId, { content: '继续, 用方案B' });

await client.agentRuns.cancel(run.runId); // UI 中止走服务端 cancel control frame，不是 fetch abort
```

#### 远控管理面（v2.7.0）

| 方法 | 端点 | 说明 |
| --- | --- | --- |
| `agentRuns.list(opts?)` | `GET /agent-runs` | 调用者自己的 run 列表（新→旧）；`{ runtime: 'crabcode_remote' }` 过滤远控 run，分页 `{records,total,page,pageSize}`。view 只含元数据，永不含 session token / policy / messages（契约 §6） |
| `agentRuns.submitPermissionResult(runId, {requestId, decision, reason?})` | `POST /:runId/permission-results` | 回写 `permission_request` 决策；仅 `approved` \| `rejected`（`timeout`/`cancelled` 由服务端产生）。409 = 远控会话已不可用 |
| `agentRuns.submitUserMessage(runId, {content, requestId?})` | `POST /:runId/messages` | 会话中途追加用户消息；role 服务端硬编码 `user`（契约 §6 #5 防注入），返回服务端最终幂等键 |
| `agentRuns.revealRemoteToken(runId)` | `POST /:runId/remote-token` | **仅 desktop runner / desktop launcher 用**：一次性 session token（重复调用 409）。token 永不落浏览器存储，native 层接收后只注入 CrabCode 子进程 env；响应含 `workspace`（用户声明的项目目录，契约 §18.3 r4） |

**metadata 约定键（契约 §18.3 r4）**：`metadata.title`（列表显示标题，缺省服务端从 input 首行派生）、`metadata.workspace`（期望项目目录，经 `revealRemoteToken().workspace` 下发给桌面端采纳）。常量 `AGENT_RUN_META_TITLE` / `AGENT_RUN_META_WORKSPACE`。服务端上限 ≤32 条 / 键 ≤64B / 值 ≤2KB。

#### BYOK — 用户自有模型密钥（v2.7.0，契约 §18.2）

`client.crabcodeByok` 管理 BYO 模型密钥（守卫 `remote_control` scope）；创建后把 `credentialRef` 传给 `createRemoteRun({ byokCredentialRef })`（仅 `runner: 'cloud'`）。明文一次性提交、服务端加密落库后即弃，所有读取只回 masked 视图（ref + fingerprint）——解密只发生在网关 cloud runner 启动时的子进程 env 注入点。

```ts
const cred = await client.crabcodeByok.create({
  provider: 'deepseek',          // anthropic|openai|deepseek|dashscope|zhipu|volcengine|custom
  plaintext: process.env.MY_KEY!, // 一次性提交; SDK/服务端永不回传
  name: '我的 DeepSeek 钥匙',
});
await client.agentRuns.createRemoteRun({
  appId: '', input: '…', runtime: 'crabcode_remote', runner: 'cloud', adapter: 'remote_io',
  byokCredentialRef: cred.credentialRef,
});
await client.crabcodeByok.rotate(cred.credentialRef, 'sk-new'); // ref 不变, fingerprint 更新
await client.crabcodeByok.revoke(cred.credentialRef);           // 软吊销 + 抹密文, 幂等
```

要点：

- **scope 隔离**：远控用专用 `remote_control` scope（服务端展开为 `remote_control:{agent-run,session-control,permission-response}` 三子项）；**绝不复用** `models:chat`/`ai`，且 `allScopes()` 不含它——桌面登录不会自动获得远控权限。用 `remoteControlScopes()` 或显式 `[...allScopes(), ScopeRemoteControl]`。
- **adapter / runner**（`AdapterKind` / `RunnerKind`，契约 §3 placement 矩阵）：

  | adapter | 适用 |
  | --- | --- |
  | `remote_io` | 单次纯会话流（CrabCode `--sdk-url` ws/wss） |
  | `app_server_tcp_ws` | Desktop 已登录、本机 AppServer loopback RPC |
  | `bridge_ccr` | 云端/托管 runner，session pool + heartbeat |
  | `app_server_uds` / `stdio_stream_json` | 同机父子进程内嵌 |
  | `tauri_managed_app_server` | Tauri native 托管 lifecycle |

- **wire 约定（契约 §12-§14，按平面分）**：远控属 **snake_case 平面**——`permissionPolicy`/`workspacePolicy` 等 SDK camelCase 入参由 SDK 翻译为 snake_case wire（`shell_allowed`/`approval_timeout_ms`/`denied_paths`…）；时长一律**整数毫秒**（`approvalTimeoutMs`，禁 `time.Duration` 上 wire）。事件帧为**扁平信封**（`type`+`seq`+字段同级，snake_case），SDK 用 `parseRemoteControlEvent(raw)` 翻译为强类型 `RemoteControlEvent`。
- **11 事件 union**（`RemoteControlEvent`，契约 §4）：`text_delta` / `reasoning_delta` / `tool_call` / `tool_result` / `permission_request` / `permission_result` / `usage` / `settle` / `status` / `error` / `done`。`error` **恒为非终结**（终结性错误由 `done.reason`/`done.finalStatus` 承载），`done` / `settle` 才终结流——故 `streamRemoteControl` 不接受 options、从不抛异常；用 `isTerminalRemoteEvent(ev)` 判终结。
- **辅助导出**：`parseRemoteControlEvent` / `isTerminalRemoteEvent` / `AdapterKind` / `RunnerKind` / `RemoteControlEvent` / `RemoteSessionPlacement` / `PermissionPolicy` / `WorkspacePolicy`（`src/agent-runs/remote-control.ts`）。

## Chat Bridge（第三方聊天平台桥接，v2.7.0 · Phase 7B 管理面 CRUD 落地）

`client.chatBridge` 提供第三方聊天平台（飞书/企微/钉钉/Slack/Teams/Telegram/WhatsApp）集成与凭证的管理面 CRUD。**云端控制台与下游（CrabCode 等）调的是同一组端点、同一份按租户隔离的数据**——任一端创建/修改，另一端即时可见，无需同步机制。平台 webhook adapter（验签/收发消息）是 Phase 8 后端工作，SDK 不承载。

```ts
import { Client, chatBridgeScopes } from '@acosmi/sdk-ts';

const client = new Client({ baseURL: process.env.ACOSMI_BASE_URL! });
// chat_bridge 是高风险 scope, 不在 allScopes() 内, 必须显式申请
await client.login('CrabCode 平台接入', chatBridgeScopes());

// 1. 创建集成 (chat_bridge:write); 平台原始 ID 服务端只存 SHA256 hash
const integ = await client.chatBridge.createIntegration({
  appId: 'crabcode', platform: 'feishu', region: 'cn',
  workspaceId: 'ou_xxx', botId: 'cli_xxx',
});

// 2. 存凭证 (明文一次性提交; 响应恒为 masked 视图, 永不回明文/密文)
const cred = await client.chatBridge.storeCredential(integ.id, {
  secretKind: 'app_secret', plaintext: process.env.FEISHU_SECRET!,
});

// 3. 激活
await client.chatBridge.updateIntegrationStatus(integ.id, 'active');

// 查询 (chat_bridge:read) / 轮换与吊销 (chat_bridge:rotate, 高风险独立 scope)
await client.chatBridge.listIntegrations('crabcode');
await client.chatBridge.listCredentials(integ.id);
await client.chatBridge.rotateCredential(integ.id, 'app_secret', 'new-secret');
await client.chatBridge.revokeCredential(cred.credentialRef);
```

类型守卫与 branded ref 仍从根入口导出：

```ts
import { isPlatform, asCredentialRef, type Platform } from '@acosmi/sdk-ts';
isPlatform('feishu');             // → true（7 平台枚举运行时守卫）
asCredentialRef('cred_abc...');   // → branded CredentialRef（防 plaintext 误传）
```

边界（契约 §6 + §12 + §16）：

- 平台 secret（bot token / signing key / AES key）**只在 `storeCredential`/`rotateCredential` 请求体出现一次**，服务端加密落库后即弃；SDK 公共面只见 `CredentialRef`（`cred_<base32>`）+ `fingerprint` + 脱敏 metadata，**永不**出现 ciphertext / plaintext（`ChatCredentialPublic` 编译期即无密文字段）。
- **wire 平面**：请求体为 snake_case（SDK 自动转换），响应资源视图走 nexus-v4 model-direct 序列化为 **camelCase**（与 remote-control 的 snake_case 平面不同，详见契约 §12）。`ChatIntegration.configJson` 服务端从不返回（`json:"-"`），写入走 `createIntegration({ configJson })`。
- 平台原始 thread / sender / workspace ID 一律 SHA256 hash 后入库（`threadHash`/`senderHash`/`workspaceIdHash`）。
- scope 三档最小授权：`chat_bridge:read`（查询）/ `chat_bridge:write`（创建集成/存凭证）/ `chat_bridge:rotate`（轮换/吊销，高风险）；分组 scope `chat_bridge` 自包含三子项。跨租户引用服务端一律 404。

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

> **state 语义（v2.17.0 起）**：桌面 loopback 流程自动生成 32 字节随机 `state` 并对 `/callback` 的一切形态先行校验 —— 恰好一个且严格等值，缺失 / 重复 / 错值一律以错误码 `state_mismatch` 拒绝本次登录并关闭 listener（含携带 OAuth error 的回调；用户真拒绝须回传正确 state 才结算为 `auth_denied`）。调用方零改动：`state` 由 SDK 内部管理，不出现在 `authorize()` 的公开签名里。授权服务器按 RFC 6749 §4.1.2.1 在**错误响应**上也必须原样回传 `state`（Acosmi 官方 consent 页已适配）。
>
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
| **图片 / 视频生成**（v2.2.0+） | `generateImage`（同步）, `generateVideo`（建异步任务）, `pollVideoTask`（轮询）；仅 `capabilities.supports_image_generation` / `supports_video_generation` 模型可用 |
| **向量 / 重排序**（v2.9.0+） | `embeddings`（同步）, `rerank`（同步）；仅 `capabilities.supports_embedding` / `supports_rerank` 模型可用 |
| **Agent Runs** | `agentRuns.create`, `agentRuns.stream`, `agentRuns.run`, `agentRuns.cancel`, `agentRuns.get`, `agentRuns.listArtifacts`, `agentRuns.downloadArtifact`, `agentRuns.submitLocalToolResult`, `agentRuns.runWithLocalTools` |
| **Agent Runs — 远程控制**（v2.1） | `agentRuns.createRemoteRun`, `agentRuns.streamRemoteControl`；helper：`parseRemoteControlEvent`, `isTerminalRemoteEvent`；scope：`remoteControlScopes()` / `ScopeRemoteControl`（不进 `allScopes()`） |
| **Chat Bridge**（v2.1 · types-only） | 无 client 方法（Phase 7B 后端落地）；导出类型守卫 `isPlatform`, `isRegion`, `isIntegrationStatus`, `isChannelInboundEvent`, `asCredentialRef` |
| **Auth — 内置 Loopback OAuth** | `login`, `loginWithHandler`, `logout`, `ensureToken`, `forceRefresh`, `isAuthorized`, `getTokenSet` |
| **Auth — 手动 OAuth 原语** | `discover`, `discoverWithProfile`, `register`, `authorize`, `exchangeCode`, `refreshToken`, `revokeToken`, `generateState` |
| **Auth — 浏览器 Web OAuth (v1.4.0+)** | `discoverWebOAuthMetadata`, `registerWebOAuthClient`, `createWebAuthorizationRequest`, `completeWebAuthorizationRequest` |
| **Models**   | `listModels`, `listModelsWithStatus`, `getModelCapabilities`, `getQuotaSummary`, `ensureModelCached`, `modelSupportsInputModality`, `modelSupportsImageInput`, `findFirstModelByInputModality`, `findDesktopVisualUnderstandingModel` |
| **Skills**   | `browseSkillStore`, `browseSkills`, `browseSkillsList`, `getSkillDetail`, `getSkillSummary`, `resolveSkill`, `installSkill`, `downloadSkill`, `uploadSkill`, `generateSkill`, `optimizeSkill`, `validateSkill`, `certifySkill`, `getCertificationStatus` |
| **Tools**    | `listTools`, `getTool`                                                               |
| **Wallet**   | `getWalletStats`, `getWalletTransactions`                                            |
| **Entitlements** | `getBalance`, `getBalanceDetail`, `listEntitlements`, `listConsumeRecords`, `claimMonthlyFree`, `getByModel`, `listBuckets`, `listCoefficients`, `invalidateCoefficientCache` |
| **Entitlements — 窗口重置券**（v2.13.0+） | `getWindowResetSummary`（邀请奖励券总览）, `redeemWindowReset`（核销一张券清空当前窗口已用量；`clientRequestId` 为幂等键） |
| **Packages** | `listTokenPackages`, `getTokenPackageDetail`, `buyTokenPackage`, `getOrderStatus`, `listMyOrders`, `waitForPayment` |
| **Notifications** | `listNotifications`, `getUnreadCount`, `markNotificationRead`, `markAllNotificationsRead`, `deleteNotification`, `registerDevice`, `unregisterDevice`, `listNotificationPreferences`, `updateNotificationPreference` |
| **Notifications — WebSocket** | `connect`, `disconnect`, `isConnected` (实时推送订阅；浏览器走原生 WebSocket，Node 18-21 需自装 `ws`，Node 22+ 用原生) |
| **Bug Report** | `submitBugReport`, `getBugReport`                                                  |
| **Web Search** | `newWebSearchTool` (factory)                                                       |
| **Subscription**（v1.7.0+；v2.6.0 +会员查询） | `listPlans`, `getPlanByCode`（v2.1+）, `getMembership`（v2.6+）, `getSubscriptionTier`（v2.6+）, `subscriptionPrecheck`（v2.6+）, ~~`listUserSubscriptions`~~（deprecated，改用 `getMembership`） |
| **Pricing**（v1.7.0+） | `getPricingConfig`, `quoteCompliance`                                            |
| **Products**（v1.7.0+） | `getProductBySlug`, `listProductsByFamily`, `listComplianceSkus`, `listPublicModels` |
| **Casehall — 法律案件**（v1.8.0+） | `listLawyers`, `getLawyer`, `submitCaseLead`, `listMyCaseLeads`, `getMyCases`, `bookConsultation`, `listMyConsultations`, `listMyLegalOrders`, `listLegalSKUs`, `getMyLawyerCredentialStatus`（v2.0.0+） |
| **Enterprise — 企业席位**（v1.8.1+） | `listMyEnterprises`, `getEnterprise`, `inviteMember`, `listEnterpriseMembers`, `listOrgSubscriptions`, `listSeats`, `assignSeat`, `revokeSeat`, `getOrgConsumeReport`, `getMyEnterpriseKycStatus`（v2.0.0+） |
| **Finance — 财务**（v1.9.0+） | `listMyInvoices`, `requestInvoice`, `listMyRefunds`, `requestRefund`, `listMyCorporateTransfers`, `initiateCorporateTransfer`, `uploadCorporateTransferProof` |
| **Compliance — 证据 / 章戳 / 公开验真** | `compliance.createEvidenceAsset`, `compliance.getEvidenceAsset`, `compliance.verifyEvidencePublic`（匿名公开验真，v1.3.2+）, `compliance.issueTimestamp`, `compliance.issueTimestampForAsset`, `compliance.getTimestamp`, `compliance.verifyTimestamp`, `compliance.waitForTimestampVerified`, `compliance.buildEvidencePackage` |
| **Compliance — 报告** | `compliance.createReport`（写，带 `Idempotency-Key`）, `compliance.getReport`, `compliance.publishReport`（step-up + 写）, `compliance.downloadReport` |
| **Compliance — 签署 envelope** | `compliance.createSigningEnvelope`（写）, `compliance.getSigningEnvelope`, `compliance.signEnvelope`（step-up + gate + 写）, `compliance.createH5SigningUrl`（step-up + gate + 写）, `compliance.syncSigningEnvelopeStatus`（写） |
| **Compliance — 用印审批** | `compliance.submitSealApproval`（写）, `compliance.approveSealApproval`（step-up + 写）, `compliance.rejectSealApproval`（写）, `compliance.cancelSealApproval`（写）, `compliance.listPendingSealApprovals`, `compliance.getSealApproval` |
| **Compliance — Provider Request** | `compliance.getProviderRequest`, `compliance.waitForProviderRequestTerminal`, `compliance.classifyError` |
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
// WalletStats 金额字段是 number（Go float64 端点 wallet.go；非 json.Number）
const stats = await client.getWalletStats();
// { balance: 100.0, monthlyConsumption: 32.5, monthlyRecharge: 150.0, transactionCount: 12 }

const balance = await client.getBalance();             // 聚合权益余额（EntitlementBalance）

const pkgs = await client.listTokenPackages();
// PayPayload.paymentMethod 取枚举字面量（'WECHAT_NATIVE' | 'ALIPAY_PRECREATE' | 'BANK_TRANSFER'）
const order = await client.buyTokenPackage(pkgs[0].id, { paymentMethod: 'WECHAT_NATIVE' });
// BuyResponse 用 orderId（number）/ orderNo（string），无 .id；waitForPayment 取 string
const status = await client.waitForPayment(String(order.orderId), 2000);  // 2s 轮询直到终态
```

> ⚠️ **额度单位双体系（务必区分，不要跨单位相加）**：`getBalance` / `getBalanceDetail` /
> `listEntitlements` / `getMembership` 返回的 `token*` 字段（`tokenQuota`/`tokenRemaining`/
> `tokenUsed`/`tokenTotal`）单位**取决于权益是否付费**：
>
> - **免费档（TK 体系）**：`type` 非 `TOKEN_PACKAGE`/`SUBSCRIPTION` 的权益（每月领取的免费额度等），
>   数值即**原始 Token**，UI 以「千万/万 Token」展示。免费额度通过 `claimMonthlyFree()` 领取。
> - **付费会员（Credits 代币体系）**：`type` 为 `TOKEN_PACKAGE` / `SUBSCRIPTION` 的权益，数值是
>   **微 Credits**，**÷1000 = Credits（代币）**，UI 以「亿/万 Credits」展示。各档位标准额度
>   （BASIC 0.6 亿 / PRO 3 亿 / PRO_MAX 9 亿 / ULTRA 24 亿 Credits）即按 Credits 计。
>
> 因此**绝不能把免费区与付费区的 `token*` 数值直接求和**——两者单位不同（Token vs 微Credits）。
> 判定付费区的唯一判据是权益 `type ∈ {TOKEN_PACKAGE, SUBSCRIPTION}`。`getMembership()` 的
> `tokenQuota`/`tokenUsed` 在有活跃付费订阅（`hasActive=true`）时同为微 Credits。

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

标注约定：
- `// 写` — POST / PUT / DELETE 写操作，**必传 `Idempotency-Key`**（即第二参数 `options?: ComplianceWriteOptions` 的 `idempotencyKey` 字段）；写操作不自动 retry，401 不 refresh + replay
- `// step-up` — 需 OAuth token 升级等级；失败抛 `BusinessError` 含 code `1031000013`，调用方按 `classifyComplianceError` 分支引导用户重新 introspection
- `// gate` — 受 capability gate 控制，未闭合时 fail-closed；先用 `getCapabilities` / `getFeatureGate` 探测
- `// 分页` — 走 `GET .../page` 返回 `PageResult<T>`（`{ total, list }`）
- 无标注 — GET 读路径，单次 401 refresh 重试

#### 证据资产（evidence）

```ts
client.compliance.createEvidenceAsset(req, options?)        // 写
client.compliance.getEvidenceAsset(id, signal?)
client.compliance.verifyEvidencePublic(req, signal?)        // 匿名公开验真（未 login 不抛 not-authorized）
client.compliance.listEvidenceAssets(req?, signal?)         // 分页
client.compliance.listEvidencePackages(req?, signal?)       // 分页
client.compliance.buildEvidencePackage(assetId, timestampTokenId?, options?)  // 写
```

#### 时间章（timestamp）

```ts
client.compliance.issueTimestamp(req, options?)                       // 写
client.compliance.issueTimestampForAsset(assetId, options?)           // 写
client.compliance.getTimestamp(id, signal?)
client.compliance.verifyTimestamp(req, options?)                      // 写（远端 verify 落审计）
client.compliance.waitForTimestampVerified(id, opts?)
client.compliance.listTimestamps(req?, signal?)                       // 分页
client.compliance.listTsaProviders(signal?)                           // TSA provider 只读列表
client.compliance.getTsaStats(signal?)                                // 时间章统计只读视图
```

#### 出证报告（report）

```ts
client.compliance.createReport(req, options?)               // 写，需 compliance:reports:write
client.compliance.getReport(id, signal?)
client.compliance.publishReport(id, options?)               // 写 + step-up
client.compliance.downloadReport(id, signal?)               // 离线复核 hash 视图
client.compliance.listReports(req?, signal?)                // 分页
```

#### 签署 envelope

```ts
client.compliance.createSigningEnvelope(req, options?)                 // 写
client.compliance.getSigningEnvelope(envelopeId, signal?)
client.compliance.signEnvelope(envelopeId, req, options?)              // 写 + step-up + gate
client.compliance.createH5SigningUrl(envelopeId, req, options?)        // 写 + step-up + gate
client.compliance.syncSigningEnvelopeStatus(envelopeId, options?)      // 写
client.compliance.listSigningEnvelopes(req?, signal?)                  // 分页
client.compliance.listEnvelopeContracts(envelopeId, signal?)           // 合同列表（数组，非 PageResult）
client.compliance.listEnvelopeProviderRequests(envelopeId, signal?)    // provider 请求列表（数组，非 PageResult）
client.compliance.voidEnvelope(envelopeId, req, options?)              // 写
```

#### 用印审批（seal approval / seal use）

```ts
client.compliance.submitSealApproval(req, options?)         // 写
client.compliance.approveSealApproval(id, query, options?)  // 写 + step-up
client.compliance.rejectSealApproval(id, query, options?)   // 写
client.compliance.cancelSealApproval(id, query, options?)   // 写
client.compliance.listPendingSealApprovals(signal?)
client.compliance.getSealApproval(id, signal?)
client.compliance.listSealApprovals(req?, signal?)          // 分页
client.compliance.listSealUses(req?, signal?)               // 分页（用印执行）
```

#### Provider request 状态轮询

```ts
client.compliance.getProviderRequest(id, signal?)
client.compliance.waitForProviderRequestTerminal(id, opts?)
```

#### 能力闸门 / 操作投影

```ts
client.compliance.getCapabilities(signal?)                  // 能力闸门列表（拿不到必须 fail-closed）
client.compliance.getFeatureGate(action, signal?)           // 单动作能力（便捷，一次网络请求）
client.compliance.listOperations(req?, signal?)             // 分页（操作投影）
client.compliance.getOperation(id, signal?)
client.compliance.classifyError(err)                        // BusinessError → ComplianceErrorInfo | null（同顶层 classifyComplianceError，便于 catch 块链式调用）
```

#### 合同模板（contract template，v1.5.0 S5）

```ts
client.compliance.createContractTemplate(req, options?)               // 写，DRAFT
client.compliance.updateContractTemplate(id, req, options?)           // 写（仅 DRAFT）
client.compliance.deleteContractTemplate(id, options?)                // 写（仅 DRAFT）
client.compliance.getContractTemplate(id, signal?)                    // 模板详情
client.compliance.listContractTemplates(req?, signal?)                // 分页
client.compliance.uploadContractTemplatePdf(id, req, options?)        // 写（上传 PDF base64）
client.compliance.publishContractTemplate(id, options?)               // 写，DRAFT → PUBLISHED
client.compliance.archiveContractTemplate(id, options?)               // 写，PUBLISHED → ARCHIVED
client.compliance.listContractTemplateVersions(id, signal?)           // 版本快照列表（数组）
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
| 2.19.0 | **当前版本** | **网关消费请求 ID 透出（2026-09-01）**。网关把 `consumeRequestID`（即 `managed_model_usage_logs.request_id`）放进 `X-Acosmi-Request-Id` 响应头；加性导出 `GATEWAY_REQUEST_ID_HEADER` 与 `GatewayRequestIDCallback`，`chatMessagesStream` / `chatStream` 新增第 5 个可选实参、`chatMessages` / `chat` 新增第 4 个可选实参。响应头在首字节之前到达，因此覆盖流中段中断 / 零事件 / HTTP 错误全部形态。旧网关下回调零触发、绝不合成占位值，流照常出。不传回调时行为逐字节不变。 |
| 2.18.0 | 稳定版 | **`ManagedModel.thinking_levels` 类型面对齐（2026-08-29）**。加性新增可选字段 `thinking_levels?: string[]`：网关下发的升序思考档位 id 列表（`'off'`/`'high'`/`'max'` 的子集，按「admin 声明 ∩ wire 层真投递」派生）。`listModels` 原样透传，无归一化、无新方法、公开签名零变化。`[]` = 该模型无思考档；`undefined` = 旧网关未播报，调用方按"未知"处理，严禁按模型名推档。 |
| 2.17.0 | 稳定版 | **桌面 loopback OAuth state 全路径闸 + 端口确定性关闭（2026-08-15）**。`/callback` 一切形态（成功 / OAuth error / 畸形）先验 `state` 且必须恰好一个并严格等值；缺失 / 重复（含重复的正确值）/ 错值一律 `state_mismatch` 拒绝且不再被误结算为 `auth_denied`；错误信息只描述形态，不回显 code / state / token / 完整 callback query。`finally` 补 `closeIdleConnections()`（Node 18 上 `close()` 不关残留 idle keep-alive）。用户真拒绝（OAuth error + 正确 state）语义保留为 `auth_denied`。公开 API 签名零变化。 |
| 2.16.0 | 稳定版 | **chat 超时预算真正下传 + 流式活性回调（2026-08-06）**。`chat` / `chatMessagesAnthropic` / `chatMessagesOpenAI` / `generateVideo` 此前漏传 `doJSONFullRaw` 的第 5 实参，内层 **30 秒**默认值恒先于外层 11 分钟预算触发 —— v1.6.0 那次"调整为 11min"一天都没生效过（生产实证：单日 29 条 latency≈30 000 ms 的 499，横跨 4 厂商 5 模型，受害最重的是默认主循环模型）。加性导出 `CHAT_REQUEST_TIMEOUT_MS`；`chatStream` / `chatMessagesStream` 新增第 4 个可选实参 `onUpstreamActivity`，让被 `isSSECommentLine` 吞掉的保活注释行（以及 OpenAI 格式下零事件的 data 行）能抵达消费方的空闲看门狗。不传回调时行为逐字节不变。 |
| 2.15.0 | 稳定版 | **sources 四态分类与零结果契约（2026-08-02）**。加性新增 `classifySourcesEvent`、`SourcesEventParseResult` 与稳定 issue code，区分非 sources、合法空结果、有效结果和结构损坏；未知额外字段继续兼容。既有 `parseSourcesEvent` 的返回形状、宽松解析和 `null` 条件保持不变。 |
| 2.14.0 | 稳定版 | **托管模型 input modalities 开放值域（2026-08-02）**。snake_case/camelCase 归一规则对称，数据字段允许未来新增标签；查询 API 仍保留已知标签自动补全。现网 camelCase 路径行为不变。 |
| 2.13.0 | 稳定版 | **邀请奖励窗口重置券（2026-08-01）**。加性新增窗口重置券总览与幂等核销 API，不改变既有 token、额度和会员调用。 |
| 2.12.0 | 稳定版 | **5 小时窗口软限额（2026-07-11）**。加性透传 `windowOverridable`、继续开关与结构化状态；老网关缺字段时按硬等待处理。 |
| 2.11.0 | 稳定版 | **窗口限额结构化承接（2026-07-09）**。加性新增 `WINDOW_LIMIT_EXCEEDED` 机器码、窗口种类/恢复时间及识别辅助函数，并修复扁平 `/chat` 错误消息解析。 |
| 2.10.0 | 稳定版 | **多模态向量与重排序（2026-06-20）**。加性扩展 text/image/video 输入；文本调用保持兼容。 |
| 2.9.0 | 稳定版 | **Embedding、Rerank 与模型全集模式（2026-06-20）**。新增托管向量/重排序端点和 `includeLocked` 选择器能力。 |
| 2.8.0 | 稳定版 | **登录 302 重定向承接（2026-06-16）**。加性新增可选 `LoginOptions.successRedirectURL`；缺省行为不变。 |
| 2.7.0 | 稳定版 | **远控管理面、BYOK 与 Chat Bridge CRUD（2026-06-11）**。加性补齐远控会话管理、密钥管理和第三方聊天平台接入面。 |
| 2.6.0 | 稳定版 | **会员订阅查询 + 一批后端契约类型修正 + WS 一次性 ticket 鉴权（2026-06-04）**。**新增**：`subscription.getMembership()` / `getSubscriptionTier()` / `subscriptionPrecheck()`；`ManagedModel` 档位门控字段 `locked`/`freeTier`/`minPlanTier`/`chatRuntimeSupported`/`defaultToolIds`；auth `ScopeChatBridge`(+read/write/rotate) 与 `chatBridgeScopes()`。**破坏性类型修正**（此前形状与后端不符、运行时即为 undefined）：`BalanceDetail` 对齐网关 `InternalBalanceResponse`（`userId`/`tokenRemaining`/`tokenTotal`/`callRemaining`/`callTotal`/`entitlements[]`）；`Order` 拆为 `BuyResponse`/`OrderListItem`；`getOrderStatus`/`waitForPayment` 改用 `BuyResponse.paymentStatus`（修死循环）；`PayPayload.payMethod`→`paymentMethod` + 枚举 `WECHAT_NATIVE`/`ALIPAY_PRECREATE`/`BANK_TRANSFER` + `deviceId`/`clientRequestId`；`TokenPackage` 对齐 `toProductView`；`WalletStats`/`Transaction` `amount` string→number；consume-records 分页（`records`/`total`/`page`/`pageSize`）；`EntitlementItem.createdAt` 改可选 + `activatedAt`；`ConsumeRecord` 补缓存字段；notifications WebSocket 用一次性 `stream-ticket` 取代 URL `?token=` JWT（修复 WS 鉴权 + 杜绝 JWT 泄露）。**废弃**：`listUserSubscriptions`（改用 `getMembership`）/ `ModelCoefficient`·`listCoefficients`（系数退役恒空）/ `ManagedModel.pricePerMTok`·`isDefault`（公开端点不返回）；notifications `registerDevice`/`unregisterDevice`/`list`+`updateNotificationPreference` 标 `@experimental`（网关无端点）。详见 CHANGELOG。 |
| 2.5.1 | 稳定版 | **模型 adapter 格式一致性护栏（2026-05-31）**。`getAdapterForModel` 路由加固：`preferred_format` 仅当被 `supported_formats` 收录（或 `supported_formats` 未声明）才采信，防止上游元数据漂移把 SDK 路由到模型不支持的格式端点（撞 `/anthropic` 4xx）。`supported_formats` 未声明（旧上游）时行为逐字节不变；新增 3 条 routing 用例。详见 CHANGELOG。 |
| 2.5.0 | 稳定版 | **源码健康度审计根因修复（2026-05-31）**。修复一批真实运行时缺陷：`downloadArtifact()` 超限抛错（不再静默截断）/ 本地工具 `Promise.race` 硬超时 / OpenAI 流式 reasoning→tool_calls block index 修正 / 非法 `expires_at` 视为过期 + TokenStore 校验 / OAuth 链路走注入 `fetchImpl` / 空成功响应（204）不抛 parse error / `apiBaseURL`·`complianceBaseURL` 同级校验 / 非流式默认超时 / WS 重复 connect 关旧连接 / `FileTokenStore.save()` 真 fsync / chat 请求对象不被原地 mutate / Anthropic `extraBody` 不覆盖 SDK 管理字段 / `CompliancePollError` 携带最后状态。**公开类型/方法签名零移除、零改名**（新增导出 `normalizeOverrideBaseURL`·`DEFAULT_API_TIMEOUT_MS`）。casehall/finance/enterprise 路径经生产实证确认正确（同源代理直连 tk-dist）未改 + 新增 URL 组装回归测试。详见 CHANGELOG 与 `docs/audit/TS版SDK源码健康度与文档审计报告.md`。 |
| 2.4.0 | 稳定版 | **`SkillStoreItem.skillMd?` 透出（additive minor，2026-05-30）**。修复下游经 SDK 拿不到技能 SKILL.md 正文：网关 `SkillStoreResponse` 早已返回 `skillMd`（`ToStoreResponse()` 已 map），但 SDK `SkillStoreItem` 漏声明。新增可选 `skillMd?: string`（Anthropic SKILL.md 正文，仅 Detail/resolve/非 minimal browse 携带；`SkillStoreListItem` minimal 刻意不含正文）；`readme` 一并改为可选 `readme?`（匹配网关 `omitempty`）。零方法签名/运行时改动。下游 CrabCode 重锁 `@acosmi/sdk-ts@2.4.0` + `bun install --force` 生效；SKILL.md 为不可信用户内容，GUI 渲染须 sanitize + 展示 securityLevel/securityScore/certificationStatus。 |
| 2.3.0 | 稳定版 | **`apiBaseURL` 可配置网关 base（additive，2026-05-30）**。新增可选 client 配置项，让浏览器侧 `/api/v4` 网关调用（managed-model / agent-run / casehall）可经同源代理转发，规避非网关同源域名（如 `sign.zhonglvbao.com`）下 acosmi.com 对带 `Origin` 跨域浏览器请求的 403。公开类型 / 方法签名零移除、零改名（additive minor）。 |
| 2.2.1 | 稳定版 | **README 字段名修正（docs-only patch，2026-05-29）**。修复 v2.2.0 README 示例把能力字段误写为 camelCase（`supportsImageGeneration`）；正确为 wire snake_case `capabilities.supports_image_generation` / `supports_video_generation`（`listModels` 对 `capabilities` 对象原样透传）。补充：字段随 catalog 下发、可选（缺省 false）、无专用 catalog helper。无源码改动，从 2.2.0 升级无需 review。 |
| 2.2.0 | 稳定版 | **托管模型图片/视频生成（2026-05-29）**。图片/视频生成与文本模型同属托管模型网关（同 `Client`、同 `models:chat` 鉴权面），仅 `capabilities.supports_image_generation` / `supports_video_generation` 的模型可用；计费结算在营销系统，SDK / 网关只负责调用与用量上报。新增 `client.generateImage(modelID, req, signal?)`（同步，`POST /managed-models/:id/images/generations`）/ `client.generateVideo(modelID, req, signal?)`（建异步任务，返回 `taskId`）/ `client.pollVideoTask(modelID, taskID, durationSeconds?, signal?)`（轮询，`durationSeconds` 透传给网关在 `completed` 时上报视频秒数）；新增 `ImageGenerationRequest`/`ImageGenerationResponse`/`VideoGenerationRequest`/`VideoTaskResponse` 类型 + `ModelCapabilities.supports_image_generation`/`supports_video_generation` 标志（wire snake_case，`capabilities` 对象透传不归一化）。网关适配 OpenAI 兼容图片 + 火山引擎（即梦/豆包）视频 + DashScope 通义万相（wanx）原生异步任务（图片+视频）。公开类型 / 方法签名零移除、零改名（additive minor）。 |
| 2.1.0 | 稳定版 | **远程控制 CrabCode 多接入面（2026-05-28）**。`serverURL`/`baseURL`/`baseUrl` Gateway URL 公共契约 + `normalizeGatewayBaseURL`（仅 http/https，拒 ws/wss）；`agentRuns.createRemoteRun` / `streamRemoteControl` + 11 事件 `RemoteControlEvent` union + `parseRemoteControlEvent` / `isTerminalRemoteEvent`；`AdapterKind`(6) / `RunnerKind`(3) / `PermissionPolicy` / `WorkspacePolicy`；专用 `remote_control` scope（不进 `allScopes()`，`remoteControlScopes()`）；`chatbridge` 第三方聊天平台类型骨架（types-only，无 client 方法，Phase 7B 后端落地）；`subscription.getPlanByCode`。wire 约定按平面分（远控 snake_case + 毫秒整数 / chatbridge camelCase，契约 §12-§14）。公开类型 / 方法签名零移除、零改名（additive minor）。 |
| 2.0.1 | 稳定版 | **Packaging fix — 纯发布元数据，无源码改动**。`package.json.files` 数组补 `docs/pii-role-matrix.md` + `docs/开发与发布手册.md` 两项，让 v2.0.0 引入的 PII 角色矩阵与开发手册随 npm tarball 一并下发。从 v2.0.0 升级到 v2.0.1 无需任何 review。 |
| 2.0.0 | **BREAKING** | **Phase 3 复核 + 全量根治（2026-05-25）**。主仓 9 commit 闭环 20 P0（RBAC 表达式统一 / PII 真落盘加密链 / K7 视频 webhook 幂等 / K8 OCR SSRF / K9 KYC main flow / admin 写端点错误码契约）。**SDK 同步**：新增 `casehall.getMyLawyerCredentialStatus()` + `enterprise.getMyEnterpriseKycStatus()` 律师/企业 OWNER 自查端点；`finance/types.ts` P2-016 PII Javadoc 升级（含 `keyVersion` v1/v2 payload 协议）；新建 `docs/pii-role-matrix.md`（4 角色 × 3 PII 级矩阵）；admin 写端点错误码改 HTTP 状态码语义（`200+{ok:false}` → `403/404/501`）。**升级指引详见 §"v2.0.0 升级指引"**。SDK 公开类型 / 方法签名零移除、零改名；BREAKING 范围在网关后端契约。 |
| 1.9.0 | 稳定版 | **finance 域落地（商品化总规划 P7）**。新增 `client.finance.*`：`listMyInvoices` / `requestInvoice` / `listMyRefunds` / `requestRefund` / `listMyCorporateTransfers` / `initiateCorporateTransfer` / `uploadCorporateTransferProof`（决策 14/15 + R12）。发票 / 退款 / 对公转账三条业务线全量接入；finance 金额用 `amountFen` **分单位整数 `number`**（如 `amountFen` / `taxAmountFen` / `requestedAmountFen`），2^53 内无浮点风险（≈90 万亿元），与钱包/展示类的 json.Number string 是不同约定。 |
| 1.8.1 | 稳定版 | **enterprise 企业席位域落地（商品化总规划 P6a）**。新增 `client.enterprise.*`：`listMyEnterprises` / `getEnterprise` / `inviteMember` / `listEnterpriseMembers` / `listOrgSubscriptions` / `listSeats` / `assignSeat` / `revokeSeat` / `getOrgConsumeReport`。OWNER/ADMIN 权限下席位月度变更 ≤ 3 次（超出返 41xxx 业务码）；订阅 + 席位 + 用量报表三视图齐备。 |
| 1.8.0 | 稳定版 | **casehall 法律案件咨询域落地（商品化总规划 P5 方案 B）**。新增 `client.casehall.*`：`listLawyers` / `getLawyer` / `submitCaseLead` / `listMyCaseLeads` / `getMyCases` / `bookConsultation` / `listMyConsultations` / `listMyLegalOrders` / `listLegalSKUs`。律师库公开端点（VERIFIED + ACTIVE，PII L3 已脱敏）+ 案件线索 + 咨询 + 5 LEGAL_SERVICE SKU；admin 板块 9 模块不在 SDK 边界。 |
| 1.7.0 | 稳定版 | **subscription + pricing + products 三域落地（商品化总规划 P1-P4）**。`subscription`：`listPlans` / `listUserSubscriptions`（订阅档位 + 用户订阅）。`pricing`：`getPricingConfig` / `quoteCompliance`（公开业务参数 + csign 合规 SKU 报价）。`products`：`getProductBySlug` / `listProductsByFamily` / `listComplianceSkus` / `listPublicModels`（商品中心 productFamily / audience / billingMode 索引）。 |
| 1.6.0 | 稳定版 | `ChatRequest.endUserId` 业务侧终端用户稳定标识，跨 provider 通用语义；SDK 自动按 wire-format 注入（OpenAI 顶层 `user_id` / Anthropic `metadata.user_id`）；不传时网关从认证身份 HMAC-SHA256 自动派生 32 字符 id。`validateEndUserId(s)` helper 校验 PII / 长度 / 字符集。SSE keep-alive 注释行显式跳过；网关侧命中三项隔离能力（内容安全 / KV-cache / 调度）。**订正（2026-08-06）**：本行原写"11 分钟超时调优"，实际该次改动只建了外层 `AbortController`、未下传给 `doJSONFullRaw`，内层 30 秒默认值始终生效 —— **该调优直到 2.16.0 才真正落地**。 |
| 1.5.1 | 历史稳定版 | **Docs / examples / 源码注释全量复核与修订 — 无 API 变化**。修补 8 项漂移与遗漏：README API 总览补 25+ 漏列方法（Chat 内部方法、Auth 浏览器 Web OAuth 4 原语、Skills/Notifications/Entitlements/Packages 全量、WS `connect/disconnect/isConnected`）；重写 §"手动 OAuth" 段对齐 `auth.ts` 真实签名；§"双格式红线" + 三个 chat 示例 `maxTokens` → snake_case `max_tokens`；错误表补 `ModelNotFoundError`；§Agent Runs 补 13 类 stream event 完整表；新增 §`sanitize` 命名空间小节；`docs/compliance.md` 6 处 `Since v1.6/.../1.10` 统一为 `v1.5.0 (originally planned as ...)`；手册 §7 scope 数 12 → 15 + 新增 S1-S6 rollup 段；`examples/compliance-evidence-timestamp.ts` 补 `ScopeComplianceReportsWrite`（v1.3.2 漂移生产 401 隐患）；`examples/auth-oauth-flow.ts` + `examples/core-chat.ts` 注释对齐当前契约；`src/index.ts` + `src/browser.ts` + `src/auth/auth.ts` 注释从 Go-port 语义改为"TS 主实现 + Web OAuth 替代品"。`typecheck` / `lint` / `vitest`(214) / `build` / `test:pack` 全绿。 |
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
