// core/index.ts — 运行时基座域 barrel
//
// 收口主 Client、TokenStore、Retry 及 Client × sanitize 胶水。

// === Client + 业务 mixins 宿主 ===
export {
  Client,
  DEFAULT_GATEWAY_BASE_URL,
  ErrOAuthCORSBlocked,
  ErrRefreshProxyFailed,
  ErrTokenExpired,
  normalizeGatewayBaseURL,
  type BrowserRefreshMode,
  type Config,
  type FilterStatus,
} from './client';
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

// === Client × sanitize 胶水 — side-effect import 注入 applyRequestSanitizers 等到 Client.prototype ===
import './sanitize-bridge';
