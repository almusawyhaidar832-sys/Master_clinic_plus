"use client";

import { useEffect } from "react";

/** يثبّت manifest شاشة الانتظار على هذا المسار */
export function QueueScreenPwaBootstrap() {
  useEffect(() => {
    const href = "/manifest-queue-screen.json";
    let link = document.querySelector<HTMLLinkElement>(
      'link[rel="manifest"][href="/manifest-queue-screen.json"]'
    );
    if (!link) {
      link = document.createElement("link");
      link.rel = "manifest";
      link.href = href;
      document.head.appendChild(link);
    }
    document
      .querySelectorAll('link[rel="manifest"]')
      .forEach((el) => {
        if (el !== link && el.getAttribute("href") !== href) {
          el.remove();
        }
      });
  }, []);

  return null;
}
