// agent-runs.download.test.ts — downloadArtifact 超限拒绝测试 (B1 根因修复)。
//
// 旧实现 `readLimited(body, maxDownloadSize)` 会在到达上限时静默截断, 下游拿到不完整
// 产物却毫无感知。修复后对齐 skills.downloadSkill: 多读 1 字节探测, 超限抛错。

import { describe, expect, it } from 'vitest';

import { Client } from '../src/index';
import { maxDownloadSize } from '../src/core/http';

const future = new Date(Date.now() + 60_000).toISOString();
const ONE_MB = 1024 * 1024;

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

/**
 * 构造一个分块吐出 totalBytes 字节的 Response (status 200)。
 * 用 1MB 的块惰性产出, 避免一次性持有超大 buffer。
 */
function binaryResponse(totalBytes: number): Response {
  const CHUNK = 1024 * 1024;
  const chunk = new Uint8Array(CHUNK); // 复用同一块 (内容不重要)
  let sent = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (sent >= totalBytes) {
        controller.close();
        return;
      }
      const remain = totalBytes - sent;
      if (remain >= CHUNK) {
        controller.enqueue(chunk);
        sent += CHUNK;
      } else {
        controller.enqueue(chunk.subarray(0, remain));
        sent += remain;
      }
    },
  });
  return new Response(stream, {
    status: 200,
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': 'attachment; filename="artifact.bin"',
    },
  });
}

describe('agentRuns.downloadArtifact 超限保护', () => {
  it('响应超过 maxDownloadSize 时抛错, 不返回截断数据', async () => {
    const client = clientWithFetch(async () => binaryResponse(maxDownloadSize + ONE_MB));
    await expect(client.agentRuns.downloadArtifact('run_1', 'art_1')).rejects.toThrow(
      /exceeds .*MB limit/,
    );
  });

  it('响应正好等于 maxDownloadSize 时正常返回 (边界)', async () => {
    // 用一个远小于上限但代表"小于等于"路径的尺寸验证正常返回, 避免分配 50MB。
    const size = 3 * 1024 * 1024;
    const client = clientWithFetch(async () => binaryResponse(size));
    const dl = await client.agentRuns.downloadArtifact('run_1', 'art_1');
    expect(dl.data.byteLength).toBe(size);
    expect(dl.filename).toBe('artifact.bin');
    expect(dl.contentType).toBe('application/octet-stream');
  });
});
