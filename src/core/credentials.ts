import type {
  CredentialSnapshot,
  CredentialCASResult,
  VersionedCredentialStore,
  CredentialReason,
  CredentialRequestOwner,
} from './store';
import type { ServerMetadata, TokenSet, TokenResponse } from '../auth/types';

const uuid = () => globalThis.crypto.randomUUID();
const pause = () => new Promise<void>((resolve) => setTimeout(resolve, 25));
const abort = (signal?: AbortSignal) => {
  if (signal?.aborted) throw new Error('aborted');
};
const sameRequestOwner = (snapshot: CredentialSnapshot, expected: CredentialRequestOwner) =>
  snapshot.storeInstanceId === expected.storeInstanceId &&
  snapshot.authSessionId === expected.authSessionId &&
  snapshot.principal?.issuer === expected.principal?.issuer &&
  snapshot.principal?.subject === expected.principal?.subject &&
  snapshot.principal?.organizationId === expected.principal?.organizationId;
export type CredentialStateNotification = Omit<CredentialSnapshot, 'tokenSet'>;
export interface CredentialProtocol {
  metadata(signal?: AbortSignal): Promise<ServerMetadata>;
  profile(
    tokens: TokenSet,
    signal?: AbortSignal,
  ): Promise<{
    subject: string;
    organizationId: string | null;
    displayName?: string;
    avatarUrl?: string;
    email?: string;
    imageUrl?: string;
    accountCreatedAt?: string;
    requiresPhoneBinding?: boolean;
    hasExtraUsageEnabled?: boolean;
    billingType?: string;
    subscriptionCreatedAt?: string;
    rateLimitTier?: string;
    organizationName?: string;
  }>;
  fetch: typeof fetch;
  serverURL: string;
}
export class CredentialLifecycle {
  private listeners = new Set<(value: CredentialStateNotification) => void>();
  private notificationKey = '';
  private observations = new Map<string, CredentialSnapshot>();
  constructor(
    private store: VersionedCredentialStore,
    private protocol: CredentialProtocol,
  ) {}
  read(signal?: AbortSignal) {
    return this.store.readSnapshot(signal);
  }
  subscribe(listener: (value: CredentialStateNotification) => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  private async notify(snapshot: CredentialSnapshot) {
    let current: CredentialSnapshot;
    try {
      current = await this.read();
    } catch {
      return;
    }
    if (
      current.storeInstanceId !== snapshot.storeInstanceId ||
      current.revision !== snapshot.revision
    )
      return;
    const projection: CredentialStateNotification = {
      storeInstanceId: snapshot.storeInstanceId,
      authorityConfig: snapshot.authorityConfig && {
        serverURL: snapshot.authorityConfig.serverURL,
        issuer: snapshot.authorityConfig.issuer,
        oauthProfile: 'desktop',
        authContractVersion: 2,
        errorContractVersion: 1,
      },
      revision: snapshot.revision,
      authSessionId: snapshot.authSessionId,
      credentialState: snapshot.credentialState,
      reason: snapshot.reason,
      principal: snapshot.principal && {
        issuer: snapshot.principal.issuer,
        subject: snapshot.principal.subject,
        organizationId: snapshot.principal.organizationId,
      },
      refreshOperation: snapshot.refreshOperation && {
        operationId: snapshot.refreshOperation.operationId,
        sessionId: snapshot.refreshOperation.sessionId,
        baseRevision: snapshot.refreshOperation.baseRevision,
        phase: snapshot.refreshOperation.phase,
        returnState: snapshot.refreshOperation.returnState,
        startedAt: snapshot.refreshOperation.startedAt,
        dispatchedAt: snapshot.refreshOperation.dispatchedAt,
        deadlineAt: snapshot.refreshOperation.deadlineAt,
      },
      loginAttempt: snapshot.loginAttempt && {
        attemptId: snapshot.loginAttempt.attemptId,
        baseSessionId: snapshot.loginAttempt.baseSessionId,
        startedAt: snapshot.loginAttempt.startedAt,
      },
      lastMutation: snapshot.lastMutation && {
        mutationId: snapshot.lastMutation.mutationId,
        operationId: snapshot.lastMutation.operationId,
        resultRevision: snapshot.lastMutation.resultRevision,
      },
      lastLoginAttemptId: snapshot.lastLoginAttemptId,
      verifiedIdentity: snapshot.verifiedIdentity && {
        authSessionId: snapshot.verifiedIdentity.authSessionId,
        principal: {
          issuer: snapshot.verifiedIdentity.principal.issuer,
          subject: snapshot.verifiedIdentity.principal.subject,
          organizationId: snapshot.verifiedIdentity.principal.organizationId,
        },
        displayName: snapshot.verifiedIdentity.displayName,
        avatarUrl: snapshot.verifiedIdentity.avatarUrl,
        email: snapshot.verifiedIdentity.email,
        imageUrl: snapshot.verifiedIdentity.imageUrl,
        accountCreatedAt: snapshot.verifiedIdentity.accountCreatedAt,
        requiresPhoneBinding: snapshot.verifiedIdentity.requiresPhoneBinding,
        hasExtraUsageEnabled: snapshot.verifiedIdentity.hasExtraUsageEnabled,
        billingType: snapshot.verifiedIdentity.billingType,
        subscriptionCreatedAt: snapshot.verifiedIdentity.subscriptionCreatedAt,
        rateLimitTier: snapshot.verifiedIdentity.rateLimitTier,
        organizationName: snapshot.verifiedIdentity.organizationName,
        verifiedAt: snapshot.verifiedIdentity.verifiedAt,
      },
    };
    const key = JSON.stringify({ ...projection, revision: undefined, lastMutation: undefined });
    if (key === this.notificationKey) return;
    this.notificationKey = key;
    for (const listener of this.listeners) {
      try {
        listener(structuredClone(projection));
      } catch {
        /* observer isolation */
      }
    }
  }
  async reconcile(signal?: AbortSignal) {
    const s = await this.read(signal);
    await this.notify(s);
    return s;
  }
  private cas(
    s: CredentialSnapshot,
    changes: Partial<CredentialSnapshot>,
    mutationId = uuid(),
    signal?: AbortSignal,
  ): Promise<CredentialCASResult> {
    return this.store.compareAndSwap(
      {
        storeInstanceId: s.storeInstanceId,
        revision: s.revision,
        authSessionId: s.authSessionId,
        state: s.credentialState,
        operationId: s.refreshOperation?.operationId ?? s.loginAttempt?.attemptId ?? null,
      },
      { ...s, ...changes },
      mutationId,
      signal,
    );
  }
  private async commit(
    s: CredentialSnapshot,
    changes: Partial<CredentialSnapshot>,
    signal?: AbortSignal,
  ) {
    const r = await this.cas(s, changes, uuid(), signal);
    if (r.status === 'storage_error') throw new Error('storage_unavailable');
    if (r.status === 'committed') await this.notify(r.snapshot);
    return r;
  }
  async metadata(s: CredentialSnapshot, signal?: AbortSignal) {
    const m = await this.protocol.metadata(signal);
    if (
      m.crabcode_auth_contract_version !== 2 ||
      m.gateway_error_contract_version !== 1 ||
      !m.issuer
    )
      throw new Error('auth_contract_unsupported');
    if (
      s.authorityConfig &&
      (s.authorityConfig.serverURL !== this.protocol.serverURL ||
        s.authorityConfig.issuer !== m.issuer ||
        s.authorityConfig.oauthProfile !== 'desktop' ||
        s.authorityConfig.authContractVersion !== 2 ||
        s.authorityConfig.errorContractVersion !== 1)
    )
      throw new Error('auth_contract_unsupported');
    return m;
  }
  async reserveLogin(signal?: AbortSignal) {
    const attemptId = uuid();
    let reserved: CredentialSnapshot;
    for (;;) {
      abort(signal);
      const s = await this.read(signal);
      if (s.credentialState !== 'signed_out') throw new Error('local_logout_required');
      const r = await this.commit(s, { loginAttempt: { attemptId, baseSessionId: s.authSessionId, startedAt: new Date().toISOString() } }, signal);
      if (r.status === 'committed') { reserved = r.snapshot; break; }
    }
    try {
      const m = await this.metadata(reserved, signal);
      for (;;) {
        abort(signal);
        const current = await this.read(signal);
        if (current.storeInstanceId !== reserved.storeInstanceId || current.loginAttempt?.attemptId !== attemptId) throw new Error('superseded');
        if (current.authorityConfig) return { attemptId, metadata: m };
        const r = await this.commit(current, { authorityConfig: { serverURL: this.protocol.serverURL, issuer: m.issuer, oauthProfile: 'desktop', authContractVersion: 2, errorContractVersion: 1 } }, signal);
        if (r.status === 'committed') return { attemptId, metadata: m };
      }
    } catch (error) { await this.cancelLogin(attemptId); throw error; }
  }
  async installLogin(attemptId: string, tokens: TokenSet, signal?: AbortSignal) {
    this.validateTokens(tokens);
    for (;;) {
      abort(signal);
      const s = await this.read(signal);
      if (
        s.loginAttempt?.attemptId !== attemptId ||
        s.loginAttempt.baseSessionId !== s.authSessionId
      )
        throw new Error('superseded');
      const r = await this.commit(
        s,
        {
          authSessionId: uuid(),
          tokenSet: tokens,
          credentialState: 'pending_identity',
          principal: null,
          verifiedIdentity: null,
          loginAttempt: null,
          lastLoginAttemptId: attemptId,
          reason: 'identity_unavailable',
        },
        signal,
      );
      if (r.status === 'committed') return this.bindIdentity(r.snapshot.authSessionId!, signal);
    }
  }
  async assertLogin(attemptId: string, signal?: AbortSignal) {
    abort(signal);
    const s = await this.read(signal);
    if (s.loginAttempt?.attemptId !== attemptId) throw new Error('superseded');
  }
  async cancelLogin(attemptId: string) {
    const s = await this.read();
    if (s.loginAttempt?.attemptId === attemptId) await this.commit(s, { loginAttempt: null });
  }
  private validateTokens(t: TokenSet) {
    if (
      !t.access_token?.trim() ||
      !t.refresh_token?.trim() ||
      !t.client_id?.trim() ||
      t.server_url !== this.protocol.serverURL ||
      !Number.isFinite(Date.parse(t.expires_at)) ||
      Date.parse(t.expires_at) <= Date.now()
    )
      throw new Error('invalid_response');
  }
  private usable(s: CredentialSnapshot) {
    return !!s.tokenSet && Date.parse(s.tokenSet.expires_at) > Date.now() + 300_000;
  }
  async bindIdentity(sessionId: string, signal?: AbortSignal): Promise<CredentialSnapshot> {
    const s = await this.ensureSnapshot(signal, undefined, true);
    if (s.authSessionId !== sessionId) throw new Error('superseded');
    if (s.credentialState === 'ready') return s;
    await this.metadata(s, signal);
    const beforeProfile = await this.read(signal);
    if (
      beforeProfile.storeInstanceId !== s.storeInstanceId ||
      beforeProfile.authSessionId !== sessionId ||
      beforeProfile.revision !== s.revision ||
      beforeProfile.credentialState !== 'pending_identity'
    )
      throw new Error('superseded');
    let identity;
    try {
      identity = await this.protocol.profile(s.tokenSet!, signal);
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      if (message === 'invalid_scope' || message === 'auth_contract_unsupported')
        await this.commit(s, { credentialState: 'configuration_error', reason: message });
      throw error;
    }
    abort(signal);
    const current = await this.read(signal);
    if (
      current.storeInstanceId !== s.storeInstanceId ||
      current.authSessionId !== sessionId ||
      current.revision !== s.revision
    )
      throw new Error('superseded');
    if (!identity.subject) throw new Error('invalid_response');
    const principal = {
      issuer: s.authorityConfig!.issuer,
      subject: identity.subject,
      organizationId: identity.organizationId,
    };
    const r = await this.commit(
      s,
      {
        principal,
        verifiedIdentity: {
          authSessionId: sessionId,
          principal,
          displayName: identity.displayName,
          avatarUrl: identity.avatarUrl,
          email: identity.email,
          imageUrl: identity.imageUrl,
          accountCreatedAt: identity.accountCreatedAt,
          requiresPhoneBinding: identity.requiresPhoneBinding,
          hasExtraUsageEnabled: identity.hasExtraUsageEnabled,
          billingType: identity.billingType,
          subscriptionCreatedAt: identity.subscriptionCreatedAt,
          rateLimitTier: identity.rateLimitTier,
          organizationName: identity.organizationName,
          verifiedAt: new Date().toISOString(),
        },
        credentialState: 'ready',
        reason: null,
      },
      signal,
    );
    if (r.status !== 'committed') throw new Error('superseded');
    return r.snapshot;
  }
  async ensure(signal?: AbortSignal, rejected?: CredentialSnapshot, expected?: CredentialRequestOwner) {
    const snapshot = await this.ensureSnapshot(signal, rejected, false, expected);
    this.observations.set(snapshot.tokenSet!.access_token, snapshot);
    if (this.observations.size > 128)
      this.observations.delete(this.observations.keys().next().value!);
    return snapshot.tokenSet!.access_token;
  }
  async forceRefresh(signal?: AbortSignal, rejectedToken?: string, expected?: CredentialRequestOwner) {
    const rejected = rejectedToken ? this.observations.get(rejectedToken) : await this.read(signal);
    if (rejectedToken && !rejected) throw new Error('credential_observation_unavailable');
    return this.ensure(signal, rejected, expected);
  }
  private async ensureSnapshot(
    signal?: AbortSignal,
    rejected?: CredentialSnapshot,
    pending = false,
    expected?: CredentialRequestOwner,
  ): Promise<CredentialSnapshot> {
    let session: string | null | undefined;
    let instance: string | undefined;
    let initialRevision: string | undefined;
    let refreshed = false;
    let initialAccess: string | undefined;
    for (;;) {
      abort(signal);
      const s = await this.read(signal);
      if (expected && !sameRequestOwner(s, expected)) throw new Error('superseded');
      if (s.authorityConfig && s.authorityConfig.serverURL !== this.protocol.serverURL)
        throw new Error('auth_contract_unsupported');
      if (session === undefined) {
        session = s.authSessionId;
        instance = s.storeInstanceId;
        initialRevision = s.revision;
        initialAccess = s.tokenSet?.access_token;
      }
      if (
        s.storeInstanceId !== instance ||
        s.authSessionId !== session ||
        (rejected &&
          (s.authSessionId !== rejected.authSessionId ||
            s.storeInstanceId !== rejected.storeInstanceId))
      )
        throw new Error('superseded');
      if (s.credentialState === 'refresh_dispatched') {
        if (Date.now() >= Date.parse(s.refreshOperation!.deadlineAt!))
          await this.commit(s, {
            credentialState: 'reauth_required',
            tokenSet: null,
            refreshOperation: null,
            reason: 'refresh_outcome_unknown',
          });
        else await pause();
        continue;
      }
      if (s.credentialState === 'refresh_reserved') {
        if (Date.now() >= Date.parse(s.refreshOperation!.startedAt) + 30_000)
          await this.commit(s, {
            credentialState: s.refreshOperation!.returnState,
            refreshOperation: null,
          });
        else await pause();
        continue;
      }
      if (s.credentialState !== 'ready' && !(pending && s.credentialState === 'pending_identity'))
        throw new Error(`credential_unavailable:${s.credentialState}:${s.reason ?? ''}`);
      const live = !!s.tokenSet && Date.parse(s.tokenSet.expires_at) > Date.now();
      if (
        live &&
        (refreshed ||
          (s.revision !== (rejected?.revision ?? initialRevision) &&
            (rejected !== undefined || s.tokenSet!.access_token !== initialAccess)))
      )
        return s;
      if (this.usable(s) && !rejected) return s;
      const metadata = await this.metadata(s, signal);
      abort(signal);
      const operationId = uuid();
      const r = await this.commit(
        s,
        {
          credentialState: 'refresh_reserved',
          refreshOperation: {
            operationId,
            sessionId: s.authSessionId!,
            baseRevision: s.revision,
            phase: 'reserved',
            returnState: s.credentialState,
            startedAt: new Date().toISOString(),
            dispatchedAt: null,
            deadlineAt: null,
          },
        },
        signal,
      );
      if (r.status !== 'committed') continue;
      // The operation owns its lifecycle independently of all callers' waiting signals.
      const owner = this.refresh(r.snapshot, metadata);
      await this.wait(owner, signal);
      refreshed = true;
      rejected = undefined;
    }
  }
  private wait<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
    if (!signal) return promise;
    return new Promise((resolve, reject) => {
      const onAbort = () => {
        signal.removeEventListener('abort', onAbort);
        reject(new Error('aborted'));
      };
      signal.addEventListener('abort', onAbort, { once: true });
      promise.then(
        (value) => {
          signal.removeEventListener('abort', onAbort);
          resolve(value);
        },
        (error) => {
          signal.removeEventListener('abort', onAbort);
          reject(error);
        },
      );
      if (signal.aborted) onAbort();
    });
  }
  private async refresh(reserved: CredentialSnapshot, metadata: ServerMetadata) {
    const dispatchedAt = Date.now();
    const r = await this.commit(reserved, {
      credentialState: 'refresh_dispatched',
      refreshOperation: {
        ...reserved.refreshOperation!,
        phase: 'dispatched',
        dispatchedAt: new Date(dispatchedAt).toISOString(),
        deadlineAt: new Date(dispatchedAt + 30_000).toISOString(),
      },
    });
    if (r.status !== 'committed') return;
    const s = r.snapshot;
    const ctl = new AbortController();
    const timeout = setTimeout(() => ctl.abort(), 30_000);
    let tokens: TokenSet;
    try {
      const result = await this.wait(
        (async () => {
          const response = await this.protocol.fetch(metadata.token_endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
              grant_type: 'refresh_token',
              client_id: s.tokenSet!.client_id,
              refresh_token: s.tokenSet!.refresh_token,
            }),
            signal: ctl.signal,
          });
          const body = await response.json();
          return { response, body };
        })(),
        ctl.signal,
      );
      if (!result.response.ok) {
        const code = result.body.error;
        let reason: CredentialReason = 'refresh_outcome_unknown';
        let state: CredentialSnapshot['credentialState'] = 'reauth_required';
        if (code === 'invalid_grant') reason = code;
        else if (['invalid_client', 'invalid_scope', 'unsupported_grant_type'].includes(code)) {
          reason = code;
          state = 'configuration_error';
        } else if (
          result.body.rotationOutcome === 'not_committed' &&
          ['temporarily_unavailable', 'server_error'].includes(code)
        ) {
          await this.commit(s, {
            credentialState: s.refreshOperation!.returnState,
            refreshOperation: null,
          });
          throw new Error('refresh_temporarily_unavailable');
        }
        await this.commit(s, {
          credentialState: state,
          tokenSet: null,
          refreshOperation: null,
          reason,
        });
        throw new Error(reason);
      }
      const body = result.body as TokenResponse;
      if (!Number.isFinite(body.expires_in) || body.expires_in <= 0)
        throw new Error('invalid_response');
      tokens = {
        ...s.tokenSet!,
        access_token: body.access_token,
        refresh_token: body.refresh_token!,
        expires_at: new Date(Date.now() + body.expires_in * 1000).toISOString(),
        scope: body.scope ?? s.tokenSet!.scope,
      };
      this.validateTokens(tokens);
    } catch (error) {
      await this.commit(s, {
        credentialState: 'reauth_required',
        tokenSet: null,
        refreshOperation: null,
        reason: 'refresh_outcome_unknown',
      });
      throw error;
    } finally {
      clearTimeout(timeout);
    }
    const started = performance.now(),
      mutationId = uuid();
    for (;;) {
      if (Date.now() >= Date.parse(s.refreshOperation!.deadlineAt!)) {
        await this.commit(s, {
          credentialState: 'reauth_required',
          tokenSet: null,
          refreshOperation: null,
          reason: 'refresh_outcome_unknown',
        });
        void this.revoke(tokens, metadata);
        throw new Error('refresh_outcome_unknown');
      }
      const result = await this.cas(
        s,
        {
          tokenSet: tokens,
          credentialState: s.refreshOperation!.returnState,
          refreshOperation: null,
        },
        mutationId,
      );
      if (result.status === 'committed') {
        await this.notify(result.snapshot);
        return;
      }
      if (result.status === 'superseded') {
        void this.revoke(tokens, metadata);
        return;
      }
      if (performance.now() - started >= 2000) throw new Error('credential_persist_failed');
      await pause();
    }
  }
  private async revoke(tokens: TokenSet, metadata?: ServerMetadata, authority?: CredentialSnapshot): Promise<'confirmed' | 'failed' | 'unsupported'> {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 30_000);
    try {
      const m = metadata ?? await this.wait(authority ? this.metadata(authority, ctl.signal) : this.protocol.metadata(ctl.signal), ctl.signal);
      if (!m.revocation_endpoint) return 'unsupported';
      const response = await this.wait(this.protocol.fetch(m.revocation_endpoint, {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ token: tokens.refresh_token, token_type_hint: 'refresh_token' }), signal: ctl.signal,
      }), ctl.signal);
      return response.ok ? 'confirmed' : 'failed';
    } catch { return 'failed'; }
    finally { clearTimeout(timer); }
  }
  async logout(
    signal?: AbortSignal,
    expected?: { storeInstanceId: string; authSessionId: string | null },
  ) {
    let s = await this.read(signal);
    if (expected && (s.storeInstanceId !== expected.storeInstanceId || s.authSessionId !== expected.authSessionId)) {
      return {
        logoutOperationId: uuid(), expectedAuthSessionId: expected.authSessionId,
        storeInstanceId: expected.storeInstanceId, revision: s.revision,
        status: 'superseded' as const,
      };
    }
    const session = s.authSessionId,
      instance = s.storeInstanceId,
      started = performance.now(),
      logoutOperationId = uuid();
    const receipt = () => ({
      logoutOperationId,
      expectedAuthSessionId: session,
      storeInstanceId: instance,
      revision: s.revision,
    });
    for (;;) {
      abort(signal);
      if (s.storeInstanceId !== instance || s.authSessionId !== session)
        return { ...receipt(), status: 'superseded' as const };
      if (s.credentialState === 'signed_out' && !s.loginAttempt)
        return { ...receipt(), status: 'already_signed_out' as const };
      const r = await this.cas(
        s,
        {
          credentialState: 'signed_out',
          authSessionId: null,
          principal: null,
          tokenSet: null,
          refreshOperation: null,
          loginAttempt: null,
          lastLoginAttemptId: null,
          verifiedIdentity: null,
          reason: null,
        },
        logoutOperationId,
        signal,
      );
      if (r.status === 'committed') {
        await this.notify(r.snapshot);
        return {
          ...receipt(),
          revision: r.snapshot.revision,
          status: 'committed' as const,
          revocation: s.tokenSet
            ? this.revoke(s.tokenSet, undefined, s)
            : Promise.resolve('unsupported' as const),
        };
      }
      if (performance.now() - started >= 2000) throw new Error('storage_busy');
      await pause();
      s = await this.read(signal);
    }
  }
}
