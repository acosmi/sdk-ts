# Changelog

All notable changes to `@acosmi/sdk-ts` will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.9.0] - 2026-06-20 — 向量 (Embedding) + 重排序 (Rerank) 端点 + listModels 全集模式

托管模型网关新增向量与重排序两类模型（上游接阿里云百炼 DashScope），SDK 订阅会员可经现有会员计费体系（Hold→Settle→Release，按 `total_tokens` 套 input 费率）直接调用。具体上游模型名（`text-embedding-v4` / `gte-rerank-v2` / `qwen3-rerank` 等）由管理员在托管模型后台自填，不在 SDK / 网关硬编码。

### Added

- **`client.embeddings(modelID, req)`** — 向量（同步，`POST /managed-models/:id/embeddings`）：请求 `{ input: string | string[], dimensions?, encoding_format? }`，响应为 OpenAI `/v1/embeddings` 标准格式（`{ object, model, data: [{ embedding }], usage }`，网关直通无包装）。仅 `capabilities.supports_embedding=true` 的模型可用。
- **`client.rerank(modelID, req)`** — 重排序（同步，`POST /managed-models/:id/rerank`）：统一扁平契约 `{ query, documents[], top_n?, return_documents?, instruct? }`，响应 `{ results: [{ index, relevance_score, document? }], usage, model }`（网关已把上游原生嵌套 / OpenAI 兼容扁平两线路归一化）。仅 `capabilities.supports_rerank=true` 的模型可用。
- **类型** — `EmbeddingRequest`/`EmbeddingData`/`EmbeddingResponse`/`RerankRequest`/`RerankResult`/`RerankResponse`。
- **`listModels` / `listModelsWithStatus` 新增 `opts.includeLocked`** — `true` 时请求 `/managed-models?picker=1` 全集模式：网关把越档模型作为 `Locked=true` 补回返全集，供 C 端选择器展示「付费订阅区」+ 置灰升级引导。缺省行为不变（只返有桶模型，向后兼容）。全集模式不写 `modelCache`，避免 locked 模型混入可用模型集。

## [2.7.0] - 2026-06-11 — 远控管理面补齐 + BYOK 密钥客户端 + Chat Bridge CRUD（Phase 7B）

补齐远控核心交互之外的全部管理面（此前下游 CrabCode 只能裸 fetch），新增 BYO 模型密钥客户端，落地 chat-bridge integration/credential 管理面 CRUD——云端控制台与下游调用的是同一组端点同一份租户隔离数据，天然互通。全部方法逐字段对齐 nexus-v4 handler 真实 wire 形状（契约 §12/§14/§18 附录 A）。

### Added

- **`agentRuns.list(opts?)`** — 调用者自己的 run 列表（`GET /agent-runs`，Phase 5C 控制台）：`runtime`/`status` 过滤 + `page`/`pageSize` 分页，信封 `{records,total,page,pageSize}`；run view 新增 `runtime`/`runner`/`adapter` 字段（标准 run 缺省），永不含 session token/policy/messages。
- **`agentRuns.submitPermissionResult(runId, {requestId, decision, reason?})`** — 远控审批决策回写（`POST /:runId/permission-results`）；decision 仅 `approved`|`rejected`（契约 §14），409 = 会话不可用。
- **`agentRuns.submitUserMessage(runId, {content, requestId?})`** — 会话中途追加用户消息（`POST /:runId/messages`，≤64KB，role 服务端硬编码 user）；返回服务端最终幂等键。
- **`agentRuns.revealRemoteToken(runId)`** — desktop launcher 一次性 session token（`POST /:runId/remote-token`，Phase 5B；仅 runner=desktop）；响应含 `workspace`（契约 §18.3 r4）。token 永不落浏览器存储。
- **`AgentRunCreateRequest.byokCredentialRef`** — BYO 密钥引用上 wire（`byok_credential_ref`，仅远控 + cloud runner）。
- **`client.crabcodeByok`（`CrabCodeByokClient`）** — BYO 模型密钥管理面（契约 §18.2，`/crabcode/byok-credentials`，`remote_control` scope）：`list`/`create`/`rotate`/`revoke`；明文一次性提交，响应恒 masked（ref+fingerprint）。新类型 `ByokProvider`/`ByokCredential`/`ByokCreateRequest`。
- **`client.chatBridge`（`ChatBridgeClient`，Phase 7B）** — 第三方聊天平台集成/凭证管理面 CRUD：`createIntegration`/`listIntegrations`/`getIntegration`/`updateIntegrationStatus` + `storeCredential`/`listCredentials`/`rotateCredential`/`revokeCredential`。请求体 snake_case（SDK 转换）、响应 camelCase（契约 §12 平面分化）；scope 三档 `chat_bridge:read`/`:write`/`:rotate`。新类型 `CreateIntegrationRequest`/`StoreCredentialRequest`。
- **metadata 约定键常量** — `AGENT_RUN_META_TITLE`/`AGENT_RUN_META_WORKSPACE`（契约 §18.3 r4：title 列表标题 / workspace 期望项目目录）。
- **远控管理面类型** — `RemotePermissionDecision`/`RemotePermissionResultRequest`/`RemoteUserMessageRequest`/`RemoteUserMessageAck`/`RemoteSessionTokenGrant`/`AgentRunListOptions`/`AgentRunListResult`。

### Deprecated

- **`ChatIntegration.configJson`** — 服务端从不返回该字段（model `json:"-"`，防 secret 误入后整体不外发），读取恒 `undefined`；写入走 `createIntegration({ configJson })`。

## [2.6.0] - 2026-06-04 — 会员订阅查询 + 后端契约类型修正 + WS 一次性 ticket 鉴权

新增会员订阅查询能力 + chat_bridge scope，并修正一批此前与后端不符（运行时即为 `undefined`）的计费/订单/钱包/余额/通知类型形状。**破坏性 = 类型修正**：被修正的类型字段名 / 类型发生变化，但它们此前本就拿不到正确运行时值，对真正生效的调用代码无功能回退。

### Fixed

- **`BalanceDetail` 形状对齐网关 `InternalBalanceResponse`** — 改为 `userId` / `tokenRemaining` / `tokenTotal` / `callRemaining` / `callTotal` / `entitlements[]`，与网关真实下发结构逐字段对齐（此前字段名与后端不符，`getBalanceDetail` 读出 `undefined`）。
- **`getOrderStatus` / `waitForPayment` 改用 `BuyResponse.paymentStatus`（修死循环）** — 旧实现读不存在的状态字段，`waitForPayment` 永远拿不到终态导致轮询死循环；改读 `BuyResponse.paymentStatus`。
- **`PayPayload.payMethod` → `paymentMethod`** — 字段名对齐后端，并补齐枚举值 `WECHAT_NATIVE` / `ALIPAY_PRECREATE` / `BANK_TRANSFER` 与 `deviceId` / `clientRequestId` 字段。
- **`TokenPackage` 对齐 `toProductView`** — 字段形状与网关 `toProductView` 输出一致。
- **`Order` 拆为 `BuyResponse` / `OrderListItem`** — 下单返回与订单列表项是两套不同形状，不再用单一 `Order` 混淆。
- **`WalletStats` / `Transaction` `amount` 由 `string` 改 `number`** — 与后端实际下发类型对齐（此前 string 假设导致消费方误用）。
- **consume-records 分页修正** — 网关已修为 `records` / `total` / `page` / `pageSize`，SDK 类型与解析同步对齐。
- **`EntitlementItem.createdAt` 改为可选 + 新增 `activatedAt`** — 与后端 optional 语义对齐。
- **`ConsumeRecord` 补缓存字段** — 补齐网关下发的缓存相关字段。
- **notifications WebSocket 改用一次性 `stream-ticket` 取代 URL `?token=` JWT** — 杜绝长效 JWT 经 query string 进入 nginx access log / 代理日志 / 浏览器历史的泄露面，同时修复 WS 鉴权链路。

### Added

- **`subscription.getMembership()` / `getSubscriptionTier()` / `subscriptionPrecheck()`** — C 端会员订阅查询：当前会员视图 / 订阅档位 / 升级前置校验。
- **auth `ScopeChatBridge`（+ `:read` / `:write` / `:rotate` 三子项）+ `chatBridgeScopes()`** — chat_bridge 第三方聊天平台桥接 scope（Phase 7B 后端落地配套）。
- **`ManagedModel` 档位门控字段** — `locked` / `freeTier` / `minPlanTier` / `chatRuntimeSupported` / `defaultToolIds`，供 C 端聊天模型选择器按会员档位加锁 / 分区。

### Deprecated

- **`subscription.listUserSubscriptions`** — 改用 `getMembership()`。
- **`ModelCoefficient` / `listCoefficients`** — 系数退役，端点恒返回空。
- **`ManagedModel.pricePerMTok` / `isDefault`** — 公开端点不返回这两个字段。
- **notifications `registerDevice` / `unregisterDevice` / `list` + `updateNotificationPreference`** — 标 `@experimental`（网关当前无对应端点）。

### Breaking（类型修正）

- 上述被修正的类型形状（`BalanceDetail` / `Order` → `BuyResponse`·`OrderListItem` / `OrderStatus` / `TokenPackage` / `PayPayload` / `WalletStats` / `Transaction`）此前与后端不符——运行时即为 `undefined` 或错配。修正后字段名 / 类型发生变化（故标 minor 内的破坏性类型修正）；按新形状重新读取即可，对此前依赖错误字段的代码本就无有效运行时数据。

### Docs（文档准确性修正）

- **额度单位双体系文档化** — 计费/订阅域所有 `token*` 字段（`tokenQuota`/`tokenRemaining`/`tokenUsed`/`tokenTotal`）单位取决于权益是否付费：**免费档 = 原始 Token（TK 体系）**，**付费会员（`type ∈ {TOKEN_PACKAGE, SUBSCRIPTION}`）= 微 Credits（÷1000 = Credits 代币）**。在 `EntitlementBalance` / `EntitlementItem` / `BalanceDetail` / `Membership` / `SubscriptionPlan` 类型注释与 README「钱包 + 余额」一节补充该语义，明确**两者单位不同、绝不可跨单位求和**，判据为权益 `type`。档位标准额度 BASIC 0.6 亿 / PRO 3 亿 / PRO_MAX 9 亿 / ULTRA 24 亿 Credits。
- **README 钱包示例修正** — `getWalletStats` 输出由 string 改为 number（对齐本版 `WalletStats` float64）并补 `transactionCount`；`buyTokenPackage` 示例由错误的 `{ payMethod: 'wechat' }` 改为 `{ paymentMethod: 'WECHAT_NATIVE' }`；`waitForPayment` 由不存在的 `order.id` 改为 `String(order.orderId)`（`BuyResponse` 用 `orderId`/`orderNo`，无 `id`）。

