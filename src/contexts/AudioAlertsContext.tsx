"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import {
  hasPersistedAudioConsent,
  installGlobalAudioUnlock,
  isQueueAudioReady,
} from "@/lib/queue/audio-alerts";

interface AudioAlertsContextValue {
  /** Web Audio is running (unlocked this session) */
  audioReady: boolean;
  /** User unlocked audio before — remembered in localStorage */
  hasConsent: boolean;
}

const AudioAlertsContext = createContext<AudioAlertsContextValue>({
  audioReady: false,
  hasConsent: false,
});

/**
 * Global audio unlock — first click/keypress anywhere silently enables alerts.
 * Consent is persisted in localStorage across sessions (no manual button).
 */
export function AudioAlertsProvider({ children }: { children: ReactNode }) {
  const [audioReady, setAudioReady] = useState(false);
  const [hasConsent, setHasConsent] = useState(false);

  useEffect(() => {
    setHasConsent(hasPersistedAudioConsent());
    setAudioReady(isQueueAudioReady());

    return installGlobalAudioUnlock(() => {
      setAudioReady(true);
      setHasConsent(true);
    });
  }, []);

  return (
    <AudioAlertsContext.Provider value={{ audioReady, hasConsent }}>
      {children}
    </AudioAlertsContext.Provider>
  );
}

export function useAudioAlerts(): AudioAlertsContextValue {
  return useContext(AudioAlertsContext);
}
