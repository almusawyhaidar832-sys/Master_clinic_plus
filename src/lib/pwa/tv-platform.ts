/** كشف نوع تلفاز/متصفح — لعرض تعليمات التثبيت والعرض المناسبة */

export type TvPlatform =
  | "android-tv"
  | "google-tv"
  | "tizen"
  | "webos"
  | "fire-tv"
  | "smart-tv"
  | "desktop";

export function isLikelyTvDevice(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent.toLowerCase();
  return (
    /smart-tv|smarttv|googletv|android tv|aftb|aftm|aftt|tizen|web0s|webos|hbbtv|netcast|viera|philips|bravia|firetv|silk/i.test(
      ua
    ) ||
    (typeof window !== "undefined" &&
      window.matchMedia("(pointer: coarse) and (hover: none)").matches &&
      Math.min(window.screen.width, window.screen.height) >= 720)
  );
}

export function detectTvPlatform(): TvPlatform {
  if (typeof navigator === "undefined") return "desktop";
  const ua = navigator.userAgent;

  if (/googletv|android tv|aftb|aftm|aftt/i.test(ua)) return "google-tv";
  if (/android/i.test(ua) && isLikelyTvDevice()) return "android-tv";
  if (/tizen/i.test(ua)) return "tizen";
  if (/web0s|webos/i.test(ua)) return "webos";
  if (/firetv|silk/i.test(ua)) return "fire-tv";
  if (isLikelyTvDevice()) return "smart-tv";
  return "desktop";
}

export function getQueueScreenInstallSteps(platform: TvPlatform): string[] {
  switch (platform) {
    case "google-tv":
    case "android-tv":
      return [
        "افتح Chrome على التلفاز",
        "ادخل رمز العيادة في /queue-screen",
        "من قائمة Chrome ⋮ اختر «تثبيت التطبيق» أو «Add to Home screen»",
        "افتح «شاشة الانتظار» من الشاشة الرئيسية — تفتح تلقائياً كل يوم",
      ];
    case "tizen":
      return [
        "افتح Samsung Internet أو Chrome على تلفاز Samsung",
        "ادخل رمز العيادة في /queue-screen",
        "من القائمة ⋮ → «Add page to» → «Home Screen»",
        "ثبّت التطبيق وافتحه من الشاشة الرئيسية",
      ];
    case "webos":
      return [
        "افتح متصفح LG على التلفاز",
        "ادخل رمز العيادة في /queue-screen",
        "من القائمة → «Add to Home Screen»",
        "افتح التطبيق من قائمة التطبيقات",
      ];
    case "fire-tv":
      return [
        "ثبّت Silk Browser أو Chrome من Amazon Appstore",
        "افتح /queue-screen وادخل رمز العيادة",
        "من القائمة → «Add to Home» أو «Bookmark»",
      ];
    case "smart-tv":
      return [
        "افتح متصفح التلفاز (Chrome أو المتصفح المدمج)",
        "ادخل رمز العيادة في /queue-screen",
        "من قائمة المتصفح → «إضافة للشاشة الرئيسية» أو «تثبيت»",
      ];
    default:
      return [
        "افتح Chrome على التلفاز",
        "ادخل رمز العيادة في /queue-screen",
        "من Chrome ⋮ → «تثبيت التطبيق» / Install app",
        "افتح التطبيق من سطح المكتب أو الشاشة الرئيسية",
      ];
  }
}

export function isQueueScreenInstalled(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    window.matchMedia("(display-mode: fullscreen)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}
