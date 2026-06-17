"use client";

import { useEffect, useRef, useState } from "react";
import {
  clearSessionDraft,
  readSessionDraft,
  writeSessionDraft,
} from "@/lib/forms/session-draft";

const SAVE_DEBOUNCE_MS = 600;

export function useSessionFormDraft<T extends { savedAt: string }>(
  storageKey: string,
  snapshot: Omit<T, "savedAt">,
  applyDraft: (draft: T) => void,
  options?: {
    enabled?: boolean;
    hasContent?: (draft: T) => boolean;
  }
): {
  draftRestored: boolean;
  dismissDraftNotice: () => void;
  clearDraft: () => void;
} {
  const enabled = options?.enabled ?? true;
  const hasContentRef = useRef(options?.hasContent);
  hasContentRef.current = options?.hasContent;

  const hasContent = (draft: T) => {
    const fn = hasContentRef.current;
    if (fn) return fn(draft);
    const { savedAt: _savedAt, ...rest } = draft;
    return Object.values(rest).some((value) => {
      if (typeof value === "string") return value.trim().length > 0;
      if (Array.isArray(value)) return value.length > 0;
      if (value && typeof value === "object") {
        return Object.keys(value as object).length > 0;
      }
      return Boolean(value);
    });
  };

  const [draftRestored, setDraftRestored] = useState(false);
  const restoredRef = useRef(false);
  const applyRef = useRef(applyDraft);
  applyRef.current = applyDraft;

  useEffect(() => {
    if (!enabled) return;
    if (restoredRef.current) return;
    restoredRef.current = true;
    const draft = readSessionDraft<T>(storageKey);
    if (!draft || !hasContent(draft)) return;
    applyRef.current(draft);
    setDraftRestored(true);
  }, [storageKey, enabled]);

  useEffect(() => {
    if (!enabled) return;
    const timer = setTimeout(() => {
      const draft = {
        ...snapshot,
        savedAt: new Date().toISOString(),
      } as T;
      if (!hasContent(draft)) {
        clearSessionDraft(storageKey);
        return;
      }
      writeSessionDraft(storageKey, draft);
    }, SAVE_DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [storageKey, snapshot, enabled]);

  return {
    draftRestored,
    dismissDraftNotice: () => setDraftRestored(false),
    clearDraft: () => clearSessionDraft(storageKey),
  };
}
