# PII 角色可见性矩阵 (v1.9.0+)

> 适用版本: `@acosmi/sdk-ts` v1.9.0+
> 对应主仓: K10a PII Aspect (`@FieldEncrypt` / `@Sensitive` 切面) + IMPL-A 角色严格化
> 最后更新: 2026-05-25

## 1. 背景

商品化 P1-P7 Phase 3 收口时, 主仓 (tk-dist Java) 完成两条根因修复并随 SDK v1.9.0
发布:

- **K10a PII Aspect**: `dist_invoice` / `dist_corporate_transfer` / `dist_refund_record`
  等 finance 表族 + `dist_lawyer_profile` 法律表族 + `dist_enterprise_*` 企业席位表族
  敏感列改走 `@FieldEncrypt` 切面真加密落盘. V63 列宽 VARCHAR→TEXT 兜密文; V64 backfill
  老明文 → v2 payload.

- **IMPL-A 角色严格化** (`SensitiveSerializer.normalizeAuthority`): yudao 通用
  `ROLE_ADMIN` / `ROLE_USER` / `INTERNAL` 三个老别名 fail-OPEN 升级为 platform_admin
  视角的隐患已根治. 调用方传 token 必须真有正式角色, 否则视同 guest.

SDK 边界: 类型注释只描述 PII 级别, 不内置脱敏逻辑 — 真实脱敏由后端 `PiiDesensitizer`
按角色返回不同字符串 (明文 / `***1234` / 全 `***`). SDK 调用方 (Web / Desktop / CLI)
需理解角色矩阵以正确渲染.

## 2. 4 角色枚举

来源: `SensitiveSerializer.normalizeAuthority` (主仓
`yudao-module-distribution/...impl/serializer/SensitiveSerializer.java`).

| 角色常量 | 含义 | 典型颁发方 |
| --- | --- | --- |
| `ROLE_PLATFORM_ADMIN` | 平台管理员 (跨租户) — 后台运营 / 客服 / 财务工作台 | 主仓 yudao admin 登录 + claim platform_admin |
| `ROLE_S2S` | 服务对服务调用 — Nexus Go 网关 / 微服务内部互调 | S2S Token (X-Service-Secret) |
| `ROLE_LAWYER` | 律师 — 仅查看自己执业资料 + 自己接单的案件 | C 端登录 + 律师资质审核通过 |
| `ROLE_CONSUMER` | 消费者 — 普通 C 端用户, 仅查看自己的数据 | C 端 OAuth (`/api/consumer/**`) |
| (guest / unknown) | 匿名 / 未登录 / 角色不匹配 | 无 token / Bearer 无效 / 角色字符串非上述 4 个 |

## 3. PII 级 × 角色矩阵

PII 分 3 级 (与 `@Sensitive(level=...)` 严格对齐):

- **L1 公开** — 任何场景明文 (id / orderId / amountFen / status / createdAt 等)
- **L2 半遮** — 部分场景半遮 (title / contactAddress / nickname / avatarUrl 等)
- **L3 仅 admin** — 强敏感字段, 默认全脱敏 (taxId / bankAccount / contactPhone /
  bankName / licenseNo / idCardNo 等)

| 角色 | L1 公开 | L2 半遮 | L3 仅 admin |
| --- | --- | --- | --- |
| `ROLE_PLATFORM_ADMIN` | 明文 | 明文 | 明文 |
| `ROLE_S2S` | 明文 | 明文 | 明文 |
| `ROLE_LAWYER` | 明文 | 明文 | 脱敏 (`***1234`) |
| `ROLE_CONSUMER` | 明文 | 明文 | 脱敏 (`***1234`) |
| (guest / unknown) | 明文 | 脱敏 | 脱敏 |

> **Note**: `ROLE_LAWYER` / `ROLE_CONSUMER` 自己的数据 L3 字段仍可通过专门的 admin 直读
> 端点 (`/api/distribution/**/me/decrypted`) 解密, 但默认 listMyXxx 端点走脱敏视图.
> SDK 类型上不强制 — 调用方按上下文判定.

## 4. Breaking Change — v1.9.0+ 旧别名失效

主仓 IMPL-A 角色严格化把以下 3 条 fail-OPEN 别名根治:

| 旧别名 (≤ v1.8.x) | 误升级到 (旧行为) | v1.9.0+ 处理 |
| --- | --- | --- |
| `ROLE_ADMIN` | `platform_admin` (L3 明文) | 视同 `guest` (L2/L3 全脱敏) |
| `ROLE_USER` | `consumer` (L1/L2 明文) | 视同 `guest` (L2/L3 全脱敏) |
| `INTERNAL` | `s2s` (L3 明文) | 视同 `guest` (L2/L3 全脱敏) |

### 集成方应对

1. **token 升级到正式角色**: yudao admin 后台 token 改派发 `ROLE_PLATFORM_ADMIN`;
   微服务 S2S 调用切到 `ROLE_S2S` claim; C 端 OAuth 已自动派发 `ROLE_CONSUMER`.
2. **fallback 走 guest 视角**: 升级期 (灰度) 旧 token 调用 `/api/distribution/admin/**`
   会拿到脱敏数据 — 这是设计内行为, 不是 bug.
3. **角色字符串大小写敏感**: 必须全大写 `ROLE_PLATFORM_ADMIN`, 小写 / 缺前缀的
   `platform_admin` 会被 `normalizeAuthority` 拒绝.

## 5. 实际生效字段示例

