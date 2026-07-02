"use client";

import Link from "next/link";
import { Code2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface DeveloperFooterLinkProps {
  /** "dark" — for use over deep navy/gradient backgrounds (e.g. the login screen). */
  variant?: "light" | "dark";
}

/**
 * رابط «دخول المطور» — باهت لكن مرئي؛ أوضح عند التمرير.
 */
export function DeveloperFooterLink({ variant = "light" }: DeveloperFooterLinkProps) {
  if (process.env.NODE_ENV === "production") {
    return null;
  }

  return (
    <Link
      href="/admin-login"
      className={cn(
        "group inline-flex items-center gap-1 rounded-full border border-transparent px-2 py-1 text-[10px] transition-all focus:outline-none",
        variant === "dark"
          ? "text-white/35 hover:border-white/15 hover:bg-white/10 hover:text-white/80 focus:border-white/15 focus:bg-white/10 focus:text-white/80"
          : "text-slate-400/45 hover:border-slate-200 hover:bg-white/60 hover:text-slate-600 focus:border-slate-200 focus:bg-white/60 focus:text-slate-600"
      )}
      aria-label="دخول المطور — بوابة المدير العام"
      title="دخول المطور"
    >
      <Code2 className="h-3 w-3 opacity-50 group-hover:opacity-80" aria-hidden />
      <span>دخول المطور</span>
    </Link>
  );
}
