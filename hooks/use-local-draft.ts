"use client";

/** Small, safe wrappers around localStorage for autosaving unfinished forms. */
export function readDraft<T>(key: string): T | null {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { v: number; savedAt: number; data: T };
    // Forget drafts older than 14 days.
    if (Date.now() - parsed.savedAt > 14 * 24 * 3600 * 1000) {
      window.localStorage.removeItem(key);
      return null;
    }
    return parsed.data;
  } catch {
    return null;
  }
}

export function writeDraft<T>(key: string, data: T) {
  try {
    window.localStorage.setItem(key, JSON.stringify({ v: 1, savedAt: Date.now(), data }));
  } catch {
    /* storage full or blocked: autosave is a convenience only */
  }
}

export function clearDraft(key: string) {
  try {
    window.localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}
