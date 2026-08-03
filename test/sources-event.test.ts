import { describe, expect, it } from 'vitest';
import {
  classifySourcesEvent,
  parseSourcesEvent,
  type SourcesEventIssueCode,
  type StreamEvent,
} from '../src/models/types';

const stream = (event: string, value: unknown): StreamEvent => ({
  event,
  data: typeof value === 'string' ? value : JSON.stringify(value),
});

describe('classifySourcesEvent', () => {
  it('distinguishes non-sources from both transport forms', () => {
    expect(classifySourcesEvent(stream('message', { type: 'message' }))).toEqual({
      kind: 'not_sources',
    });
    expect(classifySourcesEvent(stream('sources', { sources: [] }))).toEqual({
      kind: 'empty_sources',
    });
    expect(classifySourcesEvent(stream('message', { type: 'sources', sources: [] }))).toEqual({
      kind: 'empty_sources',
    });
  });

  it('preserves a valid non-empty source event and unknown additive fields', () => {
    const result = classifySourcesEvent(
      stream('sources', {
        type: 'sources',
        sources: [
          {
            title: 'A',
            url: 'https://example.test/a',
            snippet: 'summary',
            rank: 1,
          },
        ],
        session_id: 'session-1',
        trace_version: 2,
      }),
    );

    expect(result).toEqual({
      kind: 'sources',
      value: {
        type: 'sources',
        sources: [
          {
            title: 'A',
            url: 'https://example.test/a',
            snippet: 'summary',
            rank: 1,
          },
        ],
        session_id: 'session-1',
        trace_version: 2,
      },
    });
  });

  it.each<[string, StreamEvent, SourcesEventIssueCode]>([
    ['invalid JSON', { event: 'sources', data: '{' }, 'invalid_json'],
    ['missing sources', stream('sources', { type: 'sources' }), 'missing_sources'],
    ['non-array sources', stream('sources', { sources: {} }), 'sources_not_array'],
    ['non-object item', stream('sources', { sources: ['bad'] }), 'source_not_object'],
    [
      'invalid title',
      stream('sources', { sources: [{ title: 1, url: 'u' }] }),
      'source_title_invalid',
    ],
    ['invalid url', stream('sources', { sources: [{ title: 't', url: 1 }] }), 'source_url_invalid'],
    [
      'invalid snippet',
      stream('sources', { sources: [{ title: 't', url: 'u', snippet: 1 }] }),
      'source_snippet_invalid',
    ],
    ['invalid session id', stream('sources', { sources: [], session_id: 1 }), 'session_id_invalid'],
  ])('classifies %s with a stable issue code', (_name, event, code) => {
    expect(classifySourcesEvent(event)).toEqual({ kind: 'malformed_sources', code });
  });

  it('does not treat invalid JSON on an unrelated SSE event as sources', () => {
    expect(classifySourcesEvent({ event: 'message', data: '{' })).toEqual({
      kind: 'not_sources',
    });
  });
});

describe('parseSourcesEvent compatibility', () => {
  it('retains the legacy null conditions', () => {
    expect(parseSourcesEvent(stream('message', { type: 'message' }))).toBeNull();
    expect(parseSourcesEvent(stream('sources', { sources: [] }))).toBeNull();
    expect(parseSourcesEvent({ event: 'sources', data: '{' })).toBeNull();
  });

  it('retains the exact legacy object shape, including session_id undefined', () => {
    const result = parseSourcesEvent(
      stream('sources', {
        sources: [{ title: 'A', url: 'https://example.test/a' }],
        extra: true,
      }),
    );
    expect(result).toEqual({
      sources: [{ title: 'A', url: 'https://example.test/a' }],
      session_id: undefined,
    });
    expect(Object.prototype.hasOwnProperty.call(result, 'session_id')).toBe(true);
    expect(result).not.toHaveProperty('extra');
  });

  it('retains the legacy permissive non-empty payload behavior', () => {
    const malformed = [{ unexpected: true }];
    expect(
      parseSourcesEvent(
        stream('sources', {
          sources: malformed,
          session_id: 7,
        }),
      ),
    ).toEqual({
      sources: malformed,
      session_id: 7,
    });
  });
});
