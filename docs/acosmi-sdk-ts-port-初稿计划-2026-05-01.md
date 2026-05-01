# TS SDK v1.0.0 端口 — 初稿计划

> **版本**: 初稿 (draft v1)
> **日期**: 2026-05-01
> **作者**: Claude (会话产出)
> **状态**: 等待用户拍板 4 个决策点后转正式实施方案

---

## 背景

Go SDK `acosmi-sdk-go/` 即将发布 v1.0.0 正式版（当前 v0.19.0，2026-04-29 release）。v1.0.0 主要做"加固 + 修复根本性错误"，功能上没大改变。

下游需要 TypeScript 版 SDK，要求：
- 多端：浏览器 + Node.js + Deno/Bun 都要
- 全量功能对齐
- 版本号严格对齐 Go SDK
- 内部下游项目消费

**关键约束 (用户 2026-05-01 明示)**：
> SDK 模型网关同时提供 OpenAI 兼容格式和 Anthropic 兼容格式两条路径，**给两个不同下游产品使用**。

代码核实确认 (`acosmi-sdk-go/adapter.go:1-104`)：
- `POST /managed-models/:id/anthropic` ← AnthropicAdapter
- `POST /managed-models/:id/chat` ← OpenAIAdapter
- 路由由 `getAdapterForModel` 按 ManagedModel 的 `PreferredFormat` / `SupportedFormats` 选择 (v0.10.0 capability-driven 路由)

**红线**：TS SDK 必须同等支持两种格式，不能合并、不能降级、不能"以一为主"。

---

## 一、对齐目标与开工时机

- **目标版本**：v1.0.0（不是 v0.19.0）
- **建议时机**：**等 v1.0.0 release 再正式开工**
  - 理由：v1.0 主要做"加固 + 根本性 bug 修复"，这些修复会改 API 行为/错误码/字段含义，提前端口等于踩同样的坑两次
  - 现在可以做的：脚手架（package.json/tsconfig/构建配置/CI）+ 调研档，**不动业务代码**
- **首发版本号**：直接 v1.0.0，与 Go 同步发，避免 0.x 段时期不一致带来的混淆

---

## 二、架构核心原则（红线）

1. **双 adapter 等地位**：AnthropicAdapter + OpenAIAdapter 两条路径都是一等公民，因为分别对应两个不同下游产品。任何"合并"、"以一为主"的优化都不允许
2. **路由逻辑镜像 Go**：`getAdapterForModel` 的四级决策一字不差搬过来
   1. PreferredFormat 非空 → 按值 (anthropic | openai)
   2. SupportedFormats 含 anthropic → AnthropicAdapter
   3. SupportedFormats 含 openai → OpenAIAdapter
   4. 两字段均空 (旧上游) → 按 provider 名回落 (anthropic/acosmi → AnthropicAdapter, 其他 → OpenAIAdapter)
3. **接口对称**：TS 的 `ProviderAdapter` interface 镜像 Go 版（Format / EndpointSuffix / BuildRequestBody / ParseResponse / ParseStreamLine 五个方法）

---

## 三、多端策略

| 能力 | 浏览器 | Node ≥18 | Deno/Bun | 实现 |
|-----|-------|---------|---------|------|
| HTTP | fetch | fetch | fetch | 全平台原生 |
| SSE | ReadableStream | ReadableStream | ReadableStream | 自写 SSE parser ~80 行 |
| WS | WebSocket | WebSocket(v22)/`ws` | WebSocket | 接口统一 |
| TokenStore | LocalStorage/IndexedDB | File(`~/.acosmi/tokens.json`) | File | async 接口，按环境自动选 |

**构建**：`tsup` 出 ESM + CJS + `.d.ts`，`exports` 字段按环境分发。

```json
{
  "exports": {
    ".": {
      "browser": "./dist/browser/index.mjs",
      "deno": "./dist/index.mjs",
      "node": {
        "import": "./dist/node/index.mjs",
        "require": "./dist/node/index.cjs"
      },
      "default": "./dist/index.mjs"
    }
  }
}
```

