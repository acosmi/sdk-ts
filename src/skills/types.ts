// skills/types.ts — 技能商店 / 技能生产器 / 统一工具域类型。
//
// 端口自 acosmi-sdk-go/types.go (v0.19.0) 的 Skill Store / Skill Generator /
// Unified Tools 段。
//
// 命名约定：字段名 = Go json tag 字面量 (wire format), 不做 camelCase 重映射。

// =============================================================================
// Skill Store
// =============================================================================

export interface SkillStoreItem {
  id: string;
  pluginId: string;
  key: string;
  name: string;
  description: string;
  icon: string;
  category: string;
  inputSchema: string;
  outputSchema: string;
  timeout: number;
  retryCount: number;
  retryDelay: number;
  version: string;
  totalCalls: number;
  avgDurationMs: number;
  successRate: number;
  isEnabled: boolean;
  securityLevel: string;
  securityScore: number;
  scope: string;
  status: string;
  downloadCount: number;
  readme?: string; // 网关 json:"readme,omitempty"，空时缺字段，故可选
  skillMd?: string; // SKILL.md (Anthropic 标准格式)；网关 json:"skillMd,omitempty"，仅 Detail/resolve/browse 全量返回
  tags: string[];
  author: string;
  publisherId: string;
  isPublished: boolean;
  pluginName: string;
  pluginIcon: string;
  updatedAt: string;
  visibility?: string;
  certificationStatus?: string;
  source?: string;
}

/** 技能商店搜索参数 (非 wire 类型, 用于 client 方法参数) */
export interface SkillStoreQuery {
  category?: string;
  keyword?: string;
  tag?: string;
}

/** 技能统计概览 */
export interface SkillSummary {
  installed: number;
  created: number;
  total: number;
  storeAvailable: number;
}

/** 技能商店分页浏览响应 */
export interface SkillBrowseResponse {
  items: SkillStoreItem[];
  total: number;
  page: number;
  pageSize: number;
}

/**
 * 技能商店列表项（轻量，仅含浏览所需字段）
 * 配合服务端 fields=minimal 参数使用，响应体积缩减 90%+
 */
export interface SkillStoreListItem {
  id: string;
  key: string;
  name: string;
  description: string;
  icon: string;
  category: string;
  version: string;
  author: string;
  downloadCount: number;
  tags: string[];
  certificationStatus?: string;
  visibility?: string;
  source?: string;
  updatedAt: string;
}

/** 技能商店轻量浏览响应 */
export interface SkillBrowseListResponse {
  items: SkillStoreListItem[];
  total: number;
  page: number;
  pageSize: number;
}

/** 技能认证状态响应 */
export interface CertificationStatus {
  skillId: string;
  certificationStatus: string;
  certifiedAt?: number;
  securityLevel?: string;
  securityScore: number;
  report?: unknown;
}

// =============================================================================
// Skill Generator
// =============================================================================

export interface GenerateSkillRequest {
  purpose: string;
  examples?: string[];
  inputHints?: string;
  outputHints?: string;
  category?: string;
  language?: string;
}

export interface GenerateSkillResult {
  skillName: string;
  skillKey: string;
  description: string;
  skillMd: string;
  inputSchema: string;
  outputSchema: string;
  testCases: string[];
  readme: string;
  category: string;
  tags: string[];
  timeout: number;
}

export interface OptimizeSkillRequest {
  skillName: string;
  description?: string;
  inputSchema?: string;
  outputSchema?: string;
  readme?: string;
  aspects?: string[];
}

export interface OptimizeSkillResult {
  optimizedSkill: GenerateSkillResult;
  changes: string[];
  score: number;
}

// =============================================================================
// Unified Tools
// =============================================================================

export interface ToolView {
  id: string;
  key: string;
  name: string;
  description: string;
  icon: string;
  category: string;
  inputSchema: string;
  outputSchema: string;
  timeout: number;
  isEnabled: boolean;
  provider?: ToolProvider;
}

export interface ToolProvider {
  id: string;
  name: string;
  icon: string;
  sourceType: string;
  mcpEndpoint?: string;
  isEnabled: boolean;
}

export interface ToolListResponse {
  skills: ToolView[];
  total: number;
}
