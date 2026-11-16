import type { Avatar, Intensity } from '@avatars/contracts/avatar';

export type AvatarFormValues = {
  name: string;
  description: string;
  perspective: string;
  voice: string;
  caresAbout: string[];
  ignores: string[];
  useWhen: string[];
  intensity: Intensity;
};

export type ListName = 'useWhen' | 'caresAbout' | 'ignores';

export type Drafts = Record<ListName, string>;

export const emptyDrafts = (): Drafts => ({
  useWhen: '',
  caresAbout: '',
  ignores: '',
});

export function emptyAvatarForm(): AvatarFormValues {
  return {
    name: '',
    description: '',
    perspective: '',
    voice: '',
    caresAbout: [''],
    ignores: [],
    useWhen: [],
    intensity: 'balanced',
  };
}

export function avatarToForm(avatar: Avatar): AvatarFormValues {
  return {
    name: avatar.name,
    description: avatar.description,
    perspective: avatar.perspective,
    voice: avatar.voice,
    caresAbout: avatar.caresAbout.length > 0 ? [...avatar.caresAbout] : [''],
    ignores: [...avatar.ignores],
    useWhen: [...avatar.useWhen],
    intensity: avatar.intensity,
  };
}

export function normalizeForm(values: AvatarFormValues): AvatarFormValues {
  return {
    name: values.name.trim(),
    description: values.description.trim(),
    perspective: values.perspective.trim(),
    voice: values.voice.trim(),
    caresAbout: values.caresAbout.map((item) => item.trim()),
    ignores: values.ignores.map((item) => item.trim()),
    useWhen: values.useWhen.map((item) => item.trim()),
    intensity: values.intensity,
  };
}

const LIST_NAMES: ListName[] = ['useWhen', 'caresAbout', 'ignores'];

export function duplicateItems(values: AvatarFormValues): Array<{ field: ListName; index: number }> {
  const found: Array<{ field: ListName; index: number }> = [];
  for (const field of LIST_NAMES) {
    const seen = new Set<string>();
    values[field].forEach((item, index) => {
      if (!item) return;
      if (seen.has(item)) found.push({ field, index });
      else seen.add(item);
    });
  }
  return found;
}

export function applyDrafts(
  values: AvatarFormValues,
  drafts: Drafts,
  onLimit?: (field: ListName) => void,
): AvatarFormValues {
  return {
    ...values,
    useWhen: appendDraft(values.useWhen, drafts.useWhen, () => onLimit?.('useWhen')),
    caresAbout: appendDraft(values.caresAbout, drafts.caresAbout, () => onLimit?.('caresAbout')),
    ignores: appendDraft(values.ignores, drafts.ignores, () => onLimit?.('ignores')),
  };
}

function appendDraft(items: string[], draft: string, onLimit: () => void): string[] {
  const trimmed = draft.trim();
  if (!trimmed) return items;
  if (items.length >= 10) {
    onLimit();
    return items;
  }
  return [...items, trimmed];
}