## [2.5.1] - 2026-05-31 — 模型 adapter 格式一致性护栏（行为加固 patch，向后兼容）

`getAdapterForModel` 路由加固：`preferred_format` 现仅在**确被 `supported_formats` 收录**时才采信（或 `supported_formats` 未声明时维持原样）。防止上游元数据漂移（如 `preferred_format=anthropic` 但 `supported_formats=[openai]`）把 SDK 路由到模型并不支持的格式端点，撞 `/anthropic`「未绑定 Anthropic」4xx。这是网关侧「同 model_id 双 profile 选行」根因修复在 SDK 侧的同构护栏。

### Changed

- **`getAdapterForModel`**：决策顺序第 1 步由「`preferred_format` 非空即采信」收紧为「`preferred_format` 非空**且**该格式在 `supported_formats` 内（或 `supported_formats` 未声明）才采信」。`supported_formats` 为空/未知（旧上游）时行为逐字节不变（仍采信 `preferred_format`，再回落 provider 名硬编码）。新增 3 条 `test/adapters/routing.test.ts` 用例钉死矛盾场景。
- 升级无需 review：仅当上游同时返回 `preferred_format` 与一个**不含该格式**的 `supported_formats` 时路由结果才改变（此前是错误路由，现纠正）。

## [2.5.0] - 2026-05-31 — 源码健康度审计根因修复（additive minor，公开 API 零移除/零改名）

逐文件源码 + 文档深度审计后的根因修复。主索引：`docs/audit/TS版SDK源码健康度与文档审计报告.md`（含 §0.5 前置核实修订与 live 生产实证）。**公开类型与方法签名零移除、零改名**；新增导出 `normalizeOverrideBaseURL` / `DEFAULT_API_TIMEOUT_MS` / `OpenAIStreamConverter`。

### 重要澄清（推翻原审计 P1-1 误报）

- **casehall / finance / enterprise 业务域路径未改，且经生产实证确认正确。** 它们带 `/api/...` 前缀、经 `apiURL()` 拼成 `/api/v4/api/...`（双 `/api`）是「同源代理直连 tk-dist」链路的**有意契约**（nginx `location /api/v4/api/casehall/` → tk-dist `:48080/api/casehall/*`），与后端控制器 `@RequestMapping` 逐字一致。`sign.zhonglvbao.com/api/v4/api/casehall/lawyer-credentials/my` 实测 401 可达；若按表面"去 /api"会落 404 破坏在产 casehall。新增 `test/business-domain-url.test.ts` 钉死全部业务域 URL 契约，防回归。
- casehall 的 `listLawyers` 等 9 个 `/casehall/app|me/...` 方法对应**后端 consumer 端点尚未实现**，已加 `@experimental` JSDoc 诚实标注（调用会 404）。

### Fixed

- **`agentRuns.downloadArtifact()` 超限静默截断 → 抛错**：读 `maxDownloadSize + 1` 探测，超限抛 `download artifact: response exceeds NMB limit`（对齐 `downloadSkill`），不再把损坏的截断数据交给调用方。
- **本地工具回调无硬超时 → `Promise.race` 硬超时**：`invokeLocalTool` 即使 handler 完全忽略 `ctx.signal` 也不会永挂，超时返回稳定失败结果；保留 `ctx.signal` 协作式取消。
- **OpenAI 流式 `reasoning_content` 后直接 `tool_calls`（无 text）时 block index 错乱 → 修正**：新增 `thinkingBlockIndex` 记录 thinking 占用索引；tool_calls 新建 block 前镜像 text 分支先关 thinking 再递增；finish 按真实索引关闭。修 thinking/tool 撞 index 0 与错配 stop。
- **非法 `expires_at` 被当未过期 → 视为过期**：`tokenSetIsExpired` 加 `Number.isFinite` 闸；`FileTokenStore`/`LocalStorageTokenStore` 的 `load()` 加 `isValidTokenSet` 形状校验（坏数据返回 `null` 而非带坏 token 继续）。
- **OAuth 链路绕过注入 `fetchImpl` → 统一走注入 fetch**：`auth.ts` 的 discover/register/exchange/refresh/revoke helper 末位加可选 `fetchImpl`（默认全局 fetch，向后兼容），`Client` 全链路传 `this.fetchImpl`。自定义 fetch/代理/测试 mock/受限运行时现可覆盖全链路。
- **空成功响应（204/空 body）抛 JSON parse error → 返回 `undefined`**：核心 `doJSONFullInternal` 与 `agentRuns.requestAPI` 对齐 compliance，空响应不再 `JSON.parse('')`。
- **`apiBaseURL` / `complianceBaseURL` 缺校验 → 与 gateway base 同级校验**：新增 `normalizeOverrideBaseURL` 拒 ws/wss、空 host、query、hash。
- **部分非流式请求无默认超时 → 套默认超时**：新增 `DEFAULT_API_TIMEOUT_MS`（60s）+ `Client.withRequestTimeout`；`agentRuns.requestAPI` 与 `compliance.executeJson` 在调用方未传 signal 时套组合超时（超时 + 用户 signal 任一 abort）。流式/下载路径保留长连接语义。
- **WebSocket 重复 `connect` 泄漏旧连接 → 先关旧再建新**：`connect()` 开头若已有连接先 `disconnect()`，杜绝多个后台重连 loop / FD 泄漏。
- **`FileTokenStore.save()` 注释承诺 fsync 但未实现 → 真 fsync**：`open → writeFile → fh.sync()（文件 fsync）→ close → rename → 目录 fsync（best-effort，跨平台不支持时吞错）`，兑现 durability 承诺，保留 atomic rename。
- **chat 请求对象被原地 mutate → 内部浅 clone**：`chat`/`chatMessages*`/`chatStream*` 5 处入口浅 clone（`{...req, stream}`），sanitizer 改 clone 的 `rawMessages`，调用方传入的 `req` 零改动。
- **Anthropic `extraBody` 能覆盖 SDK 管理字段 → denylist**：`thinking`/`effort`/`max_tokens`/`temperature`/`betas` 强制跳过并告警，保留透传非管理字段。
- **`CompliancePollError` 不携带最后状态 → 填充 `lastInfo`**：`poll()` 各抛错点装入最后一次状态视图，便于排障。

### Changed（文档）

- README / 开发手册：版本归一到 2.5.0；`Invoice.taxNumber` → `taxId`（README + 手册）；finance 金额叙述改「`amountFen` 分单位整数 number」（钱包/展示类仍 json.Number string）；多端章节补浏览器 `localStorage` token + WebSocket query token 风险说明；开发手册 P0 红线改为「任何 namespace 新增/变更方法必须有 URL 组装测试」并新增「两条传输约定」专章 + provider 双状态枚举（大写 `ComplianceProviderRequestStatus` vs 小写 `ComplianceProviderStatus`）澄清。

## [2.4.0] - 2026-05-30 — `SkillStoreItem.skillMd?` 透出（additive minor，零回归）

Additive minor，纯类型，无方法签名 / 运行时改动。修复**下游经 SDK 拿不到技能 SKILL.md 正文**：网关 `SkillStoreResponse` 早已返回 `skillMd`（`json:"skillMd,omitempty"`，`ToStoreResponse()` 已 map），但 SDK 的 `SkillStoreItem` 类型未声明该字段，导致 `getSkillDetail` / `resolveSkill` / `browseSkills` 的消费方（CrabCode）在类型层访问不到正文。

### Changed

- **`SkillStoreItem` 新增可选 `skillMd?: string`** — Anthropic SKILL.md 正文。声明为可选以匹配网关 `omitempty`（空时字段缺省）。仅全量响应（Detail / resolve / 非 minimal browse）携带；`SkillStoreListItem`（`fields=minimal`）**不含**正文，刻意保持 90% 瘦身不变。
- **`SkillStoreItem.readme` 改为可选 `readme?: string`** — 修正旧的轻微契约不符：网关该字段为 `json:"readme,omitempty"`，空时缺省。

未触碰 `SkillStoreListItem`（minimal 刻意剥正文）。从 2.3.x 升级无需 review；消费 `skillMd` 时按可选处理（空表示该技能未提供 SKILL.md 正文，可回退 `readme`）。

> 下游 CrabCode 生效需重锁 `@acosmi/sdk-ts@2.4.0` + `bun install --force`。SKILL.md 为用户发布的不可信内容，GUI 渲染须 sanitize（禁原始 HTML 注入）并同屏展示 `securityLevel` / `securityScore` / `certificationStatus`。

## [2.3.0] - 2026-05-30 — `apiBaseURL` 可配置网关 base（additive，零回归）

Additive minor。新增一个可选 client 配置项，让浏览器侧 `/api/v4` 网关调用（managed-model / agent-run / **casehall**）可经**同源代理**转发，规避非网关同源域名（如 `sign.zhonglvbao.com`）下 acosmi.com 对带 `Origin` 跨域浏览器请求的 403。

### Added

- **`ClientConfig.apiBaseURL?: string`** — `/api/v4` 网关调用的 base 覆盖。未配置时 `apiURL()` 仍用 `serverURL`（**既有行为逐字节不变**，全部既有消费方 tk-dist-web / acosmi-web / CrabCode / 桌面不受影响）。与 `complianceBaseURL` 同构（compliance 走 `/admin-api`，本字段走 `/api/v4`），尾随 `/` 自动 trim，`apiURL()` 仍按需追加 `/api/v4` 不重复。

### 用法（浏览器经同源代理接 casehall，规避跨域 403）

1. 部署域名 nginx 加 `location /api/v4/ { proxy_pass https://acosmi.com/api/v4/; proxy_set_header Host acosmi.com; proxy_set_header Origin ""; proxy_set_header Authorization $http_authorization; }`（**仅 `/api/v4/`，不要用 `/api/`**——否则会劫持应用自身的 `/api/*` Route Handler）。
2. **浏览器端** client 配 `apiBaseURL: window.location.origin`。同源 GET 无 `Origin` 头 → nginx 服务端转发 acosmi.com → 不触跨域 403。
3. **服务端**（Route Handler）client **不设**本字段，直连 `serverURL`（服务端到 acosmi.com 无跨域）。

