import { describe, it, expect } from 'vitest';
import { buildInviteUrl, parseInviteCode, stripInviteParam } from '../inviteLink';

describe('buildInviteUrl', () => {
  it('builds an invite URL at root pathname with uppercase room code', () => {
    const url = buildInviteUrl('ab23', {
      origin: 'https://belote.example.com',
      pathname: '/',
    });
    expect(url).toBe('https://belote.example.com/?join=AB23');
  });

  it('preserves a non-root base pathname', () => {
    const url = buildInviteUrl('K7P9', {
      origin: 'https://example.com',
      pathname: '/games/belote/',
    });
    expect(url).toBe('https://example.com/games/belote/?join=K7P9');
  });

  it('preserves port and localhost origin and trims whitespace', () => {
    const url = buildInviteUrl('  q4w8  ', {
      origin: 'http://localhost:5173',
      pathname: '/play',
    });
    expect(url).toBe('http://localhost:5173/play?join=Q4W8');
  });
});

describe('parseInviteCode', () => {
  it('parses a valid 4-character alphanumeric code', () => {
    expect(parseInviteCode('?join=ABCD')).toBe('ABCD');
    expect(parseInviteCode('?join=7X2M')).toBe('7X2M');
  });

  it('normalizes lowercase and trims whitespace', () => {
    expect(parseInviteCode('?join=ab3z')).toBe('AB3Z');
    expect(parseInviteCode('?join=%20k9p2%20')).toBe('K9P2');
  });

  it('works with or without a leading question mark and alongside other query params', () => {
    expect(parseInviteCode('join=m4n5')).toBe('M4N5');
    expect(parseInviteCode('?seed=test-deck&join=r8t3&foo=bar')).toBe('R8T3');
  });

  it('returns null when join param is missing or empty', () => {
    expect(parseInviteCode('')).toBeNull();
    expect(parseInviteCode('?seed=abc')).toBeNull();
    expect(parseInviteCode('?join=')).toBeNull();
    expect(parseInviteCode('?join=%20%20%20%20')).toBeNull();
  });

  it('rejects codes that are too short or too long', () => {
    expect(parseInviteCode('?join=A')).toBeNull();
    expect(parseInviteCode('?join=ABC')).toBeNull();
    expect(parseInviteCode('?join=ABCDE')).toBeNull();
  });

  it('rejects codes containing special characters or internal spaces', () => {
    expect(parseInviteCode('?join=AB-D')).toBeNull();
    expect(parseInviteCode('?join=AB_D')).toBeNull();
    expect(parseInviteCode('?join=AB!1')).toBeNull();
    expect(parseInviteCode('?join=AB%20D')).toBeNull();
    expect(parseInviteCode('?join=É123')).toBeNull();
  });
});

describe('stripInviteParam', () => {
  it('removes join param when it is the only query parameter', () => {
    expect(
      stripInviteParam({ pathname: '/', search: '?join=ABCD', hash: '' }),
    ).toBe('/');
  });

  it('preserves other query parameters like seed and hash fragments', () => {
    expect(
      stripInviteParam({
        pathname: '/belote/',
        search: '?seed=jack-test-1&join=ABCD&debug=1',
        hash: '#table',
      }),
    ).toBe('/belote/?seed=jack-test-1&debug=1#table');
  });

  it('leaves URL intact when join param is absent', () => {
    expect(
      stripInviteParam({ pathname: '/', search: '?seed=test', hash: '' }),
    ).toBe('/?seed=test');
  });
});
