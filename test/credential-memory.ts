import type {
  CredentialSnapshot,
  CredentialCASExpected,
  CredentialCASResult,
  VersionedCredentialStore,
} from '../src/core/store';
import type { ServerMetadata } from '../src/auth/types';
export const metadata: ServerMetadata = {
  issuer: 'https://fake.test',
  authorization_endpoint: 'https://fake.test/auth',
  token_endpoint: 'https://fake.test/token',
  registration_endpoint: 'https://fake.test/register',
  revocation_endpoint: 'https://fake.test/revoke',
  scopes_supported: [],
  crabcode_auth_contract_version: 2,
  gateway_error_contract_version: 1,
};
export const fixtureStoreInstanceId = '00000000-0000-4000-8000-000000000001';
export const fixtureAuthSessionId = '00000000-0000-4000-8000-000000000002';
export function fixture(): CredentialSnapshot {
  return {
    storeInstanceId: fixtureStoreInstanceId,
    authorityConfig: {
      serverURL: 'https://fake.test',
      issuer: metadata.issuer,
      oauthProfile: 'desktop',
      authContractVersion: 2,
      errorContractVersion: 1,
    },
    revision: '0',
    authSessionId: fixtureAuthSessionId,
    principal: { issuer: metadata.issuer, subject: 'a', organizationId: null },
    credentialState: 'ready',
    tokenSet: {
      access_token: 'fake-access',
      refresh_token: 'fake-refresh',
      expires_at: new Date(Date.now() + 60_000).toISOString(),
      client_id: 'fake-client',
      server_url: 'https://fake.test',
      scope: 'account',
    },
    refreshOperation: null,
    loginAttempt: null,
    reason: null,
    lastMutation: null,
    lastLoginAttemptId: null,
    verifiedIdentity: {
      authSessionId: fixtureAuthSessionId,
      principal: { issuer: metadata.issuer, subject: 'a', organizationId: null },
      verifiedAt: '2026-09-08T00:00:00.000Z',
    },
  };
}
export class Memory implements VersionedCredentialStore {
  state = fixture();
  failRead = false;
  saveFailures = 0;
  async readSnapshot() {
    if (this.failRead) throw new Error('storage_unavailable');
    return structuredClone(this.state);
  }
  async compareAndSwap(
    e: CredentialCASExpected,
    next: CredentialSnapshot,
    mutationId: string,
  ): Promise<CredentialCASResult> {
    if (this.state.lastMutation?.mutationId === mutationId)
      return { status: 'committed', snapshot: await this.readSnapshot() };
    if (
      e.storeInstanceId !== this.state.storeInstanceId ||
      e.revision !== this.state.revision ||
      e.authSessionId !== this.state.authSessionId ||
      e.state !== this.state.credentialState ||
      e.operationId !==
        (this.state.refreshOperation?.operationId ?? this.state.loginAttempt?.attemptId ?? null)
    )
      return { status: 'superseded', snapshot: await this.readSnapshot() };
    if (next.tokenSet?.access_token === 'winner-access' && this.saveFailures-- > 0)
      return { status: 'storage_error', error: 'disk_full' };
    this.state = structuredClone({
      ...next,
      revision: String(BigInt(this.state.revision) + 1n),
      lastMutation: {
        mutationId,
        operationId: e.operationId,
        resultRevision: String(BigInt(this.state.revision) + 1n),
      },
    });
    return { status: 'committed', snapshot: await this.readSnapshot() };
  }
}