从 v2.2.x 升级无需任何 review：不传 `apiBaseURL` 即维持原状。

## [2.2.1] - 2026-05-29 — README 字段名修正（docs-only patch）

纯文档修正，无源码 / 类型 / 方法签名改动。修复 v2.2.0 README「图片/视频生成」示例中把能力字段误写为 camelCase（`supportsImageGeneration`）的问题——`ModelCapabilities` 是 wire snake_case 对象，正确字段为 `capabilities.supports_image_generation` / `supports_video_generation`（`listModels` 对 `capabilities` 对象原样透传，不归一化）。补充说明：这两个字段随 catalog 下发、为可选（缺省按 false）、且**无专用 catalog helper**（需直接读字段筛模型）。从 v2.2.0 升级无需任何 review。

## [2.2.0] - 2026-05-29 — 托管模型图片/视频生成

Additive minor。公开类型 / 方法签名零移除、零改名。图片/视频生成与文本模型同属托管模型网关（同 `Client`、同 `models:chat` 鉴权面），仅 `capabilities.supports_image_generation` / `supports_video_generation` 的模型可用。计费结算在营销系统，SDK / 网关只负责调用与用量上报。

### Added

- **`Client.generateImage(modelID, req, signal?)`** — 同步图片生成，`POST /managed-models/:id/images/generations`，返回 `ImageGenerationResponse`（`url` / `b64_json` / `revised_prompt`）。内部超时与 chat 同级（11min）容纳上游耗时。
- **`Client.generateVideo(modelID, req, signal?)`** — 创建异步视频任务，`POST /managed-models/:id/videos/generations`，返回 `VideoTaskResponse`（含 `taskId`）。
- **`Client.pollVideoTask(modelID, taskID, durationSeconds?, signal?)`** — 轮询视频任务，`GET /managed-models/:id/videos/tasks/:taskId`；`durationSeconds` 透传给网关在 `completed` 时上报真物理量（视频秒数）。
- 新类型：`ImageGenerationRequest` / `ImageGenerationResponse` / `VideoGenerationRequest` / `VideoTaskResponse`。
- `ModelCapabilities` 新增可选 `supports_image_generation?` / `supports_video_generation?`（上游未声明时为 `undefined`，调用方不得用模型名 substring 推断）。
- `doJSONFullRaw(method, path, body, signal?, timeoutMs?)` 新增可选 `timeoutMs`（默认 30s，向后兼容），图片生成传 chat 同级超时。

### 网关侧适配范围

- OpenAI 兼容图片端点 + 火山引擎（即梦/豆包）视频任务 + **DashScope 通义万相（wanx）原生异步任务 API（图片 + 视频）**。DashScope 万相图片在网关内部建任务并轮询到终态后同步返回 URL（对 SDK 仍是一次 `generateImage`），视频走 `generateVideo` + `pollVideoTask`。

## [2.1.0] - 2026-05-28 — 远程控制 CrabCode 多接入面

Additive minor。公开类型 / 方法签名零移除、零改名。契约见 `docs/audit/sdk-remote-control-contract-2026-05-27.md`。

### Added

- **Acosmi Gateway URL 公共契约**：`serverURL` / `baseURL` / `baseUrl` 三别名 + `normalizeGatewayBaseURL()`（仅接受 `http`/`https`，拒绝 `ws`/`wss` 及空 host，规整尾斜杠）。详见 README §"Acosmi Gateway URL 公共契约"。
- **远程控制（CrabCode remote-control）**，`agentRuns` 命名空间下、事件协议独立于旧 `stream`：
  - `agentRuns.createRemoteRun(req, signal?)` — `req.runtime` 固定 `'crabcode_remote'`，`runner` + `adapter` 必填。
  - `agentRuns.streamRemoteControl(runId, signal?)` — 无 options 参数；`error` 恒非终结、`done`/`settle` 终结、从不抛异常。
  - 11 事件 `RemoteControlEvent` union + helper `parseRemoteControlEvent(raw)`（wire→强类型，未知 type 返回 `null`）/ `isTerminalRemoteEvent(ev)`。
  - 枚举：`AdapterKind`（6）/ `RunnerKind`（3）/ `PermissionPolicy` / `WorkspacePolicy`。
  - 专用 scope `remote_control`（+ 3 子 scope）：`remoteControlScopes()` / `ScopeRemoteControl`，**不进 `allScopes()`**，绝不复用 `models:chat` / `ai`。
  - wire 约定按平面分（契约 §12）：远控平面 = snake_case + 时长整数毫秒（`approval_timeout_ms`）；唯一序列化出口 `RemoteSessionEvent.ToWire()`，跨语言金标 fixtures 护栏（`test/remote-control-wire-golden.test.ts` ⇄ 后端 `wire_golden.json`）。
- **`chatbridge` 第三方聊天平台桥接类型骨架**（types-only，无 `client.chatBridge.*` 方法，Phase 7B 后端落地）：导出类型 + 守卫 `isPlatform` / `isRegion` / `isIntegrationStatus` / `isChannelInboundEvent` / `asCredentialRef`。资源视图平面 = camelCase；secret 只入上游 vault，公共面仅见 `CredentialRef` + fingerprint + 脱敏 metadata（契约 §16）。
- `subscription.getPlanByCode(planCode, signal?)` — 按 `planCode` 精确取单个可售订阅计划（复用 `listPlans` 客户端过滤，未命中返回 `null`；deep-review §12.3）。

## [2.0.1] - 2026-05-25 — Packaging fix

### Fixed

- `package.json` `files` 字段白名单遗漏 — v2.0.0 publish 后发现 `docs/pii-role-matrix.md` (新建) 与 `docs/开发与发布手册.md` (修订) 未进 npm 包. 集成方 `npm install @acosmi/sdk-ts` 后 `node_modules/@acosmi/sdk-ts/docs/` 缺这两份关键文档. 修白名单加显式三份 `docs/*.md` (排除 `docs/api/` 1.7MB TypeDoc 输出避免包膨胀).

## [2.0.0] - 2026-05-25 — BREAKING (Phase 3 复核 + 全量根治)

商品化 P1-P7 Phase 3 深度复核审计 (主仓 9 commit, HEAD `e510f68a`) + SDK 全量同步.
**用户裁决: major bump** (角色 fail-OPEN 别名废除 + admin 错误码契约变更 + PII 真加密 = breaking).

### Added (Phase C — 主仓 user-facing 端点同步)

- `casehall.getMyLawyerCredentialStatus()` — 律师自查执业证审核状态. 端点 `GET /api/casehall/lawyer-credentials/my` (主仓 `LawyerCredentialConsumerController`). 普通用户调返 `[]` 不抛.
- `enterprise.getMyEnterpriseKycStatus()` — 企业 OWNER 自查 KYC 状态. 端点 `GET /api/distribution/enterprise/kyc/my` (主仓 `EnterpriseKycConsumerController`). 非 OWNER 调返 `{enterpriseId:undefined}` 空 view, 不抛.
- 新增类型 `LawyerCredentialMyView` (`src/casehall/types.ts`) + `EnterpriseKycMyStatusView` (`src/enterprise/types.ts`), 与主仓 VO 字段对齐, 显式白名单剔除 `fields_json` / `rawJson` 等 PII L3 字段.

### Changed (BREAKING — Phase 3 复核引入的契约变更)

- **admin 写端点响应改 HTTP 状态码语义**: csign / compliance-billing admin POST 端点
  (`/api/admin/csign/seals` / `/api/distribution/compliance-billing/commit|cancel|refund` 等)
  跨租户/不存在改返 HTTP `403`/`404` (之前 `200` + `{ok:false}`); 印章/能力未配置返 HTTP `501`
  (之前 `200` + `{code:NOT_CONFIGURED}`). 集成方需用 `try-catch` 拦 `HTTPError.statusCode`,
  不再读 `CommonResult.ok` 字段. 详见 `src/compliance/errors.ts` 头部注释段.
- **角色严格化**: `ROLE_ADMIN` / `ROLE_USER` / `INTERNAL` 三个旧别名失效 (主仓
  `SensitiveSerializer.normalizeAuthority` 不再自动升级到 `platform_admin` / `consumer` / `s2s`
  视角). yudao 后台通用 admin token 调用 PII 端点会拿到 guest 脱敏视图. 集成方需用正式
  `ROLE_PLATFORM_ADMIN` / `ROLE_S2S` / `ROLE_LAWYER` / `ROLE_CONSUMER` 之一. 详见
  `docs/pii-role-matrix.md`.

### Docs

- 新建 `docs/pii-role-matrix.md` — 4 角色 × 3 PII 级矩阵 + 旧别名 breaking 说明 + 脱敏算法
  引用 + 集成方测试 mock 示例.
- `src/finance/types.ts` `Invoice` JSDoc 升级 P2-016 注释 — 补充 v1.9.0+ 真落盘加密
  (V51 + V63 + V64), keyVersion v1/v2 payload 协议, 角色严格化 4 正式角色枚举.
- `src/compliance/errors.ts` 头部注释新增"v1.9.0+ admin 写端点行为变更"段 — 解释 403/404/501
  HTTP 状态码契约改造与集成方应对.
- `README.md` 状态行版本号 1.6.0 → 1.9.0, 概要补 v1.7/v1.8/v1.9 highlight.
- `docs/开发与发布手册.md` 最后更新 2026-05-22 → 2026-05-25, 当前版本 1.5.0 → 1.9.0,
  §4 目录结构补 6 个 namespace (casehall / enterprise / finance / pricing / products /
  subscription).

## [1.9.0] - 2026-05-25

### Added — 商品化总规划 P7: 财务 finance namespace (发票/退款/对公转账)

钉死决策 (§13.7):
- 决策 14 对公转账: 支付页弹窗 + 企业微信对接销售/财务 + 财务系统手工 mark, **零银行 API**.
- 决策 15 退款规则: 订阅不退 / Token 包 7 天未用全额 / 服务交付后不退, 按 dist_refund_policy 表配置, 不硬编码.
- R12   价格快照: 订单创建时同步落 dist_order_price_snapshot, 支付回调按快照算 entitlement, 防 in-flight 改价错配.

