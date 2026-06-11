/**
 * تشكيل الأسماء العربية لـ TTS — مخارج أوضح (مثل أَحْمَد)
 */

const ALEF_VARIANTS = /[\u0622\u0623\u0625\u0671]/g;
const TATWEEL = /\u0640/g;
const HARAKAT = /[\u064B-\u065F\u0670]/g;

function nameLookupKey(word: string): string {
  return word
    .normalize("NFC")
    .replace(HARAKAT, "")
    .replace(TATWEEL, "")
    .replace(ALEF_VARIANTS, "ا")
    .replace(/\u0629/g, "ه")
    .replace(/\u0649/g, "ي")
    .replace(/[^\u0600-\u06FF]/g, "")
    .trim();
}

const VOCALIZED_NAMES: Record<string, string> = {
  احمد: "أَحْمَد",
  احمدي: "أَحْمَدِي",
  محمد: "مُحَمَّد",
  محمود: "مَحمُود",
  علي: "عَلِيّ",
  علاء: "عَلاء",
  حسين: "حُسَيْن",
  حسن: "حَسَن",
  حسناء: "حَسْنَاء",
  حسام: "حِسَام",
  عباس: "عَبَّاس",
  عبدالله: "عَبْدُ الله",
  عبدالرحمن: "عَبْدُ الرَّحْمَن",
  عبدالرحيم: "عَبْدُ الرَّحِيم",
  عبدالكريم: "عَبْدُ الكَرِيم",
  عبدالحسين: "عَبْدُ الحُسَيْن",
  عبدالحسن: "عَبْدُ الحَسَن",
  عبدالامير: "عَبْدُ الأمِير",
  عبدالزهراء: "عَبْدُ الزَّهْراء",
  عبدالهادي: "عَبْدُ الهَادِي",
  عبدالرضا: "عَبْدُ الرِّضَا",
  عبد: "عَبْد",
  كاظم: "كَاظِم",
  جعفر: "جَعْفَر",
  مصطفى: "مُصْطَفى",
  مصطفي: "مُصْطَفى",
  عمر: "عُمَر",
  عمار: "عَمَّار",
  خالد: "خَالِد",
  سعد: "سَعد",
  سعيد: "سَعِيد",
  طارق: "طَارِق",
  يوسف: "يُوسُف",
  ابراهيم: "إِبْرَاهِيم",
  نور: "نُور",
  نورالدين: "نُورُ الدِّين",
  حيدر: "حَيدَر",
  ليث: "لَيْث",
  رعد: "رَعد",
  رامي: "رَامِي",
  زيد: "زَيد",
  مرتضى: "مُرْتَضى",
  مرتضي: "مُرْتَضى",
  صادق: "صَادِق",
  باقر: "بَاقِر",
  هادي: "هَادِي",
  هيثم: "هَيْثَم",
  وليد: "وَلِيد",
  فادي: "فَادِي",
  فارس: "فَارِس",
  كريم: "كَرِيم",
  امير: "أَمِير",
  ضياء: "ضِياء",
  سجاد: "سَجَّاد",
  مهند: "مُهَنَّد",
  مهدي: "مَهدِي",
  رافد: "رَافِد",
  نبيل: "نَبِيل",
  جمال: "جَمَال",
  اياد: "إِيَاد",
  وسام: "وَسَام",
  حامد: "حَامِد",
  حمزه: "حَمْزَة",
  عثمان: "عُثْمَان",
  بلال: "بِلَال",
  سامر: "سَامِر",
  سامي: "سَامِي",
  نزار: "نِزَار",
  قاسم: "قَاسِم",
  كمال: "كَمَال",
  ناجح: "نَاجِح",
  ناجي: "نَاجِي",
  فاطمه: "فَاطِمَة",
  فاطمة: "فَاطِمَة",
  زينب: "زَيْنَب",
  ساره: "سَارَة",
  سارة: "سَارَة",
  مريم: "مَرْيَم",
  هبه: "هِبَة",
  هبة: "هِبَة",
  رغد: "رَغَد",
  امنه: "آمِنَة",
  دعاء: "دُعَاء",
  اسراء: "إِسْرَاء",
  شيماء: "شَيْمَاء",
  رقيه: "رُقَيّ",
  رقية: "رُقَيّ",
  سحر: "سَحَر",
  رنا: "رَنَا",
  ليلى: "لَيْلَى",
  منى: "مُنَى",
  سميه: "سَمِيَّة",
  سمية: "سَمِيَّة",
  عائشه: "عَائِشَة",
  عائشة: "عَائِشَة",
  خديجه: "خَدِيجَة",
  خديجة: "خَدِيجَة",
  بتول: "بَتُول",
  سها: "سُهَى",
  تبارك: "تَبَارَك",
  براء: "بَراء",
  اثير: "أَثِير",
  اريج: "أَرِيج",
  سرمد: "سَرْمَد",
  ستار: "سِتَّار",
  صباح: "صَبَاح",
  صفاء: "صَفاء",
  طه: "طٰه",
  ياسين: "يَاسِين",
  عادل: "عَادِل",
  رياض: "رِيَاض",
  ضرغام: "ضِرْغَام",
  حذيفه: "حُذَيْفَة",
  حذيفة: "حُذَيْفَة",
  زهراء: "زَهْراء",
  علياء: "عَلِياء",
  دكتور: "دُكْتُور",
  دكتوره: "دُكْتُور",
  دكتورة: "دُكْتُورَة",
};

