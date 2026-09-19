// stream-error-retry-hints.test.ts — 2.19.5
//
// 网关的流内失败帧从本版起带 `retryAfterSecs`，并且帧上 `retryable` 的**原值**必须
// 原样透出。为什么非要并列存一份原值：SDK 的 `StreamError.retryable` 是
// 「服务端说可重试」∧「请求未被受理」的合取，而流内错误帧并不总带
// `requestDisposition` —— 合取结果于是恒 false。两端各自正确，合起来永远是否。
// 消费方要区分的两件事被压成了同一个 false：
//   - 服务端**明说**不可重试 ⇒ 一票否决，任何本地分类表都不该翻案；
//   - 服务端**什么都没说** ⇒ 回落到消费方自己的分类表。
// 当成同一件事，就是把一整类可恢复的失败判死。
//
// 另钉 `isStreamError` 的结构判据：消费方（CrabCode）在 worker / vm 里消费这条错误，
// `instanceof` 在那里静默为 false —— 症状与「这段分类代码压根没写」逐字相同。

import { describe, expect, it } from 'vitest';

import { HTTPError, StreamError, isStreamError } from '../src';
import { parseStreamError } from '../src/core/http';

/** 网关 /chat 线 `event: failed` 帧；/anthropic 线 `event: error` 同表同解析点。 */
function failedFrame(extra: Record<string, unknown>): string {
  return JSON.stringify({
    errorCode: 'upstream_overloaded',
    stage: 'provider',
    message: '上游繁忙，请稍后重试',
    ...extra,
  });
}

describe('StreamError 的 retryAfterSecs / serverRetryable（2.19.5）', () => {
  it('帧带 retryAfterSecs 与 retryable 时逐字透出，且 retryable 仍是合取结果', () => {
    const err = parseStreamError(
      failedFrame({ retryAfterSecs: 7, retryable: true, requestDisposition: 'unknown' }),
    );

    expect(err.retryAfterSecs).toBe(7);
    // 服务端明说可以重试 —— 这一位不合取，原样保留。
    expect(err.serverRetryable).toBe(true);
    // 而 requestDisposition 不是 not_accepted，合取后的判据仍然是否。改坏合取语义这里会红。
    expect(err.retryable).toBe(false);
  });

  it('帧不带这两个键时一律 undefined（绝不补默认值）', () => {
    const err = parseStreamError(failedFrame({}));

    expect(err.retryAfterSecs).toBeUndefined();
    // 「服务端没说」必须与「服务端说 false」可分：这里是 undefined，下一条用例是 false。
    expect(err.serverRetryable).toBeUndefined();
    expect(err.retryable).toBe(false);
  });

  it('服务端明说 retryable:false 时 serverRetryable 记 false（与「没说」可分）', () => {
    const err = parseStreamError(failedFrame({ retryable: false, requestDisposition: 'not_accepted' }));

    expect(err.serverRetryable).toBe(false);
    expect(err.retryable).toBe(false);
  });

  it('正向对照：合取的两个条件都满足时 retryable 为真（判据没被改成恒假）', () => {
    const err = parseStreamError(
      failedFrame({ retryable: true, requestDisposition: 'not_accepted', retryAfterSecs: 0 }),
    );

    expect(err.retryable).toBe(true);
    expect(err.serverRetryable).toBe(true);
    // 0 是合法的「立刻可重试」，不是缺席。
    expect(err.retryAfterSecs).toBe(0);
  });

  it('非法 retryAfterSecs 一律 undefined —— 宁可不给，绝不编造等待时间', () => {
    for (const bad of [null, -1, '7', {}, true]) {
      const err = parseStreamError(failedFrame({ retryAfterSecs: bad }));
      expect(err.retryAfterSecs, `retryAfterSecs=${JSON.stringify(bad)}`).toBeUndefined();
    }
    // JSON 里写不出 Infinity / NaN，直接走构造函数这条产地。
    for (const bad of [Number.POSITIVE_INFINITY, Number.NaN]) {
      expect(new StreamError({ retryAfterSecs: bad }).retryAfterSecs).toBeUndefined();
    }
  });

  it('/anthropic 线的 error 帧走同一个解析点，同样收下这两个键', () => {
    const err = parseStreamError(
      JSON.stringify({
        type: 'error',
        error: { type: 'overloaded_error', message: 'upstream busy' },
        retryable: true,
        retryAfterSecs: 12,
      }),
    );

    expect(err.code).toBe('overloaded_error');
    expect(err.retryAfterSecs).toBe(12);
    expect(err.serverRetryable).toBe(true);
  });
});

describe('isStreamError 的结构判据（2.19.5）', () => {
  it('真实实例为真', () => {
    expect(isStreamError(parseStreamError(failedFrame({})))).toBe(true);
    expect(isStreamError(new StreamError({ code: 'rate_limit' }))).toBe(true);
  });

  it('同形普通对象也为真 —— 跨 realm / 跨 bundle 的那份实例就长这样', () => {
    const crossRealm = { name: 'StreamError', errorCode: 'rate_limit', message: 'x' };
    expect(isStreamError(crossRealm)).toBe(true);
  });

  it('HTTPError 为假（它也有可选的 errorCode，靠 name 分开）', () => {
    const http = new HTTPError(429, { errorCode: 'WINDOW_LIMIT_EXCEEDED' });
    expect(http.errorCode).toBe('WINDOW_LIMIT_EXCEEDED');
    expect(isStreamError(http)).toBe(false);
  });

  it('非对象与形状不符者为假', () => {
    for (const bad of [null, undefined, 'StreamError', 42, { name: 'StreamError' }, { name: 'StreamError', errorCode: 7 }, { errorCode: 'x' }]) {
      expect(isStreamError(bad), JSON.stringify(bad) ?? String(bad)).toBe(false);
    }
  });
});
