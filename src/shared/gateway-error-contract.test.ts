import { describe, expect, it } from 'vitest';
import { HTTPError, StreamError, isUserAccessTokenRejected, readGatewayErrorContract } from './errors';

const contract = {
  errorContractVersion: 1,
  faultDomain: 'user_auth' as const,
  errorCode: 'USER_ACCESS_TOKEN_INVALID',
  transportRequestId: null,
  consumeRequestId: 'consume-1',
  providerRequestId: null,
  requestDisposition: 'not_accepted' as const,
  retryable: true,
};

describe('gateway error contract public decoder', () => {
  it('reads HTTPError and recognizes only the exact rejected user token contract', () => {
    const error = new HTTPError(401, contract);
    expect(readGatewayErrorContract(error)).toEqual({ errorContractVersion: 1, faultDomain: 'user_auth',
      errorCode: 'USER_ACCESS_TOKEN_INVALID', transportRequestId: null,
      consumeRequestId: 'consume-1', providerRequestId: null,
      requestDisposition: 'not_accepted', retryable: true });
    expect(isUserAccessTokenRejected(error)).toBe(true);
    expect(isUserAccessTokenRejected(new HTTPError(401, { ...contract, faultDomain: 'provider' }))).toBe(false);
    expect(isUserAccessTokenRejected(new HTTPError(403, contract))).toBe(false);
  });

  it('supports stream and axios shapes while rejecting incomplete or legacy data', () => {
    const stream = new StreamError({ code: contract.errorCode, errorContractVersion: 1,
      faultDomain: contract.faultDomain, requestDisposition: contract.requestDisposition,
      transportRequestId: null, consumeRequestId: 'consume-1', providerRequestId: null,
      retryable: true });
    expect(readGatewayErrorContract(stream)?.errorCode).toBe(contract.errorCode);
    expect(isUserAccessTokenRejected(stream)).toBe(false);
    expect(readGatewayErrorContract({ response: { status: 401, data: contract } })?.faultDomain).toBe('user_auth');
    expect(isUserAccessTokenRejected({ response: { status: 401, data: contract } })).toBe(true);
    expect(readGatewayErrorContract({ ...contract, providerRequestId: undefined })).toBeNull();
    expect(readGatewayErrorContract({ ...contract, errorContractVersion: 0 })).toBeNull();
    expect(readGatewayErrorContract({ ...contract, errorContractVersion: undefined, version: 1 })).toBeNull();
    expect(readGatewayErrorContract(new Error('USER_ACCESS_TOKEN_INVALID'))).toBeNull();
  });
});