function preserveOriginalScript(word: string): string {
  const w = word.replace(TATWEEL, "").trim();
  if (/^[\u0623\u0625\u0671]/.test(w)) return w;
  if (w.startsWith("ا") && w.length >= 2) {
    const second = w.charAt(1);
    if ("حخعغ".includes(second)) return `أ${w.slice(1)}`;
    if (second === "ي") return `إ${w.slice(1)}`;
  }
  return w;
}

function vocalizeCompound(key: string, original: string): string | null {
  if (key.startsWith("عبدال") && key.length > 5) {
    const suffix = key.slice(4);
    const suffixV = VOCALIZED_NAMES[suffix] ?? preserveOriginalScript(original.slice(4));
    return `عَبْدُ ${suffixV.startsWith("ا") ? suffixV : `ال${suffixV}`}`;
  }
  if (key.startsWith("عبد") && key.length > 3) {
    const rest = key.slice(3);
    const restV = VOCALIZED_NAMES[rest] ?? preserveOriginalScript(original.slice(3));
    return `عَبْد ${restV}`;
  }
  if (key.startsWith("ابو") && key.length > 3) {
    const restV = VOCALIZED_NAMES[key.slice(3)] ?? preserveOriginalScript(original.slice(3));
    return `أَبو ${restV}`;
  }
  if (key.startsWith("ام") && key.length > 2) {
    const restV = VOCALIZED_NAMES[key.slice(2)] ?? preserveOriginalScript(original.slice(2));
    return `أُمّ ${restV}`;
  }
  return null;
}

function lookupSingle(key: string, original: string): string {
  if (VOCALIZED_NAMES[key]) return VOCALIZED_NAMES[key];
  const compound = vocalizeCompound(key, original);
  if (compound) return compound;
  if (key.startsWith("اح") && key.endsWith("مد")) return "أَحْمَد";
  return preserveOriginalScript(original);
}

export function vocalizeArabicWord(word: string): string {
  const original = word.trim();
  if (!original) return "";
  if (HARAKAT.test(original)) return original.replace(TATWEEL, "");
  const key = nameLookupKey(original);
  if (!key) return original;
  return lookupSingle(key, original);
}

export function vocalizeArabicName(name: string): string {
  const trimmed = String(name ?? "").trim();
  if (!trimmed) return "";
  if (HARAKAT.test(trimmed)) {
    return trimmed.replace(TATWEEL, "").replace(/\s+/g, " ").trim();
  }
  return trimmed
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => vocalizeArabicWord(word))
    .join(" ");
}

export function suggestSpeechName(fullNameAr: string): string {
  return vocalizeArabicName(fullNameAr);
}

export function hasArabicDiacritics(text: string): boolean {
  return HARAKAT.test(text);
}
