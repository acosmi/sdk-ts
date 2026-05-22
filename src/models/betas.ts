// betas.ts — 端口自 acosmi-sdk-go/betas.go
//
// Beta Header 常量 — 经联网验证的真实 Anthropic API beta 值。
// 虚构/错误日期的 header 已剔除。

import type { ChatRequest, ModelCapabilities } from './types';
import { ThinkingOff } from './types';

/** ISP: 交错思考 */
const betaInterleavedThinking = 'interleaved-thinking-2025-05-14';
/** 1M 上下文 (retiring 2026-04-30) */
const betaContext1M = 'context-1m-2025-08-07';
/** 上下文编辑 */
const betaContextManagement = 'context-management-2025-06-27';
/** 结构化输出 */
const betaStructuredOutputs = 'structured-outputs-2025-11-13';
/** Tool Search */
const betaAdvancedToolUse = 'advanced-tool-use-2025-11-20';
/** Effort 控制 (Opus 4.5 需要, 4.6 stable) */
const betaEffort = 'effort-2025-11-24';
/** 缓存作用域隔离 */
const betaPromptCachingScope = 'prompt-caching-scope-2026-01-05';
/** 快速推理 (Opus 4.6) */
const betaFastMode = 'fast-mode-2026-02-01';
/** 思考脱敏 */
const betaRedactThinking = 'redact-thinking-2026-02-12';
/** 高效工具 (Claude 3.7, Claude 4 内置) */
const betaTokenEfficientTools = 'token-efficient-tools-2025-02-19';

/** 根据模型能力和请求参数自动组装 beta header 列表 */
export function buildBetas(caps: ModelCapabilities, req: ChatRequest): string[] {
  const betas: string[] = [];

  // ── 思考相关 ──
  if (caps.supports_isp) {
    betas.push(betaInterleavedThinking);
    betas.push(betaContextManagement);
  }
  if (caps.supports_redact_thinking && req.thinking && req.thinking.display === 'summary') {
    betas.push(betaRedactThinking);
  }

  // ── 上下文 ──
  if (caps.supports_1m_context) {
    betas.push(betaContext1M);
  }

  // ── 输出控制 (互斥: structured-outputs ⊕ token-efficient-tools) ──
  const hasStructuredOutput = caps.supports_structured_output && req.outputConfig != null;
  if (hasStructuredOutput) {
    betas.push(betaStructuredOutputs);
  } else if (caps.supports_token_efficient) {
    betas.push(betaTokenEfficientTools);
  }

  // ── Tool Search ──
  if (caps.supports_tool_search) {
    betas.push(betaAdvancedToolUse);
  }

  // ── 推理控制 ──
  // Level 模式下 resolveThinkingLevel 直接写 body["effort"]，req.effort 仍为 undefined,
  // 所以需额外判断 Level 是否激活了 effort
  const needsEffort =
    req.effort != null ||
    (req.thinking != null && req.thinking.level && req.thinking.level !== ThinkingOff);
  if (caps.supports_effort && needsEffort) {
    betas.push(betaEffort);
  }
  if (caps.supports_fast_mode && req.speed === 'fast') {
    betas.push(betaFastMode);
  }

  // ── 缓存 ──
  if (caps.supports_prompt_cache) {
    betas.push(betaPromptCachingScope);
  }

  // ── 合并客户端显式传入 (去重) ──
  return uniqueMerge(betas, req.betas ?? []);
}

/** 合并两个字符串数组并去重, 保留顺序 */
export function uniqueMerge(base: string[], extra: string[]): string[] {
  if (extra.length === 0) return base;
  const seen = new Set<string>(base);
  for (const s of extra) {
    if (!seen.has(s)) {
      base.push(s);
      seen.add(s);
    }
  }
  return base;
}
