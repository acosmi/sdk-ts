// models/index.ts — 模型网关域 barrel
//
// 收口 ManagedModel / Chat / wire-format DTO / 双格式 adapter / 选模型 helper。

// === 类型 ===
export * from './types';
export * from './wire-anthropic';
export * from './wire-openai';

// === Model catalog helpers (v1.2+, CrabCode desktop automation 选模型用) ===
export {
  modelSupportsInputModality,
  modelSupportsImageInput,
  findFirstModelByInputModality,
  findDesktopVisualUnderstandingModel,
} from './model-helpers';

// === Adapters (双格式) ===
export {
  ProviderFormat,
  type ProviderAdapter,
  AnthropicAdapter,
  OpenAIAdapter,
  getAdapter,
  getAdapterForModel,
} from './adapters/index';

// === Stream meta ===
export { extractAnthropicBlockMeta, type BlockMeta } from './stream-meta';

// === Betas ===
export { buildBetas, uniqueMerge } from './betas';
