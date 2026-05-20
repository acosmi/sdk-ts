# Changelog

All notable changes to `@acosmi/sdk-ts` will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

[1.3.0]: https://github.com/acosmi/sdk-ts/releases/tag/v1.3.0
[1.2.0]: https://github.com/acosmi/sdk-ts/releases/tag/v1.2.0
[1.1.0]: https://github.com/acosmi/sdk-ts/releases/tag/v1.1.0
[1.0.2]: https://github.com/acosmi/sdk-ts/releases/tag/v1.0.2
[1.0.1]: https://github.com/acosmi/sdk-ts/releases/tag/v1.0.1
[1.0.0]: https://www.npmjs.com/package/@acosmi/sdk-ts/v/1.0.0
