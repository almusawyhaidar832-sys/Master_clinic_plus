"use client";

import { useEffect } from "react";
import { useClinicProfile } from "@/contexts/ClinicProfileContext";
import { cacheOfflineReference } from "@/lib/offline/reference-cache";

/** يحفظ معرّف العيادة محلياً لاستخدامه عند انقطاع النت */
export function useOfflineReferenceBootstrap() {
  const { profile } = useClinicProfile();

  useEffect(() => {
    if (profile?.id) {
      cacheOfflineReference(profile.id);
    }
  }, [profile?.id]);
}
