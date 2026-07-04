"use client";

import { useEffect, useRef, type ReactNode } from "react";

/** مرجع تصميم — 1920×1080 (Full HD) — يُستخدم للتكييف على جميع أحجام التلفاز */
const DESIGN_W = 1920;
const DESIGN_H = 1080;
const MIN_SCALE = 0.35;

/**
 * يضبط محتوى شاشة الانتظار ليلائم أي تلفاز (720p / 1080p / 4K / متصفحات قديمة)
 * بدون تمرير — يعتمد scale ثنائي الأبعاد + visualViewport عند توفره.
 */
export function QueueScreenTvFit({ children }: { children: ReactNode }) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const viewport = viewportRef.current;
    const inner = innerRef.current;
    if (!viewport || !inner) return;

    let raf = 0;

    const reveal = () => {
      inner.classList.add("qs-tv-fit-ready");
    };
    /** شبكة أمان — لا تبقي المحتوى مخفياً للأبد إن فشل fit() لأي سبب */
    const revealSafetyTimer = setTimeout(reveal, 1200);

    const fit = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        inner.style.transform = "none";
        inner.style.width = `${DESIGN_W}px`;
        inner.style.height = `${DESIGN_H}px`;

        const vv = window.visualViewport;
        const availableW = vv?.width ?? viewport.clientWidth ?? window.innerWidth;
        const availableH = vv?.height ?? viewport.clientHeight ?? window.innerHeight;

        // لوحة ثابتة 1920×1080 — نملأ الشاشة بالعرض/الارتفاع (بدون تصغير
        // بسبب بطاقات إضافية طويلة كانت تترك حوافاً فارغة يميناً ويساراً).
        const scaleX = availableW / DESIGN_W;
        const scaleY = availableH / DESIGN_H;
        const scale = Math.max(MIN_SCALE, Math.min(scaleX, scaleY));

        const scaledW = DESIGN_W * scale;
        const scaledH = DESIGN_H * scale;

        const offsetX = Math.max(0, (availableW - scaledW) / 2);
        const offsetY = Math.max(0, (availableH - scaledH) / 2);

        inner.style.transform = `translate(${offsetX}px, ${offsetY}px) scale(${scale})`;

        viewport.style.height = `${availableH}px`;
        viewport.style.overflow = "hidden";

        reveal();
      });
    };

    fit();

    const ro =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(fit)
        : null;

    ro?.observe(viewport);
    ro?.observe(inner);

    const mo =
      typeof MutationObserver !== "undefined"
        ? new MutationObserver(fit)
        : null;

    mo?.observe(inner, { childList: true, subtree: true, characterData: true });

    window.addEventListener("resize", fit);
    window.addEventListener("orientationchange", fit);
    window.visualViewport?.addEventListener("resize", fit);
    window.visualViewport?.addEventListener("scroll", fit);

    const fontsReady = document.fonts?.ready;
    if (fontsReady) void fontsReady.then(fit);

    const poll = setInterval(fit, 3000);

    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(revealSafetyTimer);
      ro?.disconnect();
      mo?.disconnect();
      clearInterval(poll);
      window.removeEventListener("resize", fit);
      window.removeEventListener("orientationchange", fit);
      window.visualViewport?.removeEventListener("resize", fit);
      window.visualViewport?.removeEventListener("scroll", fit);
    };
  }, []);

  return (
    <div ref={viewportRef} className="qs-tv-viewport">
      <div ref={innerRef} className="qs-tv-fit-inner">
        {children}
      </div>
    </div>
  );
}
