import { describe, expect, it } from 'vitest';
import { avatarFormResolver, groupMessage, itemMessage, summarizeErrors } from './schema';
import type { AvatarFormValues } from './values';

const VALUES: AvatarFormValues = {
  name: 'Skeptical CFO',
  description: 'A finance chief who funds only plans with numbers.',
  perspective: 'Reads every proposal as a claim on cash.',
  voice: 'Dry and brief.',
  caresAbout: ['Cash runway'],
  ignores: [],
  useWhen: [],
  intensity: 'balanced',
};

const OPTIONS = { fields: {}, shouldUseNativeValidation: false };

describe('avatarFormResolver', () => {
  it('passes a complete form', async () => {
    const result = await avatarFormResolver('create')(VALUES, undefined, OPTIONS);
    expect(result.errors).toEqual({});
  });

  // React Hook Form keeps the errors of one validated field only when they are an array.
  it('gives the messages of a list as an array, with one place per row', async () => {
    const values = { ...VALUES, caresAbout: ['Cash runway', ' '] };
    const { errors } = await avatarFormResolver('create')(values, undefined, OPTIONS);

    expect(Array.isArray(errors.caresAbout)).toBe(true);
    expect(itemMessage(errors.caresAbout, 0)).toBeUndefined();
    expect(itemMessage(errors.caresAbout, 1)).toBe('Enter something here.');
    expect(groupMessage(errors.caresAbout)).toBeUndefined();
    expect(summarizeErrors(errors)).toEqual([
      { id: 'caresAbout-1', label: 'Cares about', message: 'Enter something here.' },
    ]);
  });

  it('puts the message about a whole list on an array too', async () => {
    const ignores = Array.from({ length: 11 }, (_, index) => `Topic ${index + 1}`);
    const { errors } = await avatarFormResolver('create')({ ...VALUES, ignores }, undefined, OPTIONS);

    expect(Array.isArray(errors.ignores)).toBe(true);
    expect(groupMessage(errors.ignores)).toBe('Use at most 10.');
    expect(itemMessage(errors.ignores, 0)).toBeUndefined();
    expect(summarizeErrors(errors)).toEqual([{ id: 'ignores', label: 'Ignores', message: 'Use at most 10.' }]);
  });
});
