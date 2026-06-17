"use client";

import { useEffect } from "react";
import { warmAccountantShellCache } from "@/lib/pwa/accountant-shell-cache";

/**
 * عند دخول بوابة المحاسب مع نت: يخزّن الصفحات الأساسية للعمل بدون نت لاحقاً.
 */
export function AccountantPwaBootstrap() {
  useEffect(() => {
    void warmAccountantShellCache();

    const onOnline = () => {
      void warmAccountantShellCache();
    };

    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, []);

  return null;
}