- 新 namespace `finance/`:
  - 类型 (`finance/types`):
    - `Invoice` (普票/增普/增专) + `RequestInvoiceInput`
    - `RefundPolicy` (5 条 seed: SUBSCRIPTION_NO_REFUND / TOKEN_PACK_7DAY_UNUSED / TOKEN_PACK_PRORATA_USED / COMPLIANCE_NO_REFUND_AFTER_DELIVERY / LEGAL_NO_REFUND_AFTER_DELIVERY)
    - `RefundRecord` + `RequestRefundInput` (productFamily 派生 policyCode)
    - `CorporateTransfer` + `InitiateCorporateTransferInput` + `InitiateCorporateTransferResult` (qrUrl/salesWechatId/financeEmail 弹窗数据)
  - 方法 (与 tk-dist `/api/distribution/finance/**` 对齐):
    - `client.requestRefund(req)` / `client.listMyRefunds()`
    - `client.requestInvoice(req)` / `client.listMyInvoices()`
    - `client.initiateCorporateTransfer(req)` / `client.uploadCorporateTransferProof(id, url)` / `client.listMyCorporateTransfers()`

### Notes

- admin 板块 (审批 / 财务工作台 / 月度对账 / dashboard) 由 admin UI 直连 `/api/admin/finance/**`, 不在 SDK 边界.
- DistPricingConfigService 新增 3 key 支撑决策 14 弹窗: `corporate_transfer_qr_url` / `corporate_transfer_sales_wechat_id` / `corporate_transfer_finance_email` (ops 热更).
- V51 SQL: 7 CREATE TABLE (`dist_invoice` / `dist_contract` / `dist_corporate_transfer` / `dist_refund_policy` / `dist_refund_record` / `dist_order_price_snapshot` / `dist_reconciliation`) + 5 INSERT seed policy + 3 INSERT seed pricing config.
- R12 实施: `OrderPaymentService.createPurchase` 在 `orderMapper.insert(order)` 后同步调 `OrderPriceSnapshotService.captureSnapshot(orderId, productId)`.
- 月度对账作业 `MonthlyReconciliationJob` 每月 1 号 02:30 跑上月对账, 差异 > 1% → log.error 告警.

## [1.8.1] - 2026-05-25

### Added — 商品化总规划 P6a: 企业席位 enterprise namespace

钉死决策 (§-1.4 H10 + §-1.2.D): tk-dist 新建 `dist_enterprise_*` 独立表族, 与 `dist_org_node` 分销代理体系
完全分离 (实测分销 dist_org_node 1 条 + dist_org_member 24 条均为代理身份, 不复用). §-1.2.D 钉死 4 项:
销售对接 ≥200 席 / 月度变更 3 次/订阅 / per_seat_cap = pool/seats×1.5 / pool = seats × Pro Max × 0.8.

- 新 namespace `enterprise/`:
  - 类型 (`enterprise/types`):
    - `EnterpriseSummary` (企业组织, contactPhone/Email 仅 OWNER/ADMIN 可见)
    - `EnterpriseMember` (OWNER / ADMIN / MEMBER 角色, 不参与佣金)
    - `OrgSubscription` (订阅 + §-1.2.D 4 项派生计算字段)
    - `OrgSeat` (席位, seat_no 1..N, per_seat_monthly_cap_tk override)
    - `InviteMemberRequest` / `AssignSeatRequest` / `OrgConsumeReport`
  - 方法 (与 tk-dist `/api/admin/enterprises/**` + `/me/enterprises` 端点对齐):
    - `client.listMyEnterprises()` / `client.getEnterprise(id)`
    - `client.inviteMember(req)` / `client.listEnterpriseMembers(enterpriseId)`
    - `client.listOrgSubscriptions(enterpriseId)`
    - `client.listSeats(orgSubscriptionId)` / `client.assignSeat(req)` / `client.revokeSeat(seatId, note?)`
    - `client.getOrgConsumeReport(enterpriseId)`

### Notes

- 不升 major (与 P5 1.8.0 兼容); admin 9 controllers (Enterprise / Member / Subscription / Seat /
  SeatAssignment / Settlement / Sales / Billing / RiskControl) 由 admin UI 直连, 不在 SDK 边界.
- 后端 EntitlementService.hold() 入口已加 P6a enterprise pool fast-path (用户被分配席位 → 走简化
  SHARED 池扣减; 池满 / 超 per_seat_cap → fallback 个人桶 + Free 兜底, 现有逻辑零侵入).
- web /org/console 路由占位 skeleton (订阅概览 / 成员管理 / 席位分配 / 用量统计), SDK 接入留 P6b.
- P6b (变更规则 + console UI 接入) + P6c (AI 初审外包对接) 后续 wave 实施.

## [1.8.0] - 2026-05-25

### Added — 商品化总规划 P5 (方案 B): 法律案件咨询 casehall namespace

钉死决策: Java tk-dist `yudao-module-casehall` 子模块, 与 `yudao-module-compliance` 并列体系
(不另起架构分裂). Go 网关侧 `legal_* 10 表` 保留供 `legal-wf-*` 工作流运行时使用,
与本商业化数据流松耦合。

- 新 namespace `casehall/`:
  - 类型 (`casehall/types`):
    - `LawyerSummary` (公开 L1 视图, licenseNo 等 PII L3 已脱敏剥离)
    - `SubmitCaseLeadRequest` / `CaseLead` / `CaseMatter`
    - `LegalConsultation` / `BookConsultationRequest`
    - `LegalServiceOrder` / `LegalServiceSku`
    - `LegalSkuCode` literal union (5 SKU)
  - 方法 (与 tk-dist `/casehall/app/**` C 端公开 + `/casehall/me/**` 登录态对齐):
    - `client.listLawyers({ practiceArea?, location?, pageNo?, pageSize? })`
    - `client.getLawyer(id)`
    - `client.submitCaseLead(req)` / `client.listMyCaseLeads()` / `client.getMyCases()`
    - `client.bookConsultation(req)` / `client.listMyConsultations()`
    - `client.listMyLegalOrders()` / `client.listLegalSKUs(region?)`
- 5 Legal SKU (复用 `dist_compliance_sku.benefit_type='LEGAL_SERVICE'`, V49 注入):
  - `LEGAL_CONSULTATION_ONCE` 19900 分
  - `LEGAL_CONSULTATION_60MIN` 35900 分
  - `LEGAL_DOC_REVIEW_HUMAN` 49900 分
  - `LEGAL_CASE_LEAD_CLAIM` 9900 分
  - `LEGAL_LAWYER_SERVICE_PKG` 199900 分

### Notes

- admin 板块 9 模块 (`/casehall/admin/**`) 不在 SDK 边界, 仅 admin UI 直连。
- 路由实际生效由后续窗口在 nexus-v4 网关层路由白名单中开放。

## [1.7.0] - 2026-05-25

### Added — 商品化总规划 P4: csign 电子认证 SKU (扩展 pricing namespace)

- 新类型 (`pricing/types`): `ComplianceSku` / `ComplianceQuoteResponse` / `ComplianceBenefitType`
- 新方法 (匿名可调用):
  - `client.listComplianceSkus(region?)` → `ComplianceSku[]`
  - `client.quoteCompliance(skuCode, quantity?, region?)` → `ComplianceQuoteResponse`
- 端点 (Go 网关反代到 tk-dist `/api/distribution/public/compliance/**`, @PermitAll 匿名):
  - `/distribution/public/compliance/skus?region=CN|OS|GLOBAL`
  - `/distribution/public/compliance/quote?skuCode=...&quantity=...&region=...`
- 字段白名单: 公开端点不暴露 `upstreamCostFen` / `status` / 内部 id

### Added — 商品化总规划 P1: 订阅档位 + 公开业务参数 namespace

- 新 namespace `subscription/`:
  - 类型: `SubscriptionPlan` / `UserSubscription` / `SubscriptionAudience` / `RolloverPolicy`
  - 方法: `client.listPlans(audience?)` / `client.listUserSubscriptions()`
- 新 namespace `pricing/`:
  - 类型: `PricingConfig` (Record<string,string>) / `PublicModelSummary`
  - 方法: `client.getPricingConfig(key?)` / `client.listPublicModels()`
- 端点 (Go 网关反代到 tk-dist `/api/distribution/public/pricing/**`, 网关代理路由 P3 商品中心补):
  - `/distribution/public/pricing/plans?audience=PERSONAL|ENTERPRISE`
  - `/distribution/public/pricing/config?key=...`
  - `/distribution/public/pricing/models`
  - `/distribution/user/subscriptions`

### Added — 商品化总规划 P3: 商品中心 namespace (同 minor 升级, version 仍 1.7.0)

- 新 namespace `products/`:
  - 类型: `Product` / `ProductFamily` / `Audience` / `BillingMode` / `RegionScope`
  - 枚举常量: `ProductFamilyEnum` / `AudienceEnum` / `BillingModeEnum` / `RegionScopeEnum`
  - 方法: `client.listProductsByFamily(family?, audience?, region?)` / `client.getProductBySlug(slug, region?)`
- 端点 (Go 网关反代到 tk-dist `/api/distribution/public/products/**`):
  - `/distribution/public/products/by-family?family=MODEL_MEMBERSHIP&audience=PERSONAL&region=GLOBAL`
  - `/distribution/public/products/by-slug/{slug}`
- 字段白名单严格 (与后端 `DistProductMappingService#toPublicResponse` 同源):
  仅暴露 `id / publicSlug / displayName / productFamily / audience / billingMode / regionScope / basePriceFen / tokenQuota / displayMetadataJson`.
  `featureGateJson` (H5 能力开关) / `retiredAt` / `salesChannelJson` / `priceSnapshotPolicy` 禁止外泄.
- 后端 V47 DDL: `dist_product_mapping` 加 9 字段 (`product_family / audience / billing_mode / feature_gate_json / region_scope / sales_channel_json / price_snapshot_policy / display_metadata_json / retired_at`).

### Compatibility — 100% 后向

- 新增三个 barrel namespace (subscription/pricing/products), 现有所有 import 路径不变.
- 新增方法走 declaration merging 注入 `Client.prototype`, 不破坏既有签名.
- 缺省 wire 字段策略与 v1.6.x 一致 (snake_case → camelCase 不做映射, 直接吃 Java 返回结构).

---

## [1.6.0] - 2026-05-24

### Added — 业务侧终端用户 id (endUserId) + 请求保活

