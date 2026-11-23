export const REACTIONS = [
  { id: 'bien-joue', label: 'Bien joué !' },
  { id: 'joli-coup', label: 'Joli coup !' },
  { id: 'aie', label: 'Aïe !' },
  { id: 'a-toi', label: 'À toi !' },
  { id: 'merci', label: 'Merci !' },
] as const;

export type ReactionId = (typeof REACTIONS)[number]['id'];

export const REACTION_COOLDOWN_MS = 2000;
export const REACTION_DISPLAY_MS = 2500;

const VALID_REACTION_IDS = new Set<string>(REACTIONS.map((r) => r.id));

export function isValidReactionId(value: unknown): value is ReactionId {
  return typeof value === 'string' && VALID_REACTION_IDS.has(value);
}

export function getReactionLabel(id: ReactionId): string {
  return REACTIONS.find((r) => r.id === id)?.label ?? '';
}
