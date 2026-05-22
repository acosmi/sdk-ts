// index.ts — Acosmi SDK TypeScript 主入口
//
// 端口源: acosmi-sdk-go v0.19.0 (一字不差对齐)
//
// 双格式红线: AnthropicAdapter + OpenAIAdapter 等地位 (对应两个不同下游产品)。

// === 类型 ===
export * from './types';

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

// === Auth helpers ===
export {
  discover,
  discoverWithProfile,
  discoverWebOAuthMetadata,
  register,
  registerWebOAuthClient,
  authorize,
  generateState,
  createWebAuthorizationRequest,
  completeWebAuthorizationRequest,
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
  ErrStateMismatch,
  type LoginEvent,
  type LoginEventType,
  type LoginErrCode,
  type LoginOptions,
  type AuthorizeResult,
  type OAuthMetadataProfile,
  type RegisterWebOAuthClientOptions,
  type WebAuthorizationRequest,
  type CreateWebAuthorizationRequestOptions,
  type WebAuthorizationPending,
  type WebAuthorizationCallbackParams,
} from './auth';

// === Scopes ===
export * from './scopes';

// === Compliance ===
// 暴露 envelope/审批/provider/billing 的对外稳定状态与错误码 + SDK 公共领域类型
// + 数值错误码 → symbolic key 的分类器；不暴露下游材料、provider ledger /
// distribution billing 内部 API。
export * from './compliance-status';
export * from './compliance-types';
export {
  classifyComplianceError,
  isComplianceBusinessError,
  type ComplianceErrorInfo,
  type ComplianceErrorKey,
} from './compliance-errors';
export { ComplianceClient, CompliancePollError } from './client/compliance';

// === TokenStore ===
export {
  type TokenStore,
  FileTokenStore,
  LocalStorageTokenStore,
  InMemoryTokenStore,
  newFileTokenStore,
  fileLockDefaults,
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

// === Agent Runs ===
export * from './agent-runs-types';
export { AgentRunsClient } from './client/agent-runs';

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
import './client/agent-runs';
import './client/compliance';
import './sanitize-bridge';
import './ws';
import './bug-report';

export type { WSConfig } from './ws';
export type { BugReportResult, BugView } from './bug-report';