- `ChatRequest.endUserId?: string` — 业务侧终端用户 id, 跨 provider 通用语义。
  序列化规则:
  - OpenAI wire: 顶层 `body["user_id"]`
  - Anthropic wire: 合并到 `body["metadata"]["user_id"]`; caller `metadata` 显式键优先
- 约束: 长度 ≤ 512, 字符集 `[a-zA-Z0-9_-]+`, **禁止包含用户隐私信息** (邮箱/手机/真名等).
- 公开 helper `validateEndUserId(s)`, `isSSECommentLine(line)`, 常量 `maxEndUserIdLength`.
- Chat / ChatMessages / ChatStream / ChatMessagesStream 的 per-request timeout 5min → **11min**,
  覆盖 DeepSeek 上游 "开始推理前最大 10min 保活" 窗口。
- SSE 外层循环显式跳过 `: comment` 注释行 (": keep-alive"), 防止未来添加 else-branch 误抛 JSON parse error。
- 网关 sanitizer step 4.4 做最终校验 + 派生 + 注入; caller 显式覆盖需 `scope=endusr.set`,
  无授权时 endUserId 被丢弃, 上游收到的是网关 HMAC 派生值 (32 字符稳定 id)。

### Security — devDep upgrade（消除 4 项 moderate Dependabot alerts）

- `vitest` `^1.0.0` → `^4.1.7`（跨 3 major），传递性把 `vite` `5.4.21` → `8.0.14`
  / `esbuild` 路径升到 fixed 区间，消除：
  - **GHSA-67mh-4wv8-2f99** — esbuild dev server CORS bypass（fix: 0.25.0）
  - **GHSA-4w7w-66w2-5vf9** — vite path traversal in optimized deps `.map` handling（fix: 6.4.2）
- **Consumer 零影响**：vitest/vite/esbuild 全在 devDependencies，dist tarball 与
  package.json `engines.node >=18` 不变；不需要打 tag / 发新版。
- 验证：`npm audit` 0 vulnerabilities / `vitest 4.1.7` 17 文件 214 case
  全绿 / typecheck / lint / build / test:pack consumer 视角 PASS / docs 重生
  无新增 errors。

---

## [1.5.1] — 2026-05-23

> **Docs / examples patch — 无 API 变化**。对 README、`docs/compliance.md`、`docs/开发与发布手册.md`、`examples/`、源码注释做全量复核与修订，消除发现的 8 项漂移与遗漏。无 runtime 行为变更、无新增/移除导出符号、无 wire-format 变化；`typecheck` / `lint` / `vitest`(214) / `build` / `test:pack` 全绿。

### Changed — README.md

- 补全 API 总览表 25+ 漏列方法：`chatMessages` / `chatMessagesStream` / `buildChatRequest` / `loginWithHandler` / `isAuthorized` / `getTokenSet` / 浏览器 Web OAuth 4 原语 / `discoverWithProfile` / `register` / `revokeToken` / `generateState` / `ensureModelCached` / `browseSkillStore` / `getSkillSummary` / `certifySkill` / `getCertificationStatus` / `markAllNotificationsRead` / `deleteNotification` / `unregisterDevice` / `updateNotificationPreference` / WS `connect`/`disconnect`/`isConnected` / `listConsumeRecords` / `invalidateCoefficientCache` / `getTokenPackageDetail` / `listMyOrders` / `Client.create`。
- 修复 §"双格式红线" 把 `preferredFormat` / `supportedFormats` 错写为 camelCase 的描述——`ManagedModel` 上这两个字段是 snake_case wire 字段；同步说明 `modelId` / `isEnabled` / `inputModalities` 等顶层走 camelCase。
- 修复 Quick Start / 流式 / Web Search 三个示例的 `ChatRequest` 字段：`maxTokens` → `max_tokens`（与 `src/models/types.ts:ChatRequest.max_tokens` 对齐）。
- 重写 §"手动 OAuth" 段：`register/authorize/exchangeCode` 全部按 `src/auth/auth.ts` 真实签名重写——`register` 不接 scopes / `authorize` 需 `reg.client_id`+`handler:` 而非 `onEvent:`、返回 `{ result, verifier }` / `exchangeCode` 需 5 个位置参数含 `result.redirectURI` + `verifier`；指向 `examples/auth-oauth-flow.ts` 完整示例；加浏览器 Web OAuth 替代品指引。
- §错误处理表补 `ModelNotFoundError`（`chat` / `ensureModelCached` listModels 自动刷新后仍未命中）；为既有 `NetworkError` / `StreamError` / `CompliancePollError` 补字段细节。
- §Agent Runs 段补 `AgentRunStreamEvent` 完整 13 类事件表（`run_started` / `status` / `text_delta` / `reasoning_delta` / `tool_call` / `tool_result` / `local_tool_request` / `artifact` / `sources` / `usage` / `settle` / `error` / `done`）。
- 新增 §`sanitize` 命名空间小节：列 `client.setDefensiveSanitize` / `setAutoStripEphemeralHistory` / `applyRequestSanitizers` 三个 mixin 方法 + `sanitize.sanitize` / `dropBlocks` / `stripEphemeral` + 17 个 `Block*` 常量 + `MinimalSanitizeConfig` 字段（`maxMessagesTurns` / `permanentDenyBlocks` / `maxImageBytes` / `maxVideoBytes` / `maxPDFBytes`）+ thinking 块硬豁免红线。
- §历史表 1.5.0 行补"compliance gateway S1-S6 全量 rollup + scope 总数 15"说明。

### Changed — docs/compliance.md

- 6 处版本号漂移修订：`Since v1.6.0 / 1.7.0 / 1.8.0 / 1.9.0 / 1.10.0` + `Contract-template scopes (added in v1.10.0)` → 统一为 `v1.5.0 (originally planned as v1.X.0 — see CHANGELOG §"SN：..."`，避免消费者误以为这些方法在未来版本才有。

### Changed — docs/开发与发布手册.md

- §7 必测清单：`test/compliance-scopes.test.ts — 12 个` → `15 个`，附 12 → 13（v1.3.2）→ 15（v1.5.0 S5）演进注解。
- §7 新增"Compliance gateway S1-S6 rollup（v1.5.0）"小节，逐 S 列出新增 25+ SDK 方法、对应后端 G1-G6、新增 scope 与 fail-closed 红线。

### Changed — examples/

- `examples/compliance-evidence-timestamp.ts` 补 `ScopeComplianceReportsWrite`（`createReport` 自 v1.3.2 起改用独立 write scope；过去用 `ScopeComplianceReportsRead` 在生产会 401）。
- `examples/auth-oauth-flow.ts` 顶部注释指向 v1.4.0+ Web OAuth 原语（`discoverWebOAuthMetadata` / `registerWebOAuthClient` / `createWebAuthorizationRequest` / `completeWebAuthorizationRequest`）+ `Config.browserRefreshMode` / `refreshProxyURL` (v1.4.1+) CORS 规避方案。
- `examples/core-chat.ts` 顶部注释把 `preferredFormat` / `supportedFormats` 改回 snake_case；补 `ChatRequest` snake_case wire / `ManagedModel` 顶层 camelCase 字段命名说明。

### Changed — 源码注释（无 runtime 影响）

- `src/index.ts` 顶部注释从"端口源 acosmi-sdk-go v0.19.0 (一字不差对齐)"改为"自 2026-05-22 起 TS 是主实现 / 事实标准"，与 README §状态 + 手册 §1 / §10 一致。
- `src/browser.ts` 顶部注释加 v1.4.0+ Web OAuth 替代品 + v1.4.1+ `browserRefreshMode` 指引。
- `src/auth/auth.ts` 顶部 + `authorize()` doc：从"浏览器侧应自行实现 popup window"改为指向同文件内 Web OAuth 原语。
- `docs/api/`（TypeDoc 生成）已同步重生成。

### Verified

- `typecheck`：0 errors
- `vitest`：17 files / **214 tests passed**
- `npm pack --dry-run`：tarball 内容无变化
- 跨语言契约印记（snake_case wire / 双 adapter 等地位 / bug-for-bug 行为）零回归

---

## [1.5.0] — 2026-05-23

> 众律宝 SaaS 工作台 SDK / 后端能力缺口总账（`docs/audit/saas-sdk-backend-capability-gap-register-2026-05-22`）
> **compliance gateway S1–S6 全量 + Phase 0.3/0.5 共享 DTO**：在 `client.compliance.*`
> 上新增 22 个方法、2 个新 scope，沉淀 `src/shared/` 跨域共享原语，对接已合并的
> 后端 **G1–G6** 契约。**纯增量、向后兼容**——不改任何既有导出符号的签名或行为；
> `tenant` / `iam` / `apiClients` / `operations` / `audit` / `gateway` / `mcp` /
> `certification` 8 个占位命名空间继续维持 `export {}`；`typecheck` / `lint` /
> `vitest`(168) / `build` / `test:pack` / `docs` 全绿。
>
> 历史注记：本仓库内部 1.5.0/1.6.0/1.7.0/1.8.0/1.9.0/1.10.0/1.11.0 七个内部版本
> 已合并为单一 1.5.0 发布（1.11.0 已 npm unpublish，留作历史尘埃）。

### Added — Phase 0.3 / 0.5：跨域共享 DTO（原 1.5.0 / 缺口总账 §9.4 / §9.5）

- **`src/shared/` 跨域共享 DTO**——为平台控制面 / `compliance.list*` 等命名空间提供
  统一原语，按关注点分文件：
  - `shared/pagination.ts` — `PageRequest`、`SortDirection`，以及 **`PageResult<T>`**
    （刻意做成既有 `YudaoPageResult<T>` 的别名，不引入第二套 `{list,total}` 结构）。
  - `shared/operation.ts` — `OperationId` / `OperationSource` / `OperationStatus` /
    `VerifyStatus` / `IdempotencyKey` 类型与 `IdempotencyKeyHeader` 常量
    （`'Idempotency-Key'`，写接口幂等键 header 单一真相源）；`ProviderRequestStatus`
    **复用**既有 `ComplianceProviderRequestStatus`，不另造同名近似类型。
  - `shared/retry-advice.ts` — `RetryAdvice` 统一失败补救模型 + `RetryAdviceReason`
    （11 项）+ `retryReasonForComplianceKey()` / `retryReasonForOAuthError()`
    映射函数 + `complianceErrorToRetryAdvice()` 叠加投影。**叠加层**——独立类型，
    不修改也不替换 `core/retry.ts` `RetryPolicy` 与 `compliance/errors.ts`
    `ComplianceErrorInfo`。
  - `shared/principal.ts` — `PrincipalRef` / `TenantRef` / `ApiClientRef` 轻量引用。
  - `shared/gate.ts` — `FeatureGateStatus` / `FeatureGateState` / `StepUpStatus` /
    `GateQuota` / `BillingPreflightResult`（gate / capability / step-up / preflight
    查询形态）。
