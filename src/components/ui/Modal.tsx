"use client";

import { useEffect, type ReactNode } from "react";
import { X, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

interface ModalProps {
  open?: boolean;
  onClose: () => void;
  title: ReactNode;
  subtitle?: ReactNode;
  icon?: LucideIcon;
  children: ReactNode;
  footer?: ReactNode;
  size?: "sm" | "md" | "lg" | "xl";
  /** Set false for windows holding unsaved/critical input (e.g. payments). */
  closeOnBackdrop?: boolean;
  className?: string;
}

const SIZES = {
  sm: "sm:max-w-sm",
  md: "sm:max-w-md",
  lg: "sm:max-w-lg",
  xl: "sm:max-w-2xl",
} as const;

export function Modal({
  open = true,
  onClose,
  title,
  subtitle,
  icon: Icon,
  children,
  footer,
  size = "md",
  closeOnBackdrop = true,
  className,
}: ModalProps) {
  useEffect(() => {
    if (!open || !closeOnBackdrop) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose, closeOnBackdrop]);

  if (!open) return null;

  return (
    <div className="mc-modal-backdrop animate-fade-in" onClick={closeOnBackdrop ? onClose : undefined}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        className={cn("mc-modal", SIZES[size], className)}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mc-modal-head">
          {Icon && (
            <span className="mc-icon-tile h-10 w-10 rounded-xl" aria-hidden>
              <Icon className="h-5 w-5" />
            </span>
          )}
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-base font-bold text-slate-text">{title}</h2>
            {subtitle && <p className="truncate text-xs text-slate-muted">{subtitle}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-9 w-9 items-center justify-center rounded-xl text-slate-muted transition-colors hover:bg-surface hover:text-slate-text"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="px-5 py-5">{children}</div>
        {footer && (
          <div className="flex gap-3 border-t border-slate-border bg-surface px-5 py-4">{footer}</div>
        )}
      </div>
    </div>
  );
}
