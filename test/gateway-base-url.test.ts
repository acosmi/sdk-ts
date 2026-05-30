// gateway-base-url.test.ts — Phase 1 §2 Acosmi Gateway URL 公共契约。
//
// 覆盖:
//   - normalizeGatewayBaseURL: 协议白名单, query/hash 拒, trailing-slash trim,
//     /api/v4 保留不重复, host 非空, 类型守卫.
//   - Client(cfg): serverURL / baseURL / baseUrl 三 alias 同语义; 多写冲突抛错.
//   - Client.create + 默认值路径不退化.
//   - getServerURL / getBaseURL 同值 readonly helper.
//   - apiURL: /api/v4 已存在不重复追加; 不存在按需追加.
//   - complianceBaseURL 不被 baseURL alias 覆盖.
//   - agent-runs / notifications WS / managed-model chat 都从同一 normalized
//     base 派生 (通过 apiURL 形式断言).

import { describe, expect, it } from 'vitest';

import {
  Client,
  DEFAULT_GATEWAY_BASE_URL,
  normalizeGatewayBaseURL,
} from '../src/index';

describe('normalizeGatewayBaseURL', () => {
  it('returns http/https URL unchanged when canonical', () => {
    expect(normalizeGatewayBaseURL('https://gw.example')).toBe('https://gw.example');
    expect(normalizeGatewayBaseURL('http://localhost:9100')).toBe('http://localhost:9100');
  });

  it('trims surrounding whitespace', () => {
    expect(normalizeGatewayBaseURL('  https://gw.example  ')).toBe('https://gw.example');
  });

  it('trims trailing slashes (single and multiple)', () => {
    expect(normalizeGatewayBaseURL('https://gw.example/')).toBe('https://gw.example');
    expect(normalizeGatewayBaseURL('https://gw.example///')).toBe('https://gw.example');
  });

  it('preserves /api/v4 suffix and does not duplicate via apiURL()', () => {
    const norm = normalizeGatewayBaseURL('https://gw.example/api/v4/');
    expect(norm).toBe('https://gw.example/api/v4');
    const c = new Client({ baseURL: 'https://gw.example/api/v4/' });
    expect(c.serverURL).toBe('https://gw.example/api/v4');
    // apiURL must not double-add /api/v4
    expect(c.apiURL('/agent-runs')).toBe('https://gw.example/api/v4/agent-runs');
  });

  it('appends /api/v4 when serverURL has no suffix', () => {
    const c = new Client({ baseURL: 'https://gw.example' });
    expect(c.apiURL('/agent-runs')).toBe('https://gw.example/api/v4/agent-runs');
  });

  it('rejects ws/wss (CrabCode --sdk-url RemoteIO, not gateway URL)', () => {
    expect(() => normalizeGatewayBaseURL('ws://session.example')).toThrow(/only allows http\/https/);
    expect(() => normalizeGatewayBaseURL('wss://session.example/path')).toThrow(
      /only allows http\/https/,
    );
  });

  it('rejects non-http(s) schemes (file/data/javascript/...)', () => {
    expect(() => normalizeGatewayBaseURL('file:///etc/passwd')).toThrow(/only allows http\/https/);
    expect(() => normalizeGatewayBaseURL('javascript:alert(1)')).toThrow();
  });

  it('rejects empty / whitespace-only / non-string input', () => {
    expect(() => normalizeGatewayBaseURL('')).toThrow(/empty/);
    expect(() => normalizeGatewayBaseURL('   ')).toThrow(/empty/);
    // @ts-expect-error — non-string input must throw at runtime
    expect(() => normalizeGatewayBaseURL(undefined)).toThrow(TypeError);
    // @ts-expect-error — non-string input must throw at runtime
    expect(() => normalizeGatewayBaseURL(123)).toThrow(TypeError);
  });

  it('rejects unparseable URL', () => {
    expect(() => normalizeGatewayBaseURL('not a url at all')).toThrow(/not a valid URL/);
  });

  it('rejects URL with query / hash (gateway URL must be clean)', () => {
    expect(() => normalizeGatewayBaseURL('https://gw.example?foo=bar')).toThrow(/query or hash/);
    expect(() => normalizeGatewayBaseURL('https://gw.example#frag')).toThrow(/query or hash/);
  });
});

describe('Client constructor — Phase 0 §2 alias', () => {
  it('default Gateway URL when no field provided', () => {
    const c = new Client({});
    expect(c.serverURL).toBe(DEFAULT_GATEWAY_BASE_URL);
    expect(c.getServerURL()).toBe(DEFAULT_GATEWAY_BASE_URL);
    expect(c.getBaseURL()).toBe(DEFAULT_GATEWAY_BASE_URL);
  });

  it('serverURL alone normalizes (legacy path unchanged)', () => {
    const c = new Client({ serverURL: 'https://nexus.test/' });
    expect(c.serverURL).toBe('https://nexus.test');
  });

  it('baseURL alone is equivalent to serverURL', () => {
    const c = new Client({ baseURL: 'https://nexus.test/' });
    expect(c.serverURL).toBe('https://nexus.test');
    expect(c.getBaseURL()).toBe('https://nexus.test');
  });

  it('baseUrl (camelCase-lowercase) alone is equivalent to serverURL', () => {
    const c = new Client({ baseUrl: 'https://nexus.test/' });
    expect(c.serverURL).toBe('https://nexus.test');
  });

  it('serverURL + baseURL agreeing after normalize is OK', () => {
    const c = new Client({
      serverURL: 'https://nexus.test',
      baseURL: 'https://nexus.test/',
    });
    expect(c.serverURL).toBe('https://nexus.test');
  });

  it('serverURL + baseURL disagreeing throws conflict', () => {
    expect(
      () => new Client({ serverURL: 'https://a.example', baseURL: 'https://b.example' }),
    ).toThrow(/conflict/);
  });

  it('baseURL + baseUrl disagreeing throws conflict', () => {
    expect(() => new Client({ baseURL: 'https://a.example', baseUrl: 'https://b.example' })).toThrow(
      /conflict/,
    );
  });

  it('wss:// in any alias is rejected (RemoteIO not gateway)', () => {
    expect(() => new Client({ baseURL: 'wss://session.example' })).toThrow(
      /only allows http\/https/,
    );
    expect(() => new Client({ serverURL: 'wss://session.example' })).toThrow(
      /only allows http\/https/,
    );
  });

  it('Client.create resolves with normalized serverURL (no token persistence regression)', async () => {
    const c = await Client.create({ baseURL: 'https://gw.example/api/v4/' });
    expect(c.serverURL).toBe('https://gw.example/api/v4');
  });
});

