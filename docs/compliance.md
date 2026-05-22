# Compliance SDK Guide

This guide covers the public TypeScript SDK surface for compliance workflows:
timestamps, evidence assets, evidence packages, reports, signing envelopes, seal
approvals, and provider request polling.

The SDK exposes Acosmi domain objects only. It does not expose provider
credentials, provider endpoints, raw provider payloads, certificates, private
keys, signing containers, or billing commit internals.

## Quick Start

```ts
import {
  Client,
  ScopeComplianceEvidenceRead,
  ScopeComplianceEvidenceWrite,
  ScopeComplianceTimestampIssue,
  ScopeComplianceTimestampVerify,
} from '@acosmi/sdk-ts';

const client = await Client.create({
  serverURL: process.env.ACOSMI_SERVER_URL!,
  // Defaults to `${serverURL}/admin-api` when omitted.
  complianceBaseURL: process.env.ACOSMI_COMPLIANCE_BASE_URL,
});

await client.login('Compliance Example', [
  ScopeComplianceEvidenceRead,
  ScopeComplianceEvidenceWrite,
  ScopeComplianceTimestampIssue,
  ScopeComplianceTimestampVerify,
]);

const idempotencyKey = await loadOrCreateIdempotencyKey('timestamp:order-123');

const asset = await client.compliance.createEvidenceAsset(
  {
    assetType: 'HASH_ONLY',
    name: 'release-manifest',
    hashAlgorithm: 'sha256',
    declaredHash: process.env.RELEASE_MANIFEST_SHA256!,
    digestSource: 'CLIENT',
    privacyLevel: 'private',
  },
  { idempotencyKey },
);

const token = await client.compliance.issueTimestampForAsset(asset.id, {
  idempotencyKey: await loadOrCreateIdempotencyKey(`timestamp:${asset.evidenceNo}`),
});

const verified = await client.compliance.waitForTimestampVerified(token.id, {
  timeoutMs: 60_000,
});

console.log(verified.verificationStatus);
```

## Scopes

Request the smallest scope set that matches the workflow. `complianceScopes()`
returns all compliance scopes, but production apps should usually choose a
subset:

```ts
import {
  ScopeComplianceEvidenceRead,
  ScopeComplianceReportsRead,
  ScopeComplianceTimestampVerify,
} from '@acosmi/sdk-ts';

await client.login('Read-only Compliance App', [
  ScopeComplianceEvidenceRead,
  ScopeComplianceTimestampVerify,
  ScopeComplianceReportsRead,
]);
```

Compliance scopes are independent from `ScopeAI`, `ScopeSkills`, and
`ScopeAccount`. Holding the general scopes does not grant compliance access.

Report scopes are split by action:

- `ScopeComplianceReportsRead` — `getReport`, `downloadReport`.
- `ScopeComplianceReportsWrite` — `createReport`. This scope was added after the
  initial release; tokens issued before it existed do **not** carry it. An app
  that calls `createReport` must request `ScopeComplianceReportsWrite` at
  `login()` time, and existing users must re-authorize (run the OAuth flow
  again) so the new scope is granted.
- `ScopeComplianceReportsPublish` — `publishReport` (also requires step-up).

## Base URL

`Client` keeps the existing model gateway path under `/api/v4`. Compliance uses
`client.complianceURL(path)` and defaults to `${serverURL}/admin-api`, so it does
not collide with the existing API path.

Set `Config.complianceBaseURL` only when compliance is exposed through a
separate ingress:

```ts
const client = new Client({
  serverURL: process.env.ACOSMI_SERVER_URL!,
  complianceBaseURL: process.env.ACOSMI_COMPLIANCE_BASE_URL,
});
```

## Idempotency And Retry Rules

Every compliance write method accepts `ComplianceWriteOptions`:

```ts
await client.compliance.publishReport(reportId, {
  idempotencyKey,
  signal,
});
```

Persist idempotency keys outside the process before sending a write request.
After a restart, timeout, network failure, or 401, reuse the same key for the
same business action.

Compliance write methods intentionally do not use automatic retry:

- POST/PUT/DELETE write calls do not retry 5xx, 429, timeouts, or transport
  errors.
- Write calls do not refresh and replay on 401.
- GET read calls can perform one safe 401 refresh retry.
- The caller owns user re-authentication and must reuse the same idempotency key
  when resuming the same business action.

## Evidence, Timestamp, And Report Flow

```ts
const asset = await client.compliance.createEvidenceAsset(
  {
    assetType: 'HASH_ONLY',
    name: 'artifact-manifest',
    hashAlgorithm: 'sha256',
    declaredHash: sha256Hex,
    digestSource: 'CLIENT',
    privacyLevel: 'private',
  },
  { idempotencyKey: assetKey },
);

const token = await client.compliance.issueTimestampForAsset(asset.id, {
  idempotencyKey: timestampKey,
});

await client.compliance.waitForTimestampVerified(token.id);

const pkg = await client.compliance.buildEvidencePackage(asset.id, token.id, {
  idempotencyKey: packageKey,
});

const report = await client.compliance.createReport(
  { assetId: asset.id, packageId: pkg.id },
  { idempotencyKey: reportKey },
);

const download = await client.compliance.downloadReport(report.id);
console.log(download.reportNo, download.packageHash);
```

