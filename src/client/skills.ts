// client/skills.ts — 端口自 acosmi-sdk-go/client.go (Skill Store + Generator section)

import type {
  APIResponse,
  CertificationStatus,
  GenerateSkillRequest,
  GenerateSkillResult,
  OptimizeSkillRequest,
  OptimizeSkillResult,
  SkillBrowseListResponse,
  SkillBrowseResponse,
  SkillStoreItem,
  SkillStoreQuery,
  SkillSummary,
} from '../types';
import { RateLimitError } from '../types';
import { Client } from '../client';
import {
  classifyTransport,
  maxDownloadSize,
  maxErrorBodySize,
  parseHTTPErrorWithHeader,
  readLimited,
  readLimitedText,
} from '../client-helpers';

declare module '../client' {
  interface Client {
    /** 浏览技能商店 (公共端点, 无需认证) */
    browseSkillStore(query: SkillStoreQuery, signal?: AbortSignal): Promise<SkillStoreItem[]>;
    /** 浏览公共技能商店 (V3 分页接口) */
    browseSkills(
      page: number,
      pageSize: number,
      category: string,
      keyword: string,
      tag: string,
      source: string,
      signal?: AbortSignal,
    ): Promise<SkillBrowseResponse>;
    /** 轻量浏览公共技能商店 (fields=minimal, 响应体积缩减 90%+) */
    browseSkillsList(
      page: number,
      pageSize: number,
      category: string,
      keyword: string,
      tag: string,
      source: string,
      signal?: AbortSignal,
    ): Promise<SkillBrowseListResponse>;
    /** 获取技能商店中某个技能的详情 (公共端点) */
    getSkillDetail(skillID: string, signal?: AbortSignal): Promise<SkillStoreItem>;
    /** 按 key 精确查找公共技能 (公共端点) */
    resolveSkill(key: string, signal?: AbortSignal): Promise<SkillStoreItem>;
    /** 安装技能到当前用户的租户空间 (需 OAuth scope: skill_store) */
    installSkill(skillID: string, signal?: AbortSignal): Promise<SkillStoreItem>;
    /**
     * 下载技能 ZIP 包 (公共端点, 双模式)
     * 有 token 时自动附带 (享受无限流), 无 token 时匿名 (受限流)
     * @returns [data, filename]; 限流时抛 RateLimitError
     */
    downloadSkill(skillID: string, signal?: AbortSignal): Promise<{ data: Uint8Array; filename: string }>;
    /**
     * 上传技能 ZIP 包
     * @param scope "TENANT"
     * @param intent "PERSONAL" (仅自己用) 或 "PUBLIC_INTENT" (走认证→公开)
     */
    uploadSkill(zipData: Uint8Array, scope: string, intent: string, signal?: AbortSignal): Promise<SkillStoreItem>;
    /** 获取技能统计概览 */
    getSkillSummary(signal?: AbortSignal): Promise<SkillSummary>;
    /** 触发技能认证管线 (异步) */
    certifySkill(skillID: string, signal?: AbortSignal): Promise<void>;
    /** 查询技能认证状态 */
    getCertificationStatus(skillID: string, signal?: AbortSignal): Promise<CertificationStatus>;
    /** 根据自然语言描述生成技能定义 (基于独立 LLM) */
    generateSkill(req: GenerateSkillRequest, signal?: AbortSignal): Promise<GenerateSkillResult>;
    /** 优化已有技能定义 */
    optimizeSkill(req: OptimizeSkillRequest, signal?: AbortSignal): Promise<OptimizeSkillResult>;
    /** 校验技能定义正确性 */
    validateSkill(skillName: string, signal?: AbortSignal): Promise<void>;
  }
}

Client.prototype.browseSkillStore = async function (
  this: Client,
  query: SkillStoreQuery,
  signal?: AbortSignal,
) {
  const resp = await this.browseSkills(
    1,
    50,
    query.category ?? '',
    query.keyword ?? '',
    query.tag ?? '',
    '',
    signal,
  );
  return resp.items;
};

Client.prototype.browseSkills = async function (
  this: Client,
  page: number,
  pageSize: number,
  category: string,
  keyword: string,
  tag: string,
  source: string,
  signal?: AbortSignal,
) {
  const qv = new URLSearchParams();
  qv.set('page', String(page));
  qv.set('pageSize', String(pageSize));
  if (category) qv.set('category', category);
  if (keyword) qv.set('keyword', keyword);
  if (tag) qv.set('tag', tag);
  if (source) qv.set('source', source);
  const resp = await this.doPublicJSON<APIResponse<SkillBrowseResponse>>(
    'GET',
    `/skill-store?${qv.toString()}`,
    null,
    signal,
  );
  return resp.data;
};