- `test/shared.test.ts` — 17 个契约测试，覆盖别名等价 / 幂等键常量 / reason 映射 /
  叠加投影只读性 / `classifyComplianceError` 零回归红线。

### Added — S1：6 个分页列表（原 1.6.0 / U-1 / 后端 G1）

- **`client.compliance.list*` 6 个分页列表读方法**——对接后端 G1 的 6 个 `GET .../page`
  端点，均返回 yudao `PageResult<T>`：
  - `listEvidenceAssets(req?, signal?)` — `GET /compliance/evidence/assets/page`，
    过滤项 `assetType` / `status` / `createTimeStart` / `createTimeEnd`。
  - `listTimestamps(req?, signal?)` — `GET /compliance/timestamps/page`，过滤项
    `provider` / `verificationStatus` / `createTimeStart` / `createTimeEnd`。
  - `listEvidencePackages(req?, signal?)` — `GET /compliance/evidence/packages/page`。
  - `listReports(req?, signal?)` — `GET /compliance/reports/page`。
  - `listSigningEnvelopes(req?, signal?)` — `GET /compliance/signing-envelopes/page`。
  - `listSealApprovals(req?, signal?)` — `GET /compliance/seal-approvals/page`。
- **6 个 `*PageItem` + 6 个 `List*Request` 类型**——按子域归位；所有 `List*Request`
  继承共享 `PageRequest`。`*PageItem` 是详情视图的 SDK-safe 子集 + `createTime`，
  不含 provider raw / 证书 / storage / 合同原文。

### Added — S2：capabilities + operations 投影（原 1.7.0 / U-5/U-6 / 后端 G2）

- **`client.compliance.getCapabilities(signal?)`** — `GET /compliance/capabilities`，
  返回 `ComplianceCapability[]`。后端 G2 为每个高风险 / 收费动作返回闸门视图：
  `executable` / `state` / `requiredScopes` / `requiredStepUp` / `reason`。
  调用方在高风险动作执行【前】查询做门控，拿不到能力时必须 fail-closed。
- **`client.compliance.getFeatureGate(action, signal?)`** — 便捷方法（每次调用一次
  网络请求，多个动作请改用 `getCapabilities` 一次取回本地查表）。
- **`client.compliance.listOperations(req?, signal?)`** — `GET /compliance/operations/page`，
  返回 `PageResult<OperationPageItem>`。
- **`client.compliance.getOperation(id, signal?)`** — `GET /compliance/operations/{id}`
  （数值行主键，非 `operationId` 幂等键），返回 `OperationDetail`。
- **新增 `compliance/operation/` 子域类型**：`ComplianceCapability` / `OperationPageItem` /
  `OperationDetail` / `ListOperationsRequest`。

### Added — S3：TSA readonly 视图（原 1.8.0 / U-7 / 后端 G3）

- **`client.compliance.listTsaProviders(signal?)`** — `GET /compliance/timestamps/providers`，
  返回 `TsaProvider[]`，每个 provider：`name` / `environment` / `available`。
- **`client.compliance.getTsaStats(signal?)`** — `GET /compliance/timestamps/stats`，
  返回 `TsaStats`：总数 + 按校验状态分桶计数。
- **新增 `compliance/timestamp/` 子域类型**：`TsaProvider` / `TsaStats`。

### Added — S4：envelope 收尾 + void（原 1.9.0 / U-10/U-12 子集 / 后端 G4）

- **`client.compliance.listEnvelopeContracts(envelopeId, signal?)`** — `GET
  /compliance/signing-envelopes/{id}/contracts`，返回 `EnvelopeContractItem[]`。
- **`client.compliance.listEnvelopeProviderRequests(envelopeId, signal?)`** — `GET
  /compliance/signing-envelopes/{id}/provider-requests`，返回 `OperationPageItem[]`
  （**复用**操作投影类型）。
- **`client.compliance.voidEnvelope(envelopeId, req, options?)`** — `POST
  /compliance/signing-envelopes/{id}/void`，**写方法**：`Idempotency-Key`、不重试、
  `401` 不刷新重放。`VoidEnvelopeRequest = { reason: string }`。
- **新增 `compliance/signing/` 子域类型**：`EnvelopeContractItem` / `VoidEnvelopeRequest`。

### Added — S5：合同模板（原 1.10.0 / U-2 / 后端 G5）

- **9 个合同模板方法**：
  - `createContractTemplate` (POST，DRAFT 初始)
  - `updateContractTemplate` (POST，仅 DRAFT)
  - `deleteContractTemplate` (POST，仅 DRAFT)
  - `getContractTemplate` (GET)
  - `listContractTemplates` (GET 分页)
  - `uploadContractTemplatePdf` (POST `{ pdfBase64 }`)
  - `publishContractTemplate` (POST，DRAFT → PUBLISHED，版本快照固化)
  - `archiveContractTemplate` (POST，PUBLISHED → ARCHIVED)
  - `listContractTemplateVersions` (GET，普通数组)
- **新增 `compliance/template/` 子域类型**：`ContractTemplateField` /
  `ContractTemplateFieldType` / `ContractTemplateResp` / `ContractTemplatePageItem` /
  `ContractTemplateStatus` / `ContractTemplateVersion` / `CreateContractTemplateRequest` /
  `UpdateContractTemplateRequest` / `UploadContractTemplatePdfRequest` /
  `ListContractTemplatesRequest`。
- **新增 2 个 scope 常量**：`ScopeComplianceContractTemplateRead`
  (`compliance:contract_template:read`) / `ScopeComplianceContractTemplateWrite`
  (`compliance:contract_template:write`)。`ComplianceScope` 联合与 `complianceScopes()`
  总数 13 → 15。读方法要求 `:read`、写方法要求 `:write`；不要求 step-up。

### Added — S6：用印执行记录（原 1.11.0 / U-4 / 后端 G6）

- **`client.compliance.listSealUses(req?, signal?)`** — `GET /compliance/seal-uses/page`，
  返回 `PageResult<SealUsePageItem>`，过滤支持 `sealId` / `envelopeId` /
  `usageStatus` / `createTimeStart` / `createTimeEnd`。一次 seal use 描述
  envelope / contract / seal / 审批联动后【真正调用 provider 落章】的那一笔记录，
  与 envelope 领域状态正交。SDK-safe——不含 provider raw payload / 证书 / storage key。
- **新增 2 个 compliance 领域类型**（`src/compliance/seal-approval/types.ts`）：
  `SealUsePageItem` / `ListSealUsesRequest`。
- **Scope 复用**：复用既有 `ScopeComplianceContractSigningRead`
  (`compliance:contract_signing:read`) ——后端 G6 端点声明同一 read scope，不新增 scope。

### Unchanged

- **印章授权 / 印章 CRUD（U-3 / U-11）**：仍为后端推迟项（CFCA 私有 jar / W3 闸门），
  本版本不引入 SDK 方法。
- **envelope send / remind / authorize / download / token** 等动作：后端 G4 范围之外
  暂缓，本版本不暴露对应 SDK 方法。

> Method Status：本次新增 22 个方法均为 `production-ready`（compliance gateway
> S1–S6 / G1–G6 契约、端点、DTO、SDK 测试、文档全部闭环）。无 `gated` 方法。

---

## [1.4.2] — 2026-05-22

> `src/` 目录按业务域重组（实施计划 `docs/audit/sdk-ts-directory-restructure-plan-2026-05-22`）。
> **纯内部重组 + 开发工具 + 文档**——公共导出符号集合（295 个标识符）、`package.json`
> `exports`、`dist/` 产物路径全部一字未变；`typecheck` / `lint` / `vitest`(140) / `build` /
> `test:pack`（消费者视角 packed 产物）全绿。下游 `crabcode` / `crabclaw` / `csign` 零感知。

### Changed

- `src/` 从扁平 36 文件重组为按业务域分文件夹结构（`core/`、`shared/`、`auth/`、
  `models/`、`billing/`、`skills/`、`notifications/`、`agent-runs/`、`compliance/`、
  `support/`）；每域一个 barrel `index.ts`，根 `index.ts` 改为只从各域 barrel re-export。
  `types.ts`（1341 行）、`scopes.ts`、`compliance-*.ts` 按域拆分。为后续平台控制面能力
  预留 `apiClients/`、`tenant/`、`iam/`、`audit/`、`operations/`、`mcp/`、`gateway/`、
  `certification/` 占位目录。

### Added

- TypeDoc API 参考文档：`npm run docs` 生成 `docs/api/`（Markdown）；接入 `release.yml`。
- `examples/` 补 core / auth / agent-runs 三个示例（此前仅 compliance 三例）。

### Removed

- 死入口 `src/node.ts`——它既非 `tsup` 构建 entry 也不在 `package.json` `exports`，
  从未被打包发布，删除对所有外部消费者零可观测影响。

---

## [1.4.1] — 2026-05-22

### Added

- **`Config.browserRefreshMode?: 'direct' | 'server-proxy' | 'none'`** 与
  `refreshProxyURL` — 浏览器 Web OAuth token 刷新策略。默认 `direct` 保持既有行为；
  `server-proxy` 可把刷新收口到同源 Route Handler，规避 OAuth issuer CORS 403；
  `none` 用于产品自行处理过期登录态。新增错误码常量
  `ErrOAuthCORSBlocked`、`ErrRefreshProxyFailed`、`ErrTokenExpired`。

---

## [1.4.0] — 2026-05-21

> csign `/login` Web OAuth 接入复核审计（`docs/audit/csign-login-oauth-audit-result-2026-05-21`）
> Phase A：在 SDK 增补浏览器 Web OAuth 原语。本版本为**纯增量、向后兼容**——
> 不改任何既有导出符号的签名或行为，桌面 loopback `login()` 流程完全不受影响。

### Added

