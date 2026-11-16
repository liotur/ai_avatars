import type { Intensity } from '@avatars/contracts/avatar';

const LEVEL: Record<Intensity, number> = { subtle: 1, balanced: 2, immersive: 3 };

/** One to three dots for how strongly the avatar shapes an answer. Shown next to the word, never alone. */
export function IntensityMeter({ intensity }: { intensity: Intensity }) {
  return (
    <span className="meter" aria-hidden="true">
      {[1, 2, 3].map((step) => (
        <i key={step} className={step <= LEVEL[intensity] ? 'on' : undefined} />
      ))}
    </span>
  );
}