按 v1.9.0 SDK 主要类型清单 (与主仓 `@Sensitive` 注解严格对齐):

### finance namespace (`src/finance/types.ts`)

| 字段 | 级别 | 角色匹配后明文示例 | guest 视图 |
| --- | --- | --- | --- |
| `Invoice.id / invoiceNo / orderId / amountFen / status` | L1 | `INV20260525001` | 同 |
| `Invoice.title` | L2 | `Acosmi Tech Ltd` | `Acos*****td` |
| `Invoice.contactAddress` | L2 | `北京市朝阳区...` | `北京市*****` |
| `Invoice.taxId` | L3 | `91110108MA01ABC123` | `91**********23` |
| `Invoice.bankAccount` | L3 | `6225882104567890` | `6225********7890` |
| `Invoice.bankName` | L3 | `招商银行北京分行` | `招商***` |
| `Invoice.contactPhone` | L3 | `13800001234` | `138****1234` |

### enterprise namespace (`src/enterprise/types.ts`)

| 字段 | 级别 |
| --- | --- |
| `EnterpriseSummary.contactPhone` | L3 (仅 OWNER/ADMIN 可见) |
| `EnterpriseSummary.contactEmail` | L3 |
| `EnterpriseSummary.creditCode` | L2 |

### casehall namespace (`src/casehall/types.ts`)

| 字段 | 级别 |
| --- | --- |
| `LawyerSummary.licenseNo` | L3 (公开 listLawyers 已脱敏剥离, 仅 admin 直读) |
| `LawyerSummary.idCardNo` | L3 |
| `LawyerSummary.realName` | L2 |
| `CaseLead.disputeAmountFen` | L1 |
| `CaseLead.contactPhone` | L3 |

## 6. 脱敏算法引用

后端 `PiiDesensitizer` (主仓 `yudao-module-distribution/...PiiDesensitizer.java`) 按字段
类型自动派生脱敏策略:

| 策略 | 输入 | 输出 |
| --- | --- | --- |
| `PHONE` | `13800001234` | `138****1234` |
| `EMAIL` | `user@acosmi.com` | `u***@acosmi.com` |
| `ID_CARD` | `110101199001011234` | `1101**********1234` |
| `BANK_CARD` | `6225882104567890` | `6225********7890` |
| `NAME` | `张三丰` | `张*丰` |
| `ADDRESS` | `北京市朝阳区...` | `北京市*****` |
| `GENERIC` | 任意其他 L2/L3 字符串 | `XX*****XX` (前后 2 字符+中间星号) |

`@Sensitive(strategy=...)` 显式指定策略时优先; 否则按字段名启发 (字段名含 phone/mobile
→ PHONE, 含 email → EMAIL, 等).

## 7. 测试集成方应做的 mock

集成方 (Web / Desktop / 微服务) 在单测中应 mock 不同角色 token 切换, 验证渲染层正确处理:

```ts
// vitest 示例 — Web 端验证 admin 视图 vs guest 视图字段差异
import { describe, it, expect, vi } from 'vitest';
import { Client } from '@acosmi/sdk-ts';

describe('Invoice rendering across roles', () => {
  it('platform_admin sees L3 plain', async () => {
    // mock token 含 ROLE_PLATFORM_ADMIN claim
    const client = new Client({ serverURL, token: mintToken({ role: 'ROLE_PLATFORM_ADMIN' }) });
    const list = await client.listMyInvoices();
    expect(list[0].bankAccount).toMatch(/^\d{16}$/); // 明文
  });

  it('consumer sees L3 desensitized', async () => {
    const client = new Client({ serverURL, token: mintToken({ role: 'ROLE_CONSUMER' }) });
    const list = await client.listMyInvoices();
    expect(list[0].bankAccount).toMatch(/^\d{4}\*+\d{4}$/); // 6225********7890
  });

  it('guest (no token) sees L2/L3 desensitized', async () => {
    const client = new Client({ serverURL });
    // (公开列表端点, 无登录)
    const lawyers = await client.listLawyers();
    expect(lawyers.items[0].licenseNo).toBeUndefined(); // L3 直接剥字段
    expect(lawyers.items[0].realName).toMatch(/\*/); // L2 半遮
  });

  it('ROLE_ADMIN (legacy alias) is treated as guest in v1.9.0+', async () => {
    // 旧 yudao admin token, role=ROLE_ADMIN (无 platform_admin)
    const client = new Client({ serverURL, token: mintToken({ role: 'ROLE_ADMIN' }) });
    const list = await client.listMyInvoices();
    expect(list[0].bankAccount).toMatch(/\*/); // 视同 guest, L3 脱敏
  });
});
```

## 8. 参考链接

- 主仓 PII Aspect: `yudao-module-distribution/...impl/aspect/PiiEncryptAspect.java`
- 主仓角色规范化: `yudao-module-distribution/...impl/serializer/SensitiveSerializer.java`
- 主仓脱敏算法: `yudao-module-distribution/...impl/serializer/PiiDesensitizer.java`
- 主仓迁移 V51 (finance 表族加密): `nexus-v4/sql/yudao-server-v51-pii-encrypt-init.sql`
- 主仓迁移 V63 (列宽兜底): `nexus-v4/sql/yudao-server-v63-pii-column-text.sql`
- 主仓迁移 V64 (backfill): `nexus-v4/sql/yudao-server-v64-pii-backfill-v2.sql`
- SDK 类型注释: `src/finance/types.ts` `Invoice` JSDoc
