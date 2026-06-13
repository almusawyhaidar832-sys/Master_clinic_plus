"use client";

import { useCallback, useEffect, useState } from "react";
import { Download } from "lucide-react";
import { isStandalonePwa } from "@/lib/pwa/platform";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

interface PwaInstallButtonProps {
  label: string;
  installingLabel: string;
  className?: string;
  onInstalled?: () => void;
}

export function PwaInstallButton({
  label,
  installingLabel,
  className,
  onInstalled,
}: PwaInstallButtonProps) {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(
    null
  );
  const [installed, setInstalled] = useState(false);
  const [installing, setInstalling] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (isStandalonePwa()) {
      setInstalled(true);
      return;
    }

    const onBeforeInstall = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
    };

    const onAppInstalled = () => {
      setInstalled(true);
      setDeferred(null);
      onInstalled?.();
    };

    window.addEventListener("beforeinstallprompt", onBeforeInstall);
    window.addEventListener("appinstalled", onAppInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstall);
      window.removeEventListener("appinstalled", onAppInstalled);
    };
  }, [onInstalled]);

  const handleInstall = useCallback(async () => {
    if (!deferred) return;
    setInstalling(true);
    try {
      await deferred.prompt();
      const { outcome } = await deferred.userChoice;
      if (outcome === "accepted") {
        setInstalled(true);
        setDeferred(null);
        onInstalled?.();
      }
    } finally {
      setInstalling(false);
    }
  }, [deferred, onInstalled]);

  if (installed || !deferred) return null;

  return (
    <button
      type="button"
      onClick={() => void handleInstall()}
      disabled={installing}
      className={className}
    >
      <Download className="h-3.5 w-3.5" />
      {installing ? installingLabel : label}
    </button>
  );
}
