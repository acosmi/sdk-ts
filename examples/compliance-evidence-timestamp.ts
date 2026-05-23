// examples/compliance-evidence-timestamp.ts — hash-only evidence + timestamp 链路示例。
//
// 演示：
//   1. 本地对普通业务内容做 sha256 (不传原文)
//   2. 创建 hash-only evidence asset
//   3. 给资产申请时间章 (持久化 Idempotency-Key)
//   4. polling 等到本地 verify 通过
//   5. 构建 evidence package
//   6. 下载报告所需的离线复核 VO
//
// 红线：
//   - 不传 provider 字段；服务端按配置选 provider。
//   - 不读取证书/密钥材料或 provider 签名材料；这些是后端实现细节。
//   - Idempotency-Key 必须在内存外持久化，重启 / 重试时复用同一 key。

import { createHash } from 'node:crypto';
import {
  Client,
  CompliancePollError,
  ScopeComplianceEvidenceRead,
  ScopeComplianceEvidenceWrite,
  ScopeComplianceTimestampIssue,
  ScopeComplianceTimestampVerify,
  ScopeComplianceReportsRead,
  ScopeComplianceReportsWrite,
} from '@acosmi/sdk-ts';

// 模拟持久化的 Idempotency-Key 存储；生产环境应落 DB / 本地文件 / 业务订单表。
const KEY_STORE = new Map<string, string>();

function loadOrCreateKey(slot: string): string {
  let key = KEY_STORE.get(slot);
  if (!key) {
    key = `${slot}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    KEY_STORE.set(slot, key);
  }
  return key;
}

async function main() {
  const serverURL = process.env.ACOSMI_SERVER_URL;
  if (!serverURL) {
    throw new Error('ACOSMI_SERVER_URL is required');
  }
  const client = await Client.create({
    serverURL,
    complianceBaseURL: process.env.ACOSMI_COMPLIANCE_BASE_URL,
  });

  await client.login('Evidence + Timestamp Example', [
    ScopeComplianceEvidenceRead,
    ScopeComplianceEvidenceWrite,
    ScopeComplianceTimestampIssue,
    ScopeComplianceTimestampVerify,
    ScopeComplianceReportsRead,   // getReport / downloadReport
    ScopeComplianceReportsWrite,  // createReport（v1.3.2 起从 read 切到独立 write scope）
  ]);

  // 1) 本地 sha256 (用户业务内容)
  const content = Buffer.from('release v1.2.3 manifest line-1\nrelease v1.2.3 manifest line-2', 'utf8');
  const sha256 = createHash('sha256').update(content).digest('hex');

  // 2) 创建 hash-only evidence asset
  const assetKey = loadOrCreateKey('asset:release-v1.2.3');
  const asset = await client.compliance.createEvidenceAsset(
    {
      assetType: 'HASH_ONLY',
      name: 'release-v1.2.3.manifest',
      hashAlgorithm: 'sha256',
      declaredHash: sha256,
      digestSource: 'CLIENT',
      privacyLevel: 'private',
    },
    { idempotencyKey: assetKey },
  );
  console.log('[asset]', asset.id, asset.evidenceNo);

  // 3) 申请时间章 — Idempotency-Key 持久化复用
  const tsKey = loadOrCreateKey('ts:release-v1.2.3');
  const token = await client.compliance.issueTimestampForAsset(asset.id, {
    idempotencyKey: tsKey,
  });
  console.log('[timestamp issued]', token.id, 'status=', token.verificationStatus);

  // 4) polling 到本地 verify 通过
  try {
    const verified = await client.compliance.waitForTimestampVerified(token.id, {
      timeoutMs: 60_000,
      initialIntervalMs: 1_000,
      maxIntervalMs: 5_000,
    });
    console.log('[timestamp verified] serial=', verified.serialNumber,
      'genTime=', verified.genTime);
  } catch (e) {
    if (e instanceof CompliancePollError && e.kind === 'terminal_failure') {
      console.error('time stamp local verify failed — DO NOT retry with same key; 起新链路');
      throw e;
    }
    if (e instanceof CompliancePollError && e.kind === 'timeout') {
      console.warn('timestamp still UNKNOWN; polling timed out — wait for sync or retry later');
      return; // 不自动重发原 provider 请求
    }
    throw e;
  }

  // 5) 构建 evidence package
  const pkgKey = loadOrCreateKey('pkg:release-v1.2.3');
  const pkg = await client.compliance.buildEvidencePackage(asset.id, token.id, {
    idempotencyKey: pkgKey,
  });
  console.log('[package]', pkg.id, 'manifestHash=', pkg.manifestHash,
    'packageHash=', pkg.packageHash);

  // 6) 创建报告并下载离线复核 VO
  const reportKey = loadOrCreateKey('report:release-v1.2.3');
  const report = await client.compliance.createReport(
    { assetId: asset.id, packageId: pkg.id },
    { idempotencyKey: reportKey },
  );
  const download = await client.compliance.downloadReport(report.id);
  console.log('[report download]', download.reportNo,
    'assetHash=', download.assetContentHash,
    'tsSerial=', download.timestampSerialNumber);

  // 持久化 download 到本地文件作为长期可重复验证依据
  // fs.writeFileSync(`./compliance-evidence/${download.reportNo}.json`, JSON.stringify(download, null, 2));
}

main().catch((err) => {
  console.error('evidence + timestamp example failed:', err);
  process.exit(1);
});
