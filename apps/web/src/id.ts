/**
 * A key for something that lives only on this page. `crypto.randomUUID` exists
 * only on https and localhost, so a plain http address gets the fallback.
 */
export const newId = (): string =>
  globalThis.crypto?.randomUUID?.() ?? `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
