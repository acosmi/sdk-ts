// 向量 (embeddings) + 重排序 (rerank) 端点 (v2.9.0)。
// 校验: 请求 URL/方法/body 正确 + 响应原样解析 (网关直通, 无 response.Success 包装)。
import { describe, expect, it } from 'vitest';
import { Client } from '../src';

const future = new Date(Date.now() + 60_000).toISOString();

function clientWithFetch(fetchImpl: typeof fetch): Client {
  const client = new Client({ serverURL: 'https://nexus.test', fetchImpl });
  client.tokens = {
    access_token: 'token-1',
    refresh_token: 'refresh-1',
    expires_at: future,
    scope: 'ai',
    client_id: 'client-1',
    server_url: 'https://nexus.test',
  };
  return client;
}

describe('client.embeddings', () => {
  it('POST /managed-models/:id/embeddings 携带 input/dimensions, 原样解析 OpenAI 响应', async () => {
    let capturedURL = '';
    let capturedMethod = '';
    let capturedBody: any = null;
    const client = clientWithFetch(async (url: any, init: any) => {
      capturedURL = String(url);
      capturedMethod = init?.method ?? '';
      capturedBody = init?.body ? JSON.parse(init.body) : null;
      return new Response(
        JSON.stringify({
          object: 'list',
          model: 'text-embedding-v4',
          data: [{ object: 'embedding', index: 0, embedding: [0.1, 0.2, 0.3] }],
          usage: { prompt_tokens: 5, total_tokens: 5 },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    });

    const resp = await client.embeddings('text-embedding-v4', { input: 'hello', dimensions: 512 });

    expect(capturedMethod).toBe('POST');
    expect(capturedURL).toContain('/managed-models/text-embedding-v4/embeddings');
    expect(capturedBody.input).toBe('hello');
    expect(capturedBody.dimensions).toBe(512);
    expect(resp.model).toBe('text-embedding-v4');
    expect(resp.data[0].embedding).toEqual([0.1, 0.2, 0.3]);
    expect(resp.usage.total_tokens).toBe(5);
  });
});

describe('client.rerank', () => {
  it('POST /managed-models/:id/rerank 携带 query/documents, 解析归一化结果', async () => {
    let capturedURL = '';
    let capturedBody: any = null;
    const client = clientWithFetch(async (url: any, init: any) => {
      capturedURL = String(url);
      capturedBody = init?.body ? JSON.parse(init.body) : null;
      return new Response(
        JSON.stringify({
          results: [
            { index: 1, relevance_score: 0.93, document: 'doc1' },
            { index: 0, relevance_score: 0.42, document: 'doc0' },
          ],
          usage: { total_tokens: 79 },
          model: 'gte-rerank-v2',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    });

    const resp = await client.rerank('gte-rerank-v2', {
      query: 'q',
      documents: ['doc0', 'doc1'],
      top_n: 2,
      return_documents: true,
    });

    expect(capturedURL).toContain('/managed-models/gte-rerank-v2/rerank');
    expect(capturedBody.query).toBe('q');
    expect(capturedBody.documents).toEqual(['doc0', 'doc1']);
    expect(capturedBody.top_n).toBe(2);
    expect(resp.results).toHaveLength(2);
    expect(resp.results[0].index).toBe(1);
    expect(resp.results[0].relevance_score).toBeCloseTo(0.93);
    expect(resp.results[0].document).toBe('doc1');
    expect(resp.usage.total_tokens).toBe(79);
  });
});
