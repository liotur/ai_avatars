import type { CSSProperties } from 'react';

/**
 * Mixed into the hash so that the starter avatars land at least 30 degrees
 * apart on the colour wheel. Any other name still gets a stable hue of its own.
 */
const HUE_SEED = 12607;

/**
 * A stable hue from 0 to 359 for a name, so an avatar keeps its colours
 * everywhere it appears. The hash is FNV-1a.
 */
export function hueOf(name: string): number {
  let hash = (0x811c9dc5 ^ HUE_SEED) >>> 0;
  for (const char of name.trim().toLowerCase()) {
    hash ^= char.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0) % 360;
}

/** Two letters: the first letter of the first two words, or the first two letters of a single word. */
export function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 1) {
    const [first = '', second = ''] = Array.from(words[0] ?? '');
    return first.toUpperCase() + second.toLowerCase();
  }
  return words
    .slice(0, 2)
    .map((word) => Array.from(word)[0] ?? '')
    .join('')
    .toUpperCase();
}

type AvatarOrbProps = {
  name: string;
  size?: 'sm' | 'md' | 'lg' | 'xl';
};

/**
 * The avatar's face: a gradient derived from its name, with its initials.
 * Decorative, because the name is always shown as text beside it.
 */
export function AvatarOrb({ name, size = 'md' }: AvatarOrbProps) {
  const style = { '--orb-h': hueOf(name) } as CSSProperties;
  return (
    <span className={`orb orb-${size}`} style={style} aria-hidden="true">
      {initialsOf(name)}
    </span>
  );
}
