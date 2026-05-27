// auth/index.ts — 鉴权 / 身份域 barrel
//
// 收口 OAuth 流程、token 类型、core scope。对外鉴权层落点。

// === 类型 ===
export * from './types';

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
  OAuthTokenEndpointError,
  isInvalidGrantError,
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
