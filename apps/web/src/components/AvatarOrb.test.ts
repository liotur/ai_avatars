import { describe, expect, it } from 'vitest';
import { hueOf, initialsOf } from './AvatarOrb';

describe('avatar badge', () => {
  it('gives a name the same hue every time, whatever its case or padding', () => {
    expect(hueOf('Roast Master')).toBe(hueOf('  roast master '));
    expect(hueOf('Roast Master')).toBeGreaterThanOrEqual(0);
    expect(hueOf('Roast Master')).toBeLessThan(360);
  });

  it('keeps the starter avatars visibly apart', () => {
    const starters = [
      'Generalist',
      'Roast Master',
      'Software Engineer',
      'QA Tester',
      'Skeptical CFO',
      'Patient Teacher',
      'Philosopher',
      'Psychiatrist',
      'Future Me at 80',
    ];
    const hues = starters.map(hueOf).sort((a, b) => a - b);
    const gaps = hues.map((hue, index) => (index === 0 ? hue + 360 - (hues.at(-1) ?? 0) : hue - (hues[index - 1] ?? 0)));
    expect(Math.min(...gaps)).toBeGreaterThanOrEqual(30);
  });

  it('shows two letters', () => {
    expect(initialsOf('Skeptical CFO')).toBe('SC');
    expect(initialsOf('Future Me at 80')).toBe('FM');
    expect(initialsOf('Philosopher')).toBe('Ph');
    expect(initialsOf('Psychiatrist')).toBe('Ps');
    expect(initialsOf('  x ')).toBe('X');
    expect(initialsOf('?')).toBe('?');
    expect(initialsOf('')).toBe('');
  });
});