- **`discoverWebOAuthMetadata(serverURL, signal?)`** — 发现 Web OAuth 服务元数据，
  请求 `/.well-known/oauth-authorization-server/web`。与既有 `discover()`
  （`/desktop`）共用内部 `discoverWithProfile(serverURL, profile, signal?)`，URL 解析、
  fetch、错误处理与字段校验完全一致。`discoverWithProfile` 与
  `OAuthMetadataProfile`（`'web' | 'desktop'`）一并导出。
- **`registerWebOAuthClient(meta, opts, signal?)`** — 动态注册浏览器 Web OAuth
  客户端。与 `register()`（桌面 loopback，硬编码 `redirect_uri=127.0.0.1`）的区别在于
  允许传入任意 Web `redirectURIs`；`opts = { clientName, redirectURIs, scopes? }`，
  注册体 `token_endpoint_auth_method: 'none'`、
  `grant_types: ['authorization_code','refresh_token']`、`response_types: ['code']`，
  接受 HTTP 200/201。
- **`createWebAuthorizationRequest(meta, opts)`** — 构造 Web OAuth 授权请求：生成
  PKCE verifier + S256 challenge + CSRF `state`，按 OAuth 2.1 拼装 authUrl
  （`response_type=code`、`code_challenge_method=S256`、`state`、空格连接的 `scope`、
  可选 `login_hint`）。返回 `WebAuthorizationRequest`
  （`{ authUrl, state, verifier, clientID, redirectURI, serverURL, createdAt }`），
  发起方应整体持久化为 pending 状态。
- **`completeWebAuthorizationRequest(pending, params, signal?)`** — 完成 Web OAuth：
  校验 `params.state === pending.state`（CSRF 防护，不匹配抛 `ErrStateMismatch`），
  依次 `discoverWebOAuthMetadata` → `exchangeCode` → `newTokenSet`，返回可持久化的
  `TokenSet`。
- **`generateState()`** — 生成 32 字节加密随机 `state`（base64url 无填充），与
  `generateCodeVerifier` 共用随机源。
- **`ErrStateMismatch`（`'state_mismatch'`）** — Web OAuth callback `state` 不匹配
  错误码，加入 `LoginErrCode` 联合类型。
- **`Config.oauthMetadataProfile?: 'web' | 'desktop'`** — 新增客户端配置项，决定
  **所有 token 生命周期的 metadata 发现**走哪个 well-known 端点，覆盖
  `ensureToken()` 刷新、`forceRefresh()`（401 强制刷新）以及 `logout()` 吊销
  （revoke）三条路径——不止 `ensureToken`。默认 `'desktop'`，未设置时对既有调用方
  零影响；浏览器 Web OAuth 签发的 token 其 refresh / revoke 必须走 Web token /
  revocation 端点，否则会打到桌面 loopback 端点导致刷新失败或吊销无效，故 csign 等
  Web 应用应显式配 `'web'`。`login()` 桌面 loopback 授权路径仍固定走 `'desktop'`
  发现，不受此配置影响。

---

## [1.3.2] — 2026-05-20

> 生产闭环实施计划（`Acosmi-Compliance-SDK-Csign-PC-CrabCode-生产闭环实施计划-2026-05-20`）
> Phase 1 / Phase 5 / Phase 7 的 SDK 侧收口版本。

### Added

- **`ScopeComplianceReportsWrite`（`compliance:reports:write`）** — 新增第 13 个
  细粒度 compliance scope，专用于创建出证报告。`complianceScopes()` 已包含该 scope，
  字面量与 Go `DesktopOAuthScopes` / `ScopesSupported`、Java `ComplianceScopes`
  三端一致。
- **Compliance 方法状态分级** — `docs/compliance.md` 新增「Method Status」一节，
  把每个 `client.compliance.*` 方法标注为 `production-ready` / `gated` /
  `draft contract` / `internal-only` 四档；`gated`（`publishReport` / `signEnvelope` /
  `createH5SigningUrl` / `approveSealApproval`）在服务端 step-up / 闸门未闭合前会
  一致 fail-closed，SDK 不重试、不伪成功。`internal-only`（distribution billing /
  provider raw / callback / CFCA 材料）不在 SDK 调用面。

### Changed

- **创建出证报告需要新 scope** — `client.compliance.createReport` 对应的服务端
  scope 从 `compliance:reports:read` 切换到独立的写 scope
  `compliance:reports:write`。调用 `createReport` 的应用必须在 `login()` 时申请
  `ScopeComplianceReportsWrite`；在该 scope 发布前签发的旧 token 不含此 scope，
  存量用户需重新走一次 OAuth 授权流程才能继续创建报告。`getReport` /
  `downloadReport` 继续用 `compliance:reports:read`，`publishReport` 继续用
  `compliance:reports:publish` + step-up（发布闸门不变）。
- **`verifyEvidencePublic` 可匿名调用** — 公开验真不再要求先 `login()`：未持有
  token 时 SDK 直接发匿名请求，不再抛 `not authorized, call login() first`；已持有
  token 时附带 `Authorization` 以保留审计上下文。public 端点收到 `401` 不触发
  `forceRefresh`、不做 refresh replay。

### Safety

- 公开验真匿名链路与认证写链路边界保持不变：写方法仍不自动 retry、401 不刷新重放；
  匿名 public verify 不复用 `/api/v4`，走 `client.complianceURL(path)`。

---

## [1.3.1] — 2026-05-20

### Changed

- 修订 npm 包短介绍和搜索关键词，明确 SDK 同时覆盖模型网关、
  Agent Run Gateway 与 Compliance（电子证据、时间章、报告、签署 envelope）
  统一客户端能力。

---

## [1.3.0] — 2026-05-20

### Added

- **Compliance SDK client** — 新增 `client.compliance` 子客户端，覆盖电子证据、
  时间章、证据包、报告、签署 envelope、用印审批和 provider request 脱敏状态轮询。
- **`Config.complianceBaseURL` / `Client.complianceURL(path)`** — compliance API 使用
  独立 base URL，未配置时默认 `${serverURL}/admin-api`，不复用既有 `/api/v4`
  模型网关路径。
- **Compliance public types** — 新增 `src/compliance-types.ts`，只暴露 Acosmi 公共领域
  DTO；不包含 provider product/user/transaction/project/seal-provider 字段，不包含证书、
  私钥、keystore、provider raw payload、storage key、subject snapshot 或 billing commit 内部字段。
- **Compliance error classification** — 新增 `src/compliance-errors.ts`，把 Java 数值业务错误码
  映射到 SDK symbolic key，并提供 `classifyComplianceError` / `isComplianceBusinessError`。
- **Compliance status helpers** — 新增稳定状态与错误码辅助函数，供前端区分 step-up、
  gate closed、provider not configured、local verify failed、billing not committable 等状态。
- **Compliance scopes** — 新增 12 个细粒度 compliance scope 常量和 `complianceScopes()`。
- **Examples and docs** — 新增 `docs/compliance.md` 以及 3 个示例：
  `examples/compliance-read.ts`、`examples/compliance-evidence-timestamp.ts`、
  `examples/compliance-envelope.ts`。
- **Tests** — 新增 compliance client 与 compliance scopes 单元测试，覆盖 URL 拼接、
  `Authorization`、`Idempotency-Key`、GET 401 refresh retry、write no-retry/no-401-replay、
  CommonResult 解包、数值错误码分类、隐私边界和 polling 终态。

### Changed

- `README.md` 增加 compliance 快速开始、scope 申请、base URL 配置、evidence +
  timestamp/report 示例、provider request polling、step-up/gate closed 错误处理、
  idempotency key 持久化和安全禁止项说明。
- Packed tarball smoke test 覆盖 `client.compliance`，确保 consumer 视角能解析新增
  declaration merging 和导出的 compliance 类型。
- `package.json.files` 现在包含 `docs/compliance.md` 和 `examples/`，npm 包随附用户文档
  与可运行示例；开发手册仍保留在仓库中，不随包发布。

### Safety

- Compliance write methods do not auto retry and do not refresh/replay on 401.
  GET read methods still allow one safe 401 refresh retry.
- All compliance write methods accept `Idempotency-Key` through `ComplianceWriteOptions`；
  callers should persist keys and reuse the same key when resuming the same business action.
- SDK code, docs, tests, examples, and package files do not include provider materials,
  credentials, real provider endpoints, signing containers, archives, jars, passwords,
  or raw provider payloads.

---

## [1.2.0] — 2026-05-18

### Added

- **`ManagedModel.inputModalities`** — 新增可选字段, 类型 `Array<'text' | 'image'>`, 描述模型可接收的用户输入模态; 'image' 表示模型可直接接收 screenshot/image 输入. listModels / listModelsWithStatus 在写缓存与返回前会归一化上游 snake_case 字段名 `input_modalities` → camelCase `inputModalities` (兼容老网关), camelCase 与 snake_case 同时存在时 camelCase 胜.

- **`ModelCapabilities.supports_desktop_visual_understanding`** — 新增可选字段, 标识模型适合作为桌面截图解析 sidecar (输入 screenshot, 输出结构化 UI 描述, 供非多模态主模型消费). 与 `inputModalities=['image']` 是正交两件事: 前者描述"模型能不能吃图", 后者描述"运营是否把该模型标为桌面 UI 解析专用 sidecar". `zeroModelCapabilities()` 显式置 `false`, 避免 `undefined` 导致调用方误判.

- **`InputModality`** 类型导出 — `'text' | 'image'`.

- **Model catalog helpers (4 个)** — CrabCode desktop automation / computer-use 选模型用, 严格按 SDK 字段, 禁止模型名 substring 推断:
  - `modelSupportsInputModality(model, modality): boolean`
  - `modelSupportsImageInput(model): boolean`
  - `findFirstModelByInputModality(models, modality): ManagedModel | null` — 按 catalog 顺序, 跳过 `isEnabled === false`
  - `findDesktopVisualUnderstandingModel(models): ManagedModel | null` — 选择规则: isEnabled !== false + capabilities.supports_desktop_visual_understanding === true + inputModalities 含 'image' + isDefault 优先 / 否则 catalog 顺序第一个

### Notes

- 上游 `ManagedModel` 缺失 `inputModalities` 时, SDK 保留 `undefined` 不自动补 `['text']` — 调用方必须保守按 text-only / unknown 处理, 严禁默认假设支持 image.
- 客户端不应硬编码模型名, 应完全依赖 SDK catalog 能力字段做模型选择.
- 23 新单测全绿 (8 listModels 归一化 + 15 helpers); 全量 79/79 passed, typecheck/lint/build clean.

