import type { FieldErrors, Resolver } from 'react-hook-form';
import { zAvatarCreate, zAvatarUpdate } from '@avatars/contracts/avatar/zod';
import { normalizeForm, type AvatarFormValues, type ListName } from './values';

export const FIELD_ORDER = [
  'name',
  'description',
  'useWhen',
  'perspective',
  'voice',
  'caresAbout',
  'ignores',
  'intensity',
] as const;

export const FIELD_LABELS: Record<(typeof FIELD_ORDER)[number], string> = {
  name: 'Name',
  description: 'Description',
  useWhen: 'Use when',
  perspective: 'Perspective',
  voice: 'Voice',
  caresAbout: 'Cares about',
  ignores: 'Ignores',
  intensity: 'Intensity',
};

const LIST_FIELDS = new Set<string>(['useWhen', 'caresAbout', 'ignores']);

export type SummaryItem = {
  id: string;
  label: string;
  message: string;
};

export function readableValidationMessage(message: string): string {
  const minString = message.match(/expected string to have >=(\d+) characters/i);
  if (minString) {
    return minString[1] === '1' ? 'Enter something here.' : `Use at least ${minString[1]} characters.`;
  }
  const maxString = message.match(/expected string to have <=(\d+) characters/i);
  if (maxString) return `Use at most ${maxString[1]} characters.`;
  const minArray = message.match(/expected array to have >=(\d+)/i);
  if (minArray) return minArray[1] === '1' ? 'Add at least one.' : `Add at least ${minArray[1]}.`;
  const maxArray = message.match(/expected array to have <=(\d+)/i);
  if (maxArray) return `Use at most ${maxArray[1]}.`;
  if (/invalid option: expected one of "subtle"/i.test(message)) {
    return 'Choose subtle, balanced, or immersive.';
  }
  return message;
}

export function avatarFormResolver(mode: 'create' | 'edit'): Resolver<AvatarFormValues> {
  const schema = mode === 'create' ? zAvatarCreate : zAvatarUpdate;
  return async (values) => {
    const parsed = schema.safeParse(normalizeForm(values));
    if (parsed.success) {
      return { values: normalizeForm(values), errors: {} };
    }

    const errors: Record<string, unknown> = {};
    for (const issue of parsed.error.issues) {
      assignIssue(errors, issue.path, readableValidationMessage(issue.message), issue.code);
    }
    return { values: {}, errors: errors as FieldErrors<AvatarFormValues> };
  };
}

function assignIssue(errors: Record<string, unknown>, path: PropertyKey[], message: string, code: string) {
  const head = path[0];
  if (typeof head !== 'string') return;
  if (path.length <= 1) {
    if (LIST_FIELDS.has(head)) {
      const existing = asRecord(errors[head]);
      existing.root = { type: code, message };
      errors[head] = existing;
      return;
    }
    errors[head] = { type: code, message };
    return;
  }
  const existing = asRecord(errors[head]);
  existing[String(path[1])] = { type: code, message };
  errors[head] = existing;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object') return value as Record<string, unknown>;
  return {};
}

export function summarizeErrors(errors: FieldErrors<AvatarFormValues>): SummaryItem[] {
  const items: SummaryItem[] = [];
  for (const field of FIELD_ORDER) {
    const node = errors[field];
    if (!node || typeof node !== 'object') continue;
    const record = node as Record<string, unknown>;
    const own = messageOf(record);
    if (own) items.push({ id: field, label: FIELD_LABELS[field], message: own });
    const root = record.root;
    if (root && typeof root === 'object') {
      const rootMessage = messageOf(root as Record<string, unknown>);
      if (rootMessage) items.push({ id: field, label: FIELD_LABELS[field], message: rootMessage });
    }
    for (const [key, value] of Object.entries(record)) {
      if (!/^\d+$/.test(key) || !value || typeof value !== 'object') continue;
      const itemMessage = messageOf(value as Record<string, unknown>);
      if (itemMessage) {
        items.push({ id: `${field}-${key}`, label: FIELD_LABELS[field], message: itemMessage });
      }
    }
  }
  return items;
}

function messageOf(record: Record<string, unknown>): string | undefined {
  return typeof record.message === 'string' ? record.message : undefined;
}

export function pointerToId(pointer: string): string | undefined {
  const parts = pointer.split('/').filter(Boolean);
  const head = parts[0];
  if (!head || !(head in FIELD_LABELS)) return undefined;
  if (parts.length === 1) return head;
  return `${head}-${parts.slice(1).join('-')}`;
}

export function labelForPointer(pointer: string): string | undefined {
  const head = pointer.split('/').filter(Boolean)[0];
  if (!head || !(head in FIELD_LABELS)) return undefined;
  return FIELD_LABELS[head as keyof typeof FIELD_LABELS];
}

export function groupMessage(field: unknown): string | undefined {
  if (!field || typeof field !== 'object') return undefined;
  const record = field as Record<string, unknown>;
  const own = messageOf(record);
  if (own) return own;
  if (record.root && typeof record.root === 'object') {
    return messageOf(record.root as Record<string, unknown>);
  }
  return undefined;
}

export function itemMessage(field: unknown, index: number): string | undefined {
  if (!field || typeof field !== 'object') return undefined;
  const entry = (field as Record<string, unknown>)[String(index)];
  if (!entry || typeof entry !== 'object') return undefined;
  return messageOf(entry as Record<string, unknown>);
}

export function isListName(value: string): value is ListName {
  return value === 'useWhen' || value === 'caresAbout' || value === 'ignores';
}
