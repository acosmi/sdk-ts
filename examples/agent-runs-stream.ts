// examples/agent-runs-stream.ts — Agent Run Gateway 示例（创建 / 流式 / 本地工具 / 产物）。
//
// 演示：
//   1. 创建一个 agent run (client.agentRuns.create)
//   2. 流式消费 run 事件 (client.agentRuns.stream)，断线可 durable replay
//   3. 显式 opt-in 本地只读工具桥：处理 local_tool_request，回传 submitLocalToolResult
//   4. 下载产物 (downloadArtifact)
//   5. 处理 usage / settle 事件，从 UI 取消按钮安全调用 cancel
//
// 红线：
//   - 下游产品禁止直连 Nexus 内部 /api/v4/chat/completions 实现智能体循环，必须走
//     client.agentRuns。
//   - SDK 不内置任何 CrabDesign/CrabCode 专属文件读取逻辑；local_tool_request 只定义
//     协议，handler 由下游显式提供，allowedTools 用稳定 ASCII function name。
//   - 结算只用 provider/ADK 透传的精确 usage；exact !== true 时服务端释放 hold，
//     不会用估算 token 扣费。

import { Client, allScopes, AgentRunStreamError } from '@acosmi/sdk-ts';

async function main() {
  const serverURL = process.env.ACOSMI_SERVER_URL;
  if (!serverURL) {
    throw new Error('ACOSMI_SERVER_URL is required');
  }
  const client = await Client.create({ serverURL });
  await client.login('Agent Runs Example', allScopes());

  // 1) 创建 run。create 是 POST 副作用操作，401 不自动 refresh 重放。
  const run = await client.agentRuns.create({
    appId: 'crabdesign',
    mode: 'design',
    input: 'Create a landing page mockup for a fintech dashboard',
    activeSkillIds: ['brand-system'],
    knowledgeBaseIds: ['kb-product'],
    // 本地只读上下文策略：显式 opt-in，限制可用工具与读取上限。
    localContextPolicy: {
      enabled: true,
      readonly: true,
      maxBytes: 128_000,
      allowedTools: ['read_file'],
    },
    artifactPolicy: { enabled: true, maxFiles: 10 },
  });
  console.log('[run created] runId=', run.runId, 'status=', run.status);

  // 2) 流式消费。stream 支持 durable replay：断线后重连同一 run 会先回放已持久化事件。
  //    throwOnError:false → 自行消费 error 事件而不是直接抛 AgentRunStreamError。
  try {
    for await (const event of client.agentRuns.stream(run.runId, { throwOnError: false })) {
      switch (event.type) {
        case 'text_delta':
          process.stdout.write(event.text);
          break;
        case 'reasoning_delta':
          console.debug('\n[reasoning]', event.text);
          break;
        case 'local_tool_request': {
          // 3) 本地工具桥 — 由下游产品代码拥有，这里只是只读演示实现。
          const result = await handleLocalTool(event.name, event.input);
          await client.agentRuns.submitLocalToolResult(run.runId, {
            requestId: event.requestId,
            ok: result.ok,
            content: result.content,
            error: result.error,
          });
          break;
        }
        case 'artifact': {
          // 4) 下载产物 — GET 安全查询，允许单次 401 refresh 重试。
          const file = await client.agentRuns.downloadArtifact(run.runId, event.artifact.id);
          console.log('\n[artifact]', file.filename, file.contentType,
            file.data.byteLength, 'bytes');
          break;
        }
        case 'usage':
          console.log('\n[usage] totalTokens=', event.usage.totalTokens,
            'exact=', event.usage.exact);
          break;
        case 'settle':
          console.log('[settle] status=', event.settlement.status,
            'tokenRemaining=', event.settlement.tokenRemaining);
          break;
        case 'error':
          console.error('\n[error]', event.error.code, event.error.message);
          break;
        case 'done':
          console.log('\n[done] status=', event.status);
          break;
      }
    }
  } catch (e) {
    if (e instanceof AgentRunStreamError) {
      console.error('agent run stream error:', e.code, e.stage, 'retryable=', e.retryable);
    } else {
      throw e;
    }
  }

  // 5) cancel 可从 UI 取消按钮安全调用（即使 run 已结束也不会抛）。
  // await client.agentRuns.cancel(run.runId);
}

// 本地只读工具实现示例。生产环境只暴露受控的只读操作，拒绝越权路径。
async function handleLocalTool(
  name: string,
  input: unknown,
): Promise<{ ok: boolean; content?: unknown; error?: string }> {
  if (name !== 'read_file') {
    return { ok: false, error: `local tool rejected: unsupported tool ${name}` };
  }
  // 这里应做路径白名单校验后读取文件；示例仅返回占位内容。
  return { ok: true, content: { note: 'read-only local context placeholder', input } };
}

main().catch((err) => {
  console.error('agent runs example failed:', err);
  process.exit(1);
});