Client.prototype.browseSkillsList = async function (
  this: Client,
  page: number,
  pageSize: number,
  category: string,
  keyword: string,
  tag: string,
  source: string,
  signal?: AbortSignal,
) {
  const qv = new URLSearchParams();
  qv.set('page', String(page));
  qv.set('pageSize', String(pageSize));
  qv.set('fields', 'minimal');
  if (category) qv.set('category', category);
  if (keyword) qv.set('keyword', keyword);
  if (tag) qv.set('tag', tag);
  if (source) qv.set('source', source);
  const resp = await this.doPublicJSON<APIResponse<SkillBrowseListResponse>>(
    'GET',
    `/skill-store?${qv.toString()}`,
    null,
    signal,
  );
  return resp.data;
};

Client.prototype.getSkillDetail = async function (
  this: Client,
  skillID: string,
  signal?: AbortSignal,
) {
  const resp = await this.doPublicJSON<APIResponse<SkillStoreItem>>(
    'GET',
    `/skill-store/${encodeURIComponent(skillID)}`,
    null,
    signal,
  );
  return resp.data;
};

Client.prototype.resolveSkill = async function (
  this: Client,
  key: string,
  signal?: AbortSignal,
) {
  const resp = await this.doPublicJSON<APIResponse<SkillStoreItem>>(
    'GET',
    `/skill-store/resolve/${encodeURIComponent(key)}`,
    null,
    signal,
  );
  return resp.data;
};

Client.prototype.installSkill = async function (
  this: Client,
  skillID: string,
  signal?: AbortSignal,
) {
  const resp = await this.doJSON<APIResponse<SkillStoreItem>>(
    'POST',
    `/skill-store/${encodeURIComponent(skillID)}/install`,
    null,
    signal,
  );
  return resp.data;
};

