// بديل خالٍ من "server-only" لبيئة الاختبار (vitest) — Next.js نفسه يستبدله
// بـ empty.js عبر export condition "react-server" عند التجميع؛ هنا نطبّق نفس
// الفكرة يدوياً لأن vitest لا يفعّل هذا الـ condition تلقائياً.
export {};