---

## [1.1.0] — 2026-05-06

### Added

- **Agent Runs SDK Gateway** — 新增 `client.agentRuns` namespace，作为 CrabDesign、CrabCode、CrabClaw 等下游产品接入 Acosmi 云端智能体循环的正式 SDK 协议边界：
  - `create(req, signal?)`
  - `stream(runId, opts?, signal?)`
  - `run(req, opts?, signal?)`
  - `cancel(runId, signal?)`
  - `get(runId, signal?)`
  - `listArtifacts(runId, signal?)`
  - `downloadArtifact(runId, artifactId, signal?)`
  - `submitLocalToolResult(runId, result, signal?)`
  - `runWithLocalTools(req, handlers, opts?, signal?)`

- **Agent Run protocol types** — 新增 `AgentRunCreateRequest`、`AgentRunStreamEvent` discriminated union、`AgentRunArtifact`、`AgentRunStreamError` 等公开类型。SDK public API 使用 camelCase，HTTP wire-format 使用 snake_case。

- **Local tool bridge protocol** — SDK 不内置产品专属本地文件读取逻辑；`local_tool_request` 由下游处理，并通过 `submitLocalToolResult({ requestId, ok, content | error })` 返回。便捷封装 `runWithLocalTools` 支持 handler 超时、拒绝和取消。

- **Durable Agent Run Gateway contract** — Nexus Agent Run Gateway 使用租户隔离的 durable run store 持久化 run 状态、SSE event、artifact 和 local tool result；stream 支持断线后的 durable event replay，并将 local tool request 真正桥接到 ADK function call 等待点。

- **Exact usage settlement** — Agent Runs 结算只接受 provider/ADK 透传的 `exact: true` usage，并通过 tk-dist `SettlePrecise(input/output/cacheRead/cacheCreate)` 精算；若 provider 未返回精确 usage，服务端会释放 hold 并返回 `usage_missing_released`，不会用字符数或 token 估算扣费。

### Changed

- **401 retry policy for Agent Runs** — Agent Runs 客户端只对 GET/stream/download 等安全查询做单次 401 refresh retry；`create`、`submitLocalToolResult` 等可能产生副作用的 POST 不自动重放，避免重复创建 run 或重复计费。

### Tests

- 新增 `test/agent-runs.test.ts`，覆盖 create 字段序列化、完整流事件解析、401 refresh 策略、error 事件结构化抛出、local tool result payload、artifact 下载文件名/content-type 解析。
- `scripts/smoke-pack.mjs` 增加 consumer 视角的 `client.agentRuns` 类型调用验证。

## [1.0.2] — 2026-05-06

### Fixed

- **多进程共享 `~/.acosmi/tokens.json` 撞 `HTTP 400: refresh token not found` 根治** —
  `Client.ensureToken` / `Client.forceRefresh` 在 `withMu` 临界区内从不 reload 磁盘,
  导致 P1 完成 refresh token rotation 写盘后, P2 内存仍持旧 R0,下一次 refresh 必然
  撞网关 400 invalid_grant。CrabCode TUI 多窗口 / `crabclawskill` 并发等典型场景命中。

  双层修复:

  - **Layer 1 — reload-before-refresh** (`src/client.ts`):新增 `Client.syncFromDisk()`
    在 `ensureToken` / `forceRefresh` 进入临界区后立刻 `store.load()`,若磁盘
    `refresh_token` 与内存不同则采纳磁盘新版,重判过期 — 未过期直接 fast-return
    (跳过本进程多余 refresh, 同时避免拿已 invalidated 的 R0 撞网关)。
  - **Layer 2 — 跨进程临界区** (`src/store.ts`):`TokenStore` 加可选
    `withLock?<T>(fn): Promise<T>` 方法(向后兼容,自定义 store 不实现自动回退到 L1
    窄窗口);`FileTokenStore` 实现 sidecar `<path>.lock` + `O_EXCL` 创建语义 + 60s
    旧锁回收 + 30s 获取超时 + 30+jitter ms backoff,真正消除残余 TOCTOU。
    `Client.storeWithLock(fn)` helper 把整段 `load → check → refresh → save` 包进
    跨进程临界区。

- **`FileTokenStore.save` 改 atomic rename** (`src/store.ts`) — 写到
  `<path>.tmp.<pid>.<ts>.<rand>` 后 `fs.rename` 到正式路径,POSIX 上 `rename(2)`
  同分区原子, Windows 上 `ReplaceFile`。读端永远看到完整旧/新 JSON,不会读到截断半
  文件(`Client.create.store.load` 在另一进程写入中间触发也不会 JSON parse 失败)。

### Added

- **`fileLockDefaults` 公开常量** (`src/store.ts`) — 暴露 `acquireTimeoutMs` (30s) /
  `staleMs` (60s) / `retryBaseMs` (30) / `retryJitterMs` (70),便于测试与诊断。

- **回归测试 7 项**:
  - `test/auth/multi-process-refresh.test.ts` (4 项):双 Client 共享 FileTokenStore
    的 rotation 竞态核心回归 / P2 磁盘新 RT 也过期需 refresh / forceRefresh 也走
    syncFromDisk / 无 rotation 时 0 影响 v1.0.1 行为。
  - `test/store/file-token-store.test.ts` (3 项 + 4 子):atomic save 终态完整 /
    并发 save 不混合 / 双 store 实例临界区互斥 / 旧锁自动 break / 错误路径释放锁 /
    in-process 串行化。

### Compatibility

- **无破坏性变更**:`TokenStore.withLock` 是可选方法,1.0.x 自定义 store 实现 0 改动。
- **API 兼容**:`Client.ensureToken` / `forceRefresh` 签名不变,`FileTokenStore` 构造器
  不变。
- **行为兼容**:单进程场景与 v1.0.1 完全一致(磁盘 RT 与内存一致时 syncFromDisk 早返,
  flock 单进程零竞争 ~1ms 开销)。

### Notes

- **Go SDK 镜像修复待发**:`acosmi-sdk-go` 同根因(`client.go:316-383` `ensureToken` +
  `:2143-2168` `forceRefresh` + `store.go` `FileTokenStore` 缺 flock),将在 v0.19.1
  对齐修复。
- **NFS / 跨机共享警告**:`O_EXCL` 在 NFS 上不保证原子。FileTokenStore 设计目标是本地
  文件系统(用户家目录)。真要跨机共享 token, 应实现自定义 Keychain / 数据库 store。

## [1.0.1] — 2026-05-01

> **Released**: sdk 仓 commit `0d8c0a9` + tag `v1.0.1` → release.yml CI 全自动 npm publish。已通过 audit Part 2 实拉验证 (`npm i @acosmi/sdk-ts@1.0.1` consumer 视角 smoke `tsc --noEmit` 全绿,9 处 declare module 在 dist/node/index.d.ts 行 548/571/592/601/645/654/677/720/761 全包名)。

### Fixed

- **Layer 1 — packaging**:`tsup.config.ts` 三 entry 显式声明 `outExtension: ({ format }) => ({ js: format === 'esm' ? '.mjs' : '.cjs' })`,让产物与 `package.json.exports` 8 处 `.mjs` 引用对账。修复 1.0.0 在 bun / Node ESM 下 `Cannot find module '@acosmi/sdk-ts'`。
- **Layer 2 — d.ts augmentation**:9 处 `declare module` 由相对路径(`'../client'` / `'./client'`)改为包名 `'@acosmi/sdk-ts'`:
  - `src/client/{wallet,entitlements,packages,notifications,tools,skills}.ts`(6 处)
  - `src/{ws,sanitize-bridge,bug-report}.ts`(3 处)

  修复后 augmentation 在 consumer 视角合并到 inline `declare class Client`,50+ 方法(`getBalance` / `submitBugReport` / `browseSkills` / `getWalletStats` / `listNotifications` / `chat` 等)在 user 项目可正常 typecheck。
- **tsconfig.json**:附带加 `baseUrl` + `paths "@acosmi/sdk-ts": ["./src/client.ts"]`,让源码 typecheck 阶段 self-reference 也能合并到 class Client。

### Added

- **`scripts/smoke-pack.mjs`** + `prepublishOnly` 末尾追加 `&& npm run test:pack`:跨平台 Node 脚本(Windows + Linux/macOS),在 `npm publish` 前从 packed tarball 装临时 consumer 项目跑 `tsc --noEmit`,验证 9 处 augmentation 在 consumer 视角合并成功。拦截"源码 typecheck 过 / packed 产物 broken"模式(1.0.0 翻车的根因机制)。

## [1.0.0] — 2026-05-01 [DEPRECATED]

> **⚠ DEPRECATED**:双层 broken packaging。请升级到 1.0.1+:`npm install @acosmi/sdk-ts@latest`。
>
> 已通过 `npm deprecate @acosmi/sdk-ts@1.0.0 'broken packaging, use 1.0.1+'` 标记,安装时会显示 deprecation warning。

### 已知问题(已在 1.0.1 修复)

- `package.json.exports` 8 处 `.mjs` 引用指向不存在的文件(tsup 实际输出 `.js + .cjs`)— bun/Node ESM resolver 报 `Cannot find module`,仅 CJS `require()` 可用。
- 9 处 d.ts augmentation 用相对路径,packed 产物中路径不可解析 — `getBalance` / `submitBugReport` 等 50+ 方法在 consumer typecheck 时 TS2339(`Property X does not exist on type 'Client'`)。

### 端口源

- `acosmi-sdk-go` v1.0.0 全量端口
- 36/36 vitest 全绿,源码 typecheck/lint/build 0 错误
- 翻车机制:`prepublishOnly` 仅跑源码 typecheck/vitest/build,不验证 packed product 在 consumer 视角能否解析

[1.3.1]: https://github.com/acosmi/sdk-ts/releases/tag/v1.3.1
[1.3.0]: https://github.com/acosmi/sdk-ts/releases/tag/v1.3.0
[1.2.0]: https://github.com/acosmi/sdk-ts/releases/tag/v1.2.0
[1.1.0]: https://github.com/acosmi/sdk-ts/releases/tag/v1.1.0
[1.0.2]: https://github.com/acosmi/sdk-ts/releases/tag/v1.0.2
[1.0.1]: https://github.com/acosmi/sdk-ts/releases/tag/v1.0.1
[1.0.0]: https://www.npmjs.com/package/@acosmi/sdk-ts/v/1.0.0