`downloadReport` returns an offline verification view: report hash, asset hash,
package hash, and timestamp summary. It does not include contract body content,
storage keys, provider raw payloads, or subject snapshots.

## Public Verification

`verifyEvidencePublic` returns a privacy-preserving verification result:

```ts
const result = await client.compliance.verifyEvidencePublic({
  evidenceNo: process.env.EVIDENCE_NO,
});

console.log(result.manifestOfflineVerify);
```

The public result includes stable evidence and hash fields only. It excludes PII,
contract originals, storage bucket/key values, subject snapshot IDs, provider raw
payloads, and timestamp authority internals.

`verifyEvidencePublic` is anonymous-capable. It does not require `login()`: when no
token is available the SDK sends an anonymous request instead of throwing
`not authorized, call login() first`. When the client already holds a token the
request carries the `Authorization` header so the backend can keep audit context.
Unlike authenticated GET reads, public verification never triggers a token
refresh/replay on `401`.

## Signing And Provider Request Polling

Signing envelope methods expose the Acosmi workflow state, not provider-specific
fields. `signEnvelope` and `createH5SigningUrl` can return step-up or gate-closed
business errors; callers should surface those states instead of retrying.

```ts
import { BusinessError, classifyComplianceError, isComplianceBusinessError } from '@acosmi/sdk-ts';

try {
  await client.compliance.signEnvelope(envelopeId, request, { idempotencyKey });
} catch (err) {
  if (err instanceof BusinessError && isComplianceBusinessError(err)) {
    const info = classifyComplianceError(err);
    if (info.stepUpRequired) {
      await promptUserToReauthenticate();
      return;
    }
    if (info.terminal) {
      showTerminalComplianceState(info.key);
      return;
    }
  }
  throw err;
}
```

Provider request polling is read-only and exposes a public status view:

```ts
const view = await client.compliance.waitForProviderRequestTerminal(
  providerRequestId,
  { timeoutMs: 30_000 },
);

if (view.status === 'SUCCESS') {
  // Provider success is not a billing commit. Check the envelope/report state.
}
```

## Paginated Lists

Since v1.6.0 the SDK exposes six paginated list reads against the backend
compliance gateway (`GET .../page`). Each returns a yudao `PageResult<T>`
(`{ total, list }` — the single SDK-wide pagination result shape, an alias of
`YudaoPageResult<T>`):

```ts
import type { PageResult, EvidenceAssetPageItem } from '@acosmi/sdk-ts';

client.compliance.listEvidenceAssets(req?, signal?):    Promise<PageResult<EvidenceAssetPageItem>>;
client.compliance.listTimestamps(req?, signal?):        Promise<PageResult<TimestampPageItem>>;
client.compliance.listEvidencePackages(req?, signal?):  Promise<PageResult<EvidencePackagePageItem>>;
client.compliance.listReports(req?, signal?):           Promise<PageResult<ReportPageItem>>;
client.compliance.listSigningEnvelopes(req?, signal?):  Promise<PageResult<SigningEnvelopePageItem>>;
client.compliance.listSealApprovals(req?, signal?):     Promise<PageResult<SealApprovalPageItem>>;
```

The request argument is optional. It extends the shared `PageRequest`
(`pageNo`, `pageSize`, `sortBy`, `sortDirection` — all optional; omitted values
let the backend pick defaults) plus per-method filters:

| Method | Endpoint | Filters (all optional) |
| --- | --- | --- |
| `listEvidenceAssets` | `GET /compliance/evidence/assets/page` | `assetType`, `status`, `createTimeStart`, `createTimeEnd` |
| `listTimestamps` | `GET /compliance/timestamps/page` | `provider`, `verificationStatus`, `createTimeStart`, `createTimeEnd` |
| `listEvidencePackages` | `GET /compliance/evidence/packages/page` | `status`, `createTimeStart`, `createTimeEnd` |
| `listReports` | `GET /compliance/reports/page` | `status`, `createTimeStart`, `createTimeEnd` |
| `listSigningEnvelopes` | `GET /compliance/signing-envelopes/page` | `status`, `createTimeStart`, `createTimeEnd` |
| `listSealApprovals` | `GET /compliance/seal-approvals/page` | `status`, `createTimeStart`, `createTimeEnd` |

`createTimeStart` / `createTimeEnd` are caller-supplied datetime **strings**. The
backend parses them as `yyyy-MM-dd HH:mm:ss` (for example
`'2026-05-01 00:00:00'`). The SDK passes them through verbatim — it does not
validate the format or convert time zones.

```ts
const page = await client.compliance.listSealApprovals({
  pageNo: 1,
  pageSize: 20,
  status: 'PENDING',
  createTimeStart: '2026-05-01 00:00:00',
  createTimeEnd: '2026-05-22 23:59:59',
});

console.log(page.total, page.list.length);
```

These are authenticated GET reads, so they follow the same read semantics as
`getEvidenceAsset` / `getReport`: one safe `401` refresh-and-replay retry.

