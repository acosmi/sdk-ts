// examples/compliance-read.ts — Compliance 只读查询示例。
//
// 演示：
//   1. OAuth 登录 (按业务最小集合申请 compliance scope)
//   2. 通过 evidence_no 做公开 verify (隐私边界：返回字段不含 PII / 合同原文 / storage)
//   3. 查询已申请的时间章 / 已发布的报告 / 已创建的签署 envelope
//
// 严禁：本示例 / SDK / 仓库不包含 provider endpoint、证书/密钥材料、口令、
// provider 原始报文、callback billing commit 字段。

import {
  Client,
  ScopeComplianceEvidenceRead,
  ScopeComplianceTimestampVerify,
  ScopeComplianceContractSigningRead,
  ScopeComplianceReportsRead,
} from '@acosmi/sdk-ts';

async function main() {
  const serverURL = process.env.ACOSMI_SERVER_URL;
  if (!serverURL) {
    throw new Error('ACOSMI_SERVER_URL is required');
  }
  const client = await Client.create({
    serverURL,
    // complianceBaseURL 不配置 → 默认 ${serverURL}/admin-api。
    // 如部署到独立 ingress，可通过 ACOSMI_COMPLIANCE_BASE_URL 显式设置。
    complianceBaseURL: process.env.ACOSMI_COMPLIANCE_BASE_URL,
  });

  await client.login('Compliance Read Example', [
    ScopeComplianceEvidenceRead,
    ScopeComplianceTimestampVerify,
    ScopeComplianceContractSigningRead,
    ScopeComplianceReportsRead,
  ]);

  // === 公开 verify ===
  // 通过对外稳定的 evidence_no 查询。该端点不要求 compliance scope（但带 token 可让审计完整）。
  const evidenceNo = process.env.EVIDENCE_NO ?? 'EV-2026-0001';
  const verifyResult = await client.compliance.verifyEvidencePublic({ evidenceNo });
  console.log('[public verify] manifest offline verify:', verifyResult.manifestOfflineVerify);
  console.log('[public verify] content hash:', verifyResult.contentHash);
  console.log('[public verify] verified at:', verifyResult.verifiedAt);
  // 注意：以下字段不在返回中（隐私边界）：
  //   - storageBucket / storageKey / subjectSnapshotId
  //   - 用户手机号 / 邮箱 / 真实姓名
  //   - 合同原文 / provider 内部主体 id / TSA 内部 object id

  // === 读时间章 / 报告 / envelope ===
  const tokenId = Number(process.env.TIMESTAMP_TOKEN_ID ?? 1);
  const token = await client.compliance.getTimestamp(tokenId);
  console.log('[timestamp]', token.id, 'serialNumber=', token.serialNumber,
    'status=', token.verificationStatus);

  const reportId = Number(process.env.REPORT_ID ?? 1);
  const report = await client.compliance.getReport(reportId);
  console.log('[report]', report.id, report.reportNo, 'status=', report.status);

  // 租户由 access token principal 推导，SDK 不发送 tenant-id header。
  const envelopeId = Number(process.env.ENVELOPE_ID ?? 0);
  if (envelopeId) {
    const envelope = await client.compliance.getSigningEnvelope(envelopeId);
    console.log('[envelope]', envelope.envelopeNo, 'status=', envelope.status,
      'pendingReason=', envelope.pendingReason);
  }
}

main().catch((err) => {
  console.error('compliance read example failed:', err);
  process.exit(1);
});
