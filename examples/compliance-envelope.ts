// examples/compliance-envelope.ts — Signing envelope + step-up / gate 错误处理示例。
//
// 演示：
//   1. 创建合同签署 envelope
//   2. 查询 envelope 状态
//   3. 正确处理 step-up / gate closed 错误（不重试、不伪成功）
//   4. 查询 provider request 脱敏状态（SUCCESS 不等于扣费 commit）
//
// 红线：
//   - 不传 provider 侧印章、项目或主体字段；这些由后端归一映射。
//   - sign / h5-url 在后端闸门关闭时会返回稳定错误，SDK 不重试、不伪成功。
//   - provider success 不等于 billing committed；最终扣费状态以 envelope 业务字段为准。

import {
  BusinessError,
  Client,
  CompliancePollError,
  ScopeComplianceContractSigningRead,
  ScopeComplianceContractSigningWrite,
  ScopeComplianceSealApprovalRequest,
  classifyComplianceError,
  isComplianceBusinessError,
} from '@acosmi/sdk-ts';

async function main() {
  const serverURL = process.env.ACOSMI_SERVER_URL;
  if (!serverURL) {
    throw new Error('ACOSMI_SERVER_URL is required');
  }
  const client = await Client.create({
    serverURL,
    complianceBaseURL: process.env.ACOSMI_COMPLIANCE_BASE_URL,
  });

  await client.login('Envelope Example', [
    ScopeComplianceContractSigningRead,
    ScopeComplianceContractSigningWrite,
    ScopeComplianceSealApprovalRequest,
  ]);

  // 1) 创建 envelope (DRAFT)
  const envelopeKey = `envelope-${Date.now()}`;
  const envelopeId = await client.compliance.createSigningEnvelope(
    {
      envelopeNo: `EV-${Date.now()}`,
      requestId: envelopeKey,
      billingGroupId: `BG-${Date.now()}`,
    },
    { idempotencyKey: envelopeKey },
  );
  console.log('[envelope created] id=', envelopeId);

  // 2) 查询 envelope 详情
  const envelope = await client.compliance.getSigningEnvelope(envelopeId);
  console.log('[envelope detail]', envelope.envelopeNo,
    'status=', envelope.status,
    'pendingReason=', envelope.pendingReason);

  // 3) 试调用 sign — 后端闸门关闭时会失败（ENVELOPE_GATE_CLOSED）
  try {
    await client.compliance.signEnvelope(envelopeId, {
      contractHash: 'dummy-hash',
      idempotencyKey: `sign-${envelopeKey}`,
    });
  } catch (e) {
    if (e instanceof BusinessError && isComplianceBusinessError(e)) {
      const info = classifyComplianceError(e);
      if (info.stepUpRequired) {
        console.warn('[sign] step-up required — 请引导用户重新做 OAuth introspection / 重登录后用同一 idempotency-key 重试');
      } else if (info.key === 'ENVELOPE_GATE_CLOSED') {
        console.warn('[sign] gate closed — 后端闸门未开放，不要重试，向用户展示"功能开放中"');
      } else if (info.terminal) {
        console.warn('[sign] terminal:', info.key, '— 重试无用');
      } else {
        console.warn('[sign] business error:', info.key, info.message);
      }
    } else {
      console.error('[sign] unexpected error:', e);
    }
  }

  // 4) 查询 provider request 状态 (脱敏)
  const providerRequestId = Number(process.env.PROVIDER_REQUEST_ID ?? 0);
  if (providerRequestId) {
    try {
      const view = await client.compliance.waitForProviderRequestTerminal(providerRequestId, {
        timeoutMs: 30_000,
      });
      console.log('[provider request terminal] status=', view.status,
        'terminal=', view.terminal,
        'retryable=', view.retryable);
      if (view.status === 'SUCCESS') {
        console.log('NOTE: provider SUCCESS 不等于 billing committed；以 envelope 的 committedAt 字段为准。');
      }
    } catch (e) {
      if (e instanceof CompliancePollError) {
        if (e.kind === 'timeout') {
          console.warn('[provider request] still pending — DO NOT 重发原请求；下次查询/对账');
        } else if (e.kind === 'terminal_failure') {
          console.warn('[provider request] FAILED — 走人工对账');
        }
      } else {
        throw e;
      }
    }
  }
}

main().catch((err) => {
  console.error('envelope example failed:', err);
  process.exit(1);
});