`listSealApprovals` is distinct from `listPendingSealApprovals` — the latter
returns only pending approvals as a plain array; `listSealApprovals` is paginated
and supports status / time filtering.

The `*PageItem` types (`EvidenceAssetPageItem`, `TimestampPageItem`,
`EvidencePackagePageItem`, `ReportPageItem`, `SigningEnvelopePageItem`,
`SealApprovalPageItem`) are the SDK-safe subset of the corresponding detail view
plus a `createTime` (ISO-8601) field. They never expose provider raw payloads,
certificates, storage keys, or contract originals.

## Error Classification

Compliance business errors are returned as numeric Java error codes in the
standard `BusinessError.code` field. The SDK maps those codes to symbolic keys:

```ts
const info = classifyComplianceError(err);
switch (info.key) {
  case 'COMPLIANCE_STEP_UP_REQUIRED':
    await promptUserToReauthenticate();
    break;
  case 'ENVELOPE_GATE_CLOSED':
  case 'PROVIDER_NOT_CONFIGURED':
    showTerminalComplianceState(info.key);
    break;
}
```

`CompliancePollError` is used by polling helpers for terminal failure, timeout,
abort, and unknown states.

Since v1.5.0, `complianceErrorToRetryAdvice(info)` projects a `ComplianceErrorInfo`
into the cross-domain `RetryAdvice` model (`retryable` / `retryAfter` /
`sameIdempotencyKeyRequired` / `manualActionRequired` / `reason` / messages /
`supportCode`). It is an additive, read-only projection — it does not modify or
replace `ComplianceErrorInfo`; `classifyComplianceError` is unchanged. The
`reason` field is a normalized mapping of the existing error-code registries, not
a new code set. Terminal errors advise a fresh idempotency key
(`sameIdempotencyKeyRequired: false`); step-up errors advise re-authenticating
and retrying with the same key.

## Method Status

Each `client.compliance.*` method has one of four maturity grades. Treat this
table as the contract — `gated` methods are expected to fail-closed until the
backend step-up / gate is opened, and the SDK never retries or fakes success
for them.

| Status | Methods | Meaning |
| --- | --- | --- |
| `production-ready` | `createEvidenceAsset`, `getEvidenceAsset`, `verifyEvidencePublic`, `listEvidenceAssets`, `listEvidencePackages`, `issueTimestamp`, `issueTimestampForAsset`, `getTimestamp`, `verifyTimestamp`, `waitForTimestampVerified`, `listTimestamps`, `buildEvidencePackage`, `createReport`, `getReport`, `downloadReport`, `listReports`, `createSigningEnvelope`, `getSigningEnvelope`, `syncSigningEnvelopeStatus`, `listSigningEnvelopes`, `submitSealApproval`, `rejectSealApproval`, `cancelSealApproval`, `listPendingSealApprovals`, `getSealApproval`, `listSealApprovals`, `getProviderRequest`, `waitForProviderRequestTerminal`, `classifyError` | Backend endpoint, scope, DTO contract, SDK tests and docs are all closed. Safe to call in production. |
| `gated` | `publishReport`, `signEnvelope`, `createH5SigningUrl`, `approveSealApproval` | SDK exposes the method, but the backend fails-closed (`COMPLIANCE_STEP_UP_REQUIRED` / `ENVELOPE_GATE_CLOSED`) until step-up and the W3 gate chain are ready. The SDK does not retry and does not fake success — surface the typed error as "feature not yet open". |
| `draft contract` | operation views, gate-status views, binary download helpers | Type drafts only — not exposed as callable capability in this release. |
| `internal-only` | distribution billing (`reserve` / `commit` / `cancel` / `reconcile` / `refund`), provider raw payloads, provider callbacks, CFCA controlled materials | Server-side S2S only. Never part of the SDK call surface; no SDK method exists for these. |

`submitSealApproval` is `production-ready`: the backend enforces
`Idempotency-Key` + business-fingerprint replay protection, so a repeated submit
with the same key returns the original approval id instead of creating a
duplicate. Persist the idempotency key on the caller side.

## Safety Boundary

Do not place any of the following in SDK code, tests, examples, docs, git
history, environment templates, or package tarballs:

- Provider endpoints or provider raw request/response payloads.
- Certificates, private keys, keystores, signing containers, or passwords.
- Provider product IDs, provider user IDs, transaction codes, project codes, or
  provider seal IDs.
- Contract originals, PII, storage bucket/key values, subject snapshots, or
  callback billing commit payloads.

The Java compliance backend owns provider integration, controlled materials,
local verification, billing state transitions, and OAuth/JWKS validation. The
Go OAuth/JWKS layer owns token issuance and introspection. The TypeScript SDK
only requests scopes, sends Acosmi public DTOs, classifies public errors, and
polls safe public status views.

## Packaged Examples

The npm package includes these examples:

- `examples/compliance-read.ts`
- `examples/compliance-evidence-timestamp.ts`
- `examples/compliance-envelope.ts`

They require caller-provided environment variables and do not contain real
endpoints, secrets, provider materials, or raw provider payloads.
