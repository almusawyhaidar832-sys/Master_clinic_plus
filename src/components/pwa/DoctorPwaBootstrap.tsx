"use client";

import { useEffect } from "react";
import { warmDoctorShellCache } from "@/lib/pwa/doctor-shell-cache";

/**
 * عند دخول بوابة الطبيب مع نت: يخزّن الصفحات الأساسية للعمل بدون نت لاحقاً.
 */
export function DoctorPwaBootstrap() {
  useEffect(() => {
    void warmDoctorShellCache();

    const onOnline = () => {
      void warmDoctorShellCache();
    };

    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, []);

  return null;
}