---

## 四、端口范围（v1.0.0 完整 surface）

按 v0.19.0 实际现状（含 v0.10-v0.19 全部新增）：

| Go 模块 | TS 对应 | 优先级 | 备注 |
|--------|--------|--------|------|
| `client.go` (2168 行) | `client/` 按域拆 (chat/balance/skill/wallet/models/ws) | P0 | 太大必须拆，不能照搬一个文件 |
| `adapter_anthropic.go` (228 行) | `adapters/anthropic.ts` | **P0 红线** | 双产品红线 |
| `adapter_openai.go` (535 行) | `adapters/openai.ts` | **P0 红线** | 双产品红线 |
| `auth.go` (474 行) | `auth.ts` | P0 | token 三态 → Promise 模式 |
| `retry.go` (186 行, v0.15.1) | `retry.ts` | P1 | AbortController 替代 context |
| `sanitize/` (~390 行, v0.11.0) | `sanitize/` 子包 | P1 | bug-for-bug 端口，共享 fixture |
| `betas.go` (88 行) | `betas.ts` | P0 | |
| `types.go` (1275 行) | `types.ts` | P0 | 大块直翻 |
| `stream_meta.go` (77 行) | `stream-meta.ts` | P1 | |
| `ws.go` (308 行) | `ws.ts` | P2 | 跨端实现差异最大 |
| `bug_report.go` (113 行, v0.17.0) | `bug-report.ts` | P2 | |
| `scopes.go` (44 行) | `scopes.ts` | P0 | |

### v0.9.0 → v0.19.0 演进 (port 时不能漏)

| Tag | 关键变更 | 必须包含在 TS port |
|-----|---------|-------------------|
| v0.10.0 | capability-driven adapter 路由根治 tool_reference 400 | ✅ 双格式红线源头 |
| v0.11.0 | sanitize 独立子包 + StreamEvent block 元数据 + in-band ephemeral | ✅ |
| v0.13.0 | OpenAI 格式翻译矩阵扩充 | ✅ |
| v0.14.0 | 冷缓存根治 + ManagedModel 多 profile + ModelNotFoundError | ✅ |
| v0.15.1 | RetryPolicy + 错误类型化 + ensureToken 三态等待 | ✅ |
| v0.15.2 | StripEphemeral thinking 硬豁免 | ✅ sanitize 边界 case |
| v0.16.0 | V29 Per-Model Bucket + SupportsMaxEffort | ✅ |
| v0.17.0 | CrabCode bug 报告端点 | ✅ |
| v0.18.1 | ListModelsWithStatus + BucketClass 常量 | ✅ |
| v0.19.0 | 钱包总览 + 免费/付费切分 | ✅ |

---

## 五、仓库与发布

```
Chat-Acosmi/
├── acosmi-sdk-go/     ← 现有，subtree → Acosmi/acosmi-sdk-go
└── acosmi-sdk-ts/     ← 新建（本档所在），subtree → Acosmi/acosmi-sdk-ts
```

- 包名：建议 `@acosmi/sdk`（**待你拍**）
- 发布：私有 npm registry / GitHub Packages（**待你拍**）
- **版本严格对齐**：Go v1.0.0 release → TS v1.0.0 同号发布，CI 卡校验

---

## 六、版本同步机制（关键）

| 方案 | 成本 | 约束力 | 推荐 |
|-----|------|-------|------|
| 纯人工 hand-sync | 低 | 弱（半年 11 个 release 必漂） | ❌ |
| Go release CI 自动开 TS PR | 中 | 强 | ✅ 主线 |
| types 从 Go AST codegen | 高 | 最强 | 暂不做，留给 v2 |
| 测试 fixture 共享（同一份 testdata JSON） | 低 | 强 | ✅ 必做 |

**主线**：CI 钩子 + 共享 fixture，不上 codegen。

### 共享 fixture 落地

