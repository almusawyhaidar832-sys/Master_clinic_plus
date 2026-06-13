"use client";

import Link from "next/link";
import { Code2 } from "lucide-react";

/**
 * رابط «دخول المطور» — باهت لكن مرئي؛ أوضح عند التمرير.
 */
export function DeveloperFooterLink() {
  if (process.env.NODE_ENV === "production") {
    return null;
  }

  return (
    <Link
      href="/admin-login"
      className="group inline-flex items-center gap-1 rounded-full border border-transparent px-2 py-1 text-[10px] text-slate-400/45 transition-all hover:border-slate-200 hover:bg-white/60 hover:text-slate-600 focus:border-slate-200 focus:bg-white/60 focus:text-slate-600 focus:outline-none"
      aria-label="دخول المطور — بوابة المدير العام"
      title="دخول المطور"
    >
      <Code2 className="h-3 w-3 opacity-50 group-hover:opacity-80" aria-hidden />
      <span>دخول المطور</span>
    </Link>
  );
}
