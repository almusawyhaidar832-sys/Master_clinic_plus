"use client";



import { useEffect } from "react";



const SW_URL = "/sw.js";



/** يثبّت manifest + service worker + وضع التلفاز على شاشة الانتظار */

export function QueueScreenPwaBootstrap() {

  useEffect(() => {

    document.documentElement.classList.add("qs-tv-mode");

    return () => {

      document.documentElement.classList.remove("qs-tv-mode");

    };

  }, []);



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

    document.querySelectorAll('link[rel="manifest"]').forEach((el) => {

      if (el !== link && el.getAttribute("href") !== href) {

        el.remove();

      }

    });



    const theme = document.querySelector('meta[name="theme-color"]');

    if (theme) theme.setAttribute("content", "#0891b2");

  }, []);



  useEffect(() => {

    if (!("serviceWorker" in navigator)) return;

    void navigator.serviceWorker

      .register(SW_URL, { scope: "/", updateViaCache: "none" })

      .catch(() => {

        /* بعض متصفحات التلفاز القديمة لا تدعم SW */

      });

  }, []);



  return null;

}


