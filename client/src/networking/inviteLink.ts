const INVITE_PARAM = 'join';
const ROOM_CODE_PATTERN = /^[A-Z0-9]{4}$/;

export type InviteLocation = Pick<Location, 'origin' | 'pathname'>;
export type InviteStripLocation = Pick<Location, 'pathname' | 'search' | 'hash'>;

/**
 * Builds a shareable invite URL that auto-joins the given 4-character room code,
 * preserving the current origin and base pathname.
 */
export function buildInviteUrl(
  roomCode: string,
  location: InviteLocation = window.location,
): string {
  const normalized = roomCode.trim().toUpperCase();
  return `${location.origin}${location.pathname}?${INVITE_PARAM}=${encodeURIComponent(normalized)}`;
}

/**
 * Parses and validates a 4-character alphanumeric room code from a URL search string.
 * Trims surrounding whitespace and normalizes to uppercase; returns null if absent or invalid.
 */
export function parseInviteCode(search: string): string | null {
  const raw = new URLSearchParams(search).get(INVITE_PARAM);
  if (raw === null) return null;

  const normalized = raw.trim().toUpperCase();
  return ROOM_CODE_PATTERN.test(normalized) ? normalized : null;
}

/**
 * Returns a relative URL (pathname + search + hash) with the `join` query parameter removed,
 * preserving any other query parameters (such as `seed`) and hash fragments.
 */
export function stripInviteParam(
  location: InviteStripLocation = window.location,
): string {
  const params = new URLSearchParams(location.search);
  params.delete(INVITE_PARAM);
  const query = params.toString();
  return `${location.pathname}${query ? `?${query}` : ''}${location.hash}`;
}
