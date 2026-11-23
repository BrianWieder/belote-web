import { describe, it, expect } from 'vitest';
import {
  REACTIONS,
  REACTION_COOLDOWN_MS,
  REACTION_DISPLAY_MS,
  isValidReactionId,
  getReactionLabel,
  type ReactionId,
} from '../reactions';

describe('reactions', () => {
  it('defines unique reaction IDs with non-empty French bistrot labels', () => {
    expect(REACTIONS.length).toBeGreaterThan(0);
    const ids = REACTIONS.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const reaction of REACTIONS) {
      expect(reaction.label.trim().length).toBeGreaterThan(0);
    }
    expect(REACTION_COOLDOWN_MS).toBeGreaterThan(0);
    expect(REACTION_DISPLAY_MS).toBeGreaterThan(0);
  });

  it('validates known reaction IDs and rejects unknown or non-string values', () => {
    for (const reaction of REACTIONS) {
      expect(isValidReactionId(reaction.id)).toBe(true);
    }
    expect(isValidReactionId('unknown')).toBe(false);
    expect(isValidReactionId('')).toBe(false);
    expect(isValidReactionId('BIEN-JOUE')).toBe(false);
    expect(isValidReactionId(null)).toBe(false);
    expect(isValidReactionId(undefined)).toBe(false);
    expect(isValidReactionId(42)).toBe(false);
    expect(isValidReactionId({})).toBe(false);
  });

  it('returns the display label for valid reaction IDs and empty string for unknown IDs', () => {
    for (const reaction of REACTIONS) {
      expect(getReactionLabel(reaction.id)).toBe(reaction.label);
    }
    expect(getReactionLabel('not-a-reaction' as ReactionId)).toBe('');
  });
});