describe('Client.complianceBaseURL — not overridden by baseURL alias', () => {
  it('complianceBaseURL stays at default ${serverURL}/admin-api when omitted', () => {
    const c = new Client({ baseURL: 'https://gw.example' });
    expect(c.complianceURL('/foo')).toBe('https://gw.example/admin-api/foo');
  });

  it('explicit complianceBaseURL is preserved independently of baseURL', () => {
    const c = new Client({
      baseURL: 'https://gw.example',
      complianceBaseURL: 'https://compliance.example',
    });
    expect(c.complianceURL('/foo')).toBe('https://compliance.example/foo');
  });

  it('complianceBaseURL trim trailing slash preserved', () => {
    const c = new Client({
      baseURL: 'https://gw.example',
      complianceBaseURL: 'https://compliance.example/',
    });
    expect(c.complianceURL('/foo')).toBe('https://compliance.example/foo');
  });
});

describe('apiURL — single normalized base feeds agent-runs / managed-model / notifications WS', () => {
  it('agent-runs path derives from same base', () => {
    const c = new Client({ baseURL: 'https://gw.example' });
    expect(c.apiURL('/agent-runs')).toBe('https://gw.example/api/v4/agent-runs');
  });

  it('managed-models path derives from same base', () => {
    const c = new Client({ baseURL: 'https://gw.example' });
    expect(c.apiURL('/managed-models')).toBe('https://gw.example/api/v4/managed-models');
  });

  it('notifications WS path derives from same base (string only — runtime swap done by ws layer)', () => {
    const c = new Client({ baseURL: 'https://gw.example' });
    expect(c.apiURL('/ws')).toBe('https://gw.example/api/v4/ws');
  });

  it('switching base via per-instance not by mutation', () => {
    const a = new Client({ baseURL: 'https://a.example' });
    const b = new Client({ baseURL: 'https://b.example' });
    expect(a.apiURL('/foo')).toBe('https://a.example/api/v4/foo');
    expect(b.apiURL('/foo')).toBe('https://b.example/api/v4/foo');
  });
});

describe('Client.apiBaseURL — v2.3.0 同源代理 base 覆盖 (casehall 跨域 403 根因)', () => {
  it('unset apiBaseURL — apiURL falls back to serverURL (零回归)', () => {
    const c = new Client({ baseURL: 'https://gw.example' });
    expect(c.apiBaseURL).toBeNull();
    expect(c.apiURL('/api/casehall/lawyer-credentials/my')).toBe(
      'https://gw.example/api/v4/api/casehall/lawyer-credentials/my',
    );
  });

  it('apiBaseURL overrides the gateway base for apiURL() (serverURL untouched)', () => {
    const c = new Client({
      serverURL: 'https://acosmi.com',
      apiBaseURL: 'https://sign.zhonglvbao.com',
    });
    // serverURL (OAuth discover / compliance default) stays at the real gateway.
    expect(c.serverURL).toBe('https://acosmi.com');
    expect(c.complianceURL('/compliance/foo')).toBe(
      'https://acosmi.com/admin-api/compliance/foo',
    );
    // /api/v4 gateway calls (casehall) now route to the same-origin proxy base.
    expect(c.apiURL('/api/casehall/lawyer-credentials/my')).toBe(
      'https://sign.zhonglvbao.com/api/v4/api/casehall/lawyer-credentials/my',
    );
  });

  it('apiBaseURL trims trailing slashes (mirrors complianceBaseURL)', () => {
    const c = new Client({ apiBaseURL: 'https://sign.zhonglvbao.com///' });
    expect(c.apiBaseURL).toBe('https://sign.zhonglvbao.com');
    expect(c.apiURL('/foo')).toBe('https://sign.zhonglvbao.com/api/v4/foo');
  });

  it('apiBaseURL already ending in /api/v4 is not double-appended', () => {
    const c = new Client({ apiBaseURL: 'https://sign.zhonglvbao.com/api/v4/' });
    expect(c.apiURL('/foo')).toBe('https://sign.zhonglvbao.com/api/v4/foo');
  });

  it('apiBaseURL is independent of complianceBaseURL (orthogonal overrides)', () => {
    const c = new Client({
      serverURL: 'https://acosmi.com',
      apiBaseURL: 'https://sign.zhonglvbao.com',
      complianceBaseURL: 'https://sign.zhonglvbao.com/admin-api',
    });
    expect(c.apiURL('/foo')).toBe('https://sign.zhonglvbao.com/api/v4/foo');
    expect(c.complianceURL('/compliance/bar')).toBe(
      'https://sign.zhonglvbao.com/admin-api/compliance/bar',
    );
  });
});