Client.prototype.downloadSkill = async function (
  this: Client,
  skillID: string,
  signal?: AbortSignal,
) {
  // 5min 超时 (大文件下载)
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 5 * 60 * 1000);
  let parentHandler: (() => void) | undefined;
  if (signal) {
    if (signal.aborted) ctl.abort();
    else {
      parentHandler = () => ctl.abort();
      signal.addEventListener('abort', parentHandler);
    }
  }

  try {
    const url = this.apiURL(`/skill-store/${encodeURIComponent(skillID)}/download`);
    const headers: Record<string, string> = {};
    let token = '';
    try {
      token = await this.ensureToken(ctl.signal);
    } catch {
      // 公共端点允许无 token
    }
    if (token) headers['Authorization'] = `Bearer ${token}`;

    let resp: Response;
    try {
      resp = await this.fetchImpl(url, { method: 'GET', headers, signal: ctl.signal });
    } catch (e) {
      throw classifyTransport('GET ' + `/skill-store/${skillID}/download`, url, e);
    }

    if (resp.status === 429) {
      const bodyText = await readLimitedText(resp.body!, maxErrorBodySize);
      throw new RateLimitError('匿名下载已达限制', resp.headers.get('Retry-After') ?? '', bodyText);
    }

    if (!resp.ok) {
      const bodyBytes = await readLimited(resp.body!, maxErrorBodySize);
      throw new Error(
        `download skill: ${parseHTTPErrorWithHeader(resp.status, bodyBytes, resp.headers).message}`,
      );
    }

    const data = await readLimited(resp.body!, maxDownloadSize + 1);
    if (data.byteLength > maxDownloadSize) {
      throw new Error(`download skill: response exceeds ${maxDownloadSize >> 20}MB limit`);
    }

    let filename = 'skill.zip';
    const cd = resp.headers.get('Content-Disposition');
    if (cd) {
      const idx = cd.indexOf('filename');
      if (idx !== -1) {
        const parts = cd.slice(idx).split('=', 2);
        if (parts.length === 2) {
          filename = parts[1]!.trim().replace(/^["' ]+|["' ]+$/g, '');
        }
      }
    }

    return { data, filename };
  } finally {
    clearTimeout(timer);
    if (parentHandler && signal) signal.removeEventListener('abort', parentHandler);
  }
};

Client.prototype.uploadSkill = async function (
  this: Client,
  zipData: Uint8Array,
  scope: string,
  intent: string,
  signal?: AbortSignal,
) {
  return uploadSkillInternal(this, zipData, scope, intent, false, signal);
};

async function uploadSkillInternal(
  c: Client,
  zipData: Uint8Array,
  scope: string,
  intent: string,
  retried: boolean,
  signal?: AbortSignal,
): Promise<SkillStoreItem> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 5 * 60 * 1000);
  let parentHandler: (() => void) | undefined;
  if (signal) {
    if (signal.aborted) ctl.abort();
    else {
      parentHandler = () => ctl.abort();
      signal.addEventListener('abort', parentHandler);
    }
  }

  try {
    const token = await c.ensureToken(ctl.signal);

    // 用 FormData (多端通用) 替代 Go mime/multipart
    const form = new FormData();
    form.append('scope', scope);
    form.append('intent', intent);
    // Blob 在浏览器/Node 18+ 都可用
    // 显式 cast: TS 5.7+ Uint8Array<ArrayBufferLike> 与 BlobPart 严格度问题
    const blob = new Blob([zipData as BlobPart], { type: 'application/zip' });
    form.append('file', blob, 'skill.zip');

    const url = c.apiURL('/skill-store/upload');
    let resp: Response;
    try {
      resp = await c.fetchImpl(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: form,
        signal: ctl.signal,
      });
    } catch (e) {
      throw classifyTransport('POST /skill-store/upload', url, e);
    }

    if (resp.status === 401 && !retried) {
      try {
        await resp.body?.cancel();
      } catch {
        /* ignore */
      }
      try {
        await c.forceRefresh(ctl.signal);
      } catch (refreshErr) {
        throw new Error(
          `upload: unauthorized and refresh failed: ${refreshErr instanceof Error ? refreshErr.message : String(refreshErr)}`,
        );
      }
      return uploadSkillInternal(c, zipData, scope, intent, true, signal);
    }

    if (resp.status < 200 || resp.status >= 300) {
      const bodyBytes = await readLimited(resp.body!, maxErrorBodySize);
      throw new Error(
        `upload: ${parseHTTPErrorWithHeader(resp.status, bodyBytes, resp.headers).message}`,
      );
    }

    const text = await resp.text();
    const result = JSON.parse(text) as { data: { skill: SkillStoreItem } };
    return result.data.skill;
  } finally {
    clearTimeout(timer);
    if (parentHandler && signal) signal.removeEventListener('abort', parentHandler);
  }
}

Client.prototype.getSkillSummary = async function (this: Client, signal?: AbortSignal) {
  const resp = await this.doJSON<APIResponse<SkillSummary>>('GET', '/skills/summary', null, signal);
  return resp.data;
};

Client.prototype.certifySkill = async function (
  this: Client,
  skillID: string,
  signal?: AbortSignal,
) {
  await this.doJSON<APIResponse<unknown>>(
    'POST',
    `/skill-store/${encodeURIComponent(skillID)}/certify`,
    null,
    signal,
  );
};

Client.prototype.getCertificationStatus = async function (
  this: Client,
  skillID: string,
  signal?: AbortSignal,
) {
  const resp = await this.doJSON<APIResponse<CertificationStatus>>(
    'GET',
    `/skill-store/${encodeURIComponent(skillID)}/certification`,
    null,
    signal,
  );
  return resp.data;
};

Client.prototype.generateSkill = async function (
  this: Client,
  req: GenerateSkillRequest,
  signal?: AbortSignal,
) {
  const resp = await this.doJSON<APIResponse<GenerateSkillResult>>(
    'POST',
    '/skill-generator/generate',
    req,
    signal,
  );
  return resp.data;
};

Client.prototype.optimizeSkill = async function (
  this: Client,
  req: OptimizeSkillRequest,
  signal?: AbortSignal,
) {
  const resp = await this.doJSON<APIResponse<OptimizeSkillResult>>(
    'POST',
    '/skill-generator/optimize',
    req,
    signal,
  );
  return resp.data;
};

Client.prototype.validateSkill = async function (
  this: Client,
  skillName: string,
  signal?: AbortSignal,
) {
  await this.doJSON<APIResponse<unknown>>(
    'POST',
    '/skill-generator/validate',
    { skillName },
    signal,
  );
};
