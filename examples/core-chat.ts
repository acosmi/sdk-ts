// examples/core-chat.ts — Client 基础用法示例（构造 / 配置 / 模型列举 / chat / 流式）。
//
// 演示：
//   1. 构造 Client (serverURL + 可选 FileTokenStore)
//   2. OAuth 登录 (按业务最小集合申请 scope)
//   3. 列举托管模型 + 查看配额摘要
//   4. 同步 chat 调用
//   5. 流式 chatStreamWithUsage 并聚合 usage / 结算事件
//
// 说明：
//   - SDK 自动按 ManagedModel 的 preferred_format / supported_formats（snake_case
//     wire 字段）选 Anthropic 或 OpenAI adapter，调用方无需关心。详见
//     src/models/adapters/index.ts:getAdapterForModel。
//   - 金额 / 余额字段是 string（避免 JS number 精度损失），不要做浮点运算。
//   - ChatRequest 走 snake_case wire 字段（max_tokens 等），与上游 Go json tag 对齐；
//     ManagedModel 顶层多为 camelCase（modelId / isEnabled / inputModalities）。

import { Client, allScopes, FileTokenStore } from '@acosmi/sdk-ts';

async function main() {
  const serverURL = process.env.ACOSMI_SERVER_URL;
  if (!serverURL) {
    throw new Error('ACOSMI_SERVER_URL is required');
  }

  // 1) 构造 Client。Client.create 会从 store 异步加载已持久化的 token。
  //    Node 上不传 store 时默认 ~/.acosmi/tokens.json；这里显式指定一个路径。
  const client = await Client.create({
    serverURL,
    store: new FileTokenStore(process.env.ACOSMI_TOKEN_FILE ?? './core-tokens.json'),
  });

  // 2) OAuth 登录 — 已有有效 token 时 login 会直接复用，不重复弹浏览器。
  await client.login('Core Chat Example', allScopes());

  // 3) 列举托管模型 + 配额摘要
  const models = await client.listModels();
  console.log('[models]', models.length, 'available');
  for (const m of models.slice(0, 5)) {
    console.log('  -', m.modelId, `(provider=${m.provider}, enabled=${m.isEnabled})`);
  }

  const quota = await client.getQuotaSummary();
  console.log('[quota] freeTotalEtu=', quota.freeTotalEtu,
    'paidTotalEtu=', quota.paidTotalEtu);

  // 选一个模型：优先 isDefault，否则取第一个启用的。
  const model =
    models.find((m) => m.isDefault && m.isEnabled) ??
    models.find((m) => m.isEnabled);
  if (!model) {
    throw new Error('no enabled model available — 让管理员在网关启用一个模型');
  }
  console.log('[selected model]', model.modelId);

  // 4) 同步 chat 调用
  const resp = await client.chat(model.modelId, {
    messages: [{ role: 'user', content: '用一句话介绍 TypeScript。' }],
    max_tokens: 256,
  });
  for (const block of resp.content) {
    if (block.type === 'text' && block.text) {
      console.log('[chat text]', block.text);
    }
  }
  console.log('[chat usage] input=', resp.usage.input_tokens,
    'output=', resp.usage.output_tokens);

  // 5) 流式调用 — chatStreamWithUsage 把内容 / sources / 结算事件分流为带标签的迭代项。
  const stream = client.chatStreamWithUsage(model.modelId, {
    messages: [{ role: 'user', content: '写一首关于海的两行短诗。' }],
    max_tokens: 512,
  });
  for await (const item of stream) {
    if (item.kind === 'content' && item.event.event === 'content_block_delta') {
      process.stdout.write('.'); // 实际项目里在此解析 delta 输出 token
    } else if (item.kind === 'settle') {
      console.log('\n[settle] totalTokens=', item.event.totalTokens,
        'tokenRemaining=', item.event.tokenRemaining);
    }
  }
  console.log('\n[stream] done');
}

main().catch((err) => {
  console.error('core chat example failed:', err);
  process.exit(1);
});
