// index.ts — Acosmi SDK TypeScript 主入口
//
// 端口源: acosmi-sdk-go v0.19.0 (一字不差对齐)
//
// 双格式红线: AnthropicAdapter + OpenAIAdapter 等地位 (对应两个不同下游产品)。

// === 类型 ===
export * from './types';

// === Adapters (双格式) ===
export {
  ProviderFormat,
  type ProviderAdapter,
  AnthropicAdapter,
  OpenAIAdapter,
  getAdapter,
  getAdapterForModel,
} from './adapters/index';

// === Auth helpers ===
export {
  discover,
  register,
  authorize,
  exchangeCode,
  refreshToken,
  revokeToken,
  newTokenSet,
  isSSLError,
  EventAuthURL,
  EventComplete,
  EventError,
  ErrDiscovery,
  ErrRegistration,
  ErrBrowserOpen,
  ErrAuthDenied,
  ErrTimeout,
  ErrTokenExchange,
  ErrSSLProxy,
  type LoginEvent,
  type LoginEventType,
  type LoginErrCode,
  type LoginOptions,
  type AuthorizeResult,
} from './auth';

// === Scopes ===
export * from './scopes';

// === TokenStore ===
export {
  type TokenStore,
  FileTokenStore,
  LocalStorageTokenStore,
  InMemoryTokenStore,
  newFileTokenStore,
} from './store';

// === Retry ===
export {
  type RetryPolicy,
  type RetryRequestInfo,
  DefaultRetryPolicy,
  defaultRetryable,
  defaultSafeToRetry,
  computeBackoff,
  effectivePolicy,
} from './retry';

// === Sanitize ===
export * as sanitize from './sanitize';

// === Stream meta ===
export { extractAnthropicBlockMeta, type BlockMeta } from './stream-meta';

// === Betas ===
export { buildBetas, uniqueMerge } from './betas';

// === Client + 业务 mixins (必须 side-effect import 才能挂 prototype) ===
export { Client, type Config, type FilterStatus } from './client';
export {
  FilterStatusOK,
  FilterStatusAdminBypass,
  FilterStatusInternalBypass,
  FilterStatusDisabledByFlag,
  FilterStatusFallbackTkdistError,
  FilterStatusFallbackTkdistSkew,
  FilterStatusFallbackNoBuckets,
  FilterStatusFallbackMissingUser,
  FilterStatusUnknown,
} from './client';

// 业务方法 — side-effect import 注入到 Client.prototype
import './client/entitlements';
import './client/packages';
import './client/wallet';
import './client/skills';
import './client/tools';
import './client/notifications';
import './sanitize-bridge';
import './ws';
import './bug-report';

export type { WSConfig } from './ws';
export type { BugReportResult, BugView } from './bug-report';