- 共用目录：`acosmi-sdk-go/testdata/` ↔ `acosmi-sdk-ts/testdata/`（symlink 或 CI 复制）
- sanitize / SSE / 错误类型化等三个有明确输入输出的子系统首先必须共享 fixture
- adapter 的 BuildRequestBody / ParseResponse / ParseStreamLine 三个方法的入参出参做 JSON fixture

---

## 七、关键决策点（需要用户拍板）

1. **哪两个产品**消费 SDK？分别用哪种格式？这影响 P0/P1 排期和测试矩阵
2. **包名**：`@acosmi/sdk` / `@acosmi/sdk-ts` / 其他？
3. **私有 registry**：GitHub Packages / 阿里云 npm / verdaccio 自建？
4. **sanitize 子包端口策略**：bug-for-bug 端口（同一份 fixture 双跑）vs 按 spec 重写（clean room）？
   - 倾向：前者，因为 sanitize 本质是历史污染兜底，行为一致性 > 代码优雅
5. **v1.0.0 预计 release 时间窗**？决定脚手架开工节奏

---

## 八、风险公示

| 风险 | 影响 | 缓解 |
|-----|------|------|
| v1.0.0 时间窗未知 | 排期不确定 | 边等边搭脚手架/CI，不动业务代码 |
| sanitize ~390 行字符串处理 | 浏览器/Node 侧 unicode/空白字符串处理细节漂 | 双仓共享 fixture (`sanitize/testdata/*.json`) |
| WebSocket 跨端 | 浏览器 / Node v22 native / `ws` 包三种实现行为差 | 专门测试矩阵 + 抽象层封装 |
| TokenStore async 化 | Go 同步、TS 必须 async，调用方写法变 | 不可逆破坏，doc 写清楚；首发即固化接口 |
| Go SDK 持续迭代 | TS 漂移 | CI 钩子 + 测试 fixture 共享 |
| 双 adapter 红线被忽略 | 两产品其一不可用 | 架构原则首条 + code review 显式 checklist |

---

## 九、初稿里程碑（v1.0.0 release 之后）

| 阶段 | 内容 | 工期估 |
|-----|------|-------|
| M0 | 等 v1.0.0 release | 并行搭脚手架/CI |
| M1 | types + auth + 双 adapter + chat 同步 | ~1 周 |
| M2 | SSE 流式 + retry + 错误类型化 | ~1 周 |
| M3 | sanitize 子包（含共享 fixture）+ stream-meta + scopes | ~1 周 |
| M4 | ws + bug-report + wallet/balance/models 全 API | ~1 周 |
| M5 | 多端测试矩阵 + CI 版本同步钩子 + npm 首发 | ~3 天 |

**总计**：v1.0.0 release 后约 4-5 周到 TS v1.0.0 GA。

---

## 十、待办（决策落地后)

- [ ] 用户拍板 §七 5 个决策点
- [ ] 根据决策更新本档为正式实施方案 (v2)
- [ ] 搭脚手架（package.json / tsconfig / tsup 配置 / CI）
- [ ] 等 v1.0.0 release
- [ ] 按 M1-M5 推进
- [ ] 共享 fixture 落地（symlink or CI 复制策略）

---

## 附：本初稿生成过程的事实核实清单

1. **当前 SDK 版本**：v0.19.0
   - 来源：`git tag --sort=-v:refname | head -20`
   - 错误教训：会话初期我引用了 14 天前 stale memory 的 v0.9.0，被用户纠正后核实
2. **双格式架构**：
   - 来源：`acosmi-sdk-go/adapter.go:1-104` 直接 Read
   - `getAdapterForModel` 四级决策已逐字记录
3. **v0.9.0 → v0.19.0 演进**：
   - 来源：`git log v0.9.0..v0.19.0 --oneline` 18 个 commit, 11 个 release tag
4. **Go 模块行数**：
   - 来源：`wc -l acosmi-sdk-go/*.go` 实测
5. **未核实事实（公示）**：
   - 哪两个下游产品使用 SDK — 用户未告知
   - v1.0.0 预计 release 时间 — 用户未告知
   - 内部 npm registry 是否已存在 — 未查证
