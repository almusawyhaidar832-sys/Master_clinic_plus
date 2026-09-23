"use client";

import { useState } from "react";
import { FileImage, RefreshCw, X } from "lucide-react";
import { authPortalHeaders } from "@/lib/auth/api-portal";
import type { AuthPortalId } from "@/lib/auth/portal-access";

interface DoctorExpenseInvoiceViewerProps {
  expenseId: string;
  fileName?: string | null;
  portal?: AuthPortalId;
  className?: string;
}

function isPdfMime(mime: string | null | undefined, fileName?: string | null): boolean {
  if (mime?.includes("pdf")) return true;
  return (fileName ?? "").toLowerCase().endsWith(".pdf");
}

export function DoctorExpenseInvoiceViewer({
  expenseId,
  fileName,
  portal = "accountant",
  className,
}: DoctorExpenseInvoiceViewerProps) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [url, setUrl] = useState<string | null>(null);
  const [mimeType, setMimeType] = useState<string | null>(null);
  const [resolvedName, setResolvedName] = useState<string | null>(fileName ?? null);

  async function openViewer() {
    setOpen(true);
    setLoading(true);
    setError("");
    setUrl(null);

    try {
      const res = await fetch(`/api/doctor-expenses/${expenseId}/invoice-url`, {
        credentials: "include",
        headers: authPortalHeaders(portal),
      });
      const json = (await res.json()) as {
        url?: string;
        file_name?: string | null;
        mime_type?: string | null;
        error?: string;
      };

      if (!res.ok || !json.url) {
        setError(json.error ?? "تعذر فتح المرفق");
        return;
      }

      setUrl(json.url);
      setMimeType(json.mime_type ?? null);
      if (json.file_name) setResolvedName(json.file_name);
    } catch {
      setError("تعذر الاتصال بالسيرفر");
    } finally {
      setLoading(false);
    }
  }

  function closeViewer() {
    setOpen(false);
    setUrl(null);
    setError("");
  }

  const label = fileName?.trim() || "عرض الفاتورة";

  return (
    <>
      <button
        type="button"
        onClick={() => void openViewer()}
        className={
          className ??
          "inline-flex items-center gap-1.5 rounded-lg border border-primary/20 bg-primary/5 px-2.5 py-1 text-xs font-semibold text-primary hover:bg-primary/10"
        }
        title={label}
      >
        <FileImage className="h-3.5 w-3.5 shrink-0" />
        <span className="max-w-[8rem] truncate">{label}</span>
      </button>

      {open && (
        <div
          className="fixed inset-0 z-[60] flex items-end justify-center bg-primary-950/60 p-4 backdrop-blur-sm sm:items-center"
          onClick={closeViewer}
        >
          <div
            className="flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-3xl border border-slate-border bg-surface-card shadow-elevated"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mc-modal-head">
              <span className="mc-icon-tile h-10 w-10 rounded-xl" aria-hidden>
                <FileImage className="h-5 w-5" />
              </span>
              <p className="min-w-0 flex-1 truncate text-base font-bold text-slate-text">
                {resolvedName ?? "مرفق الفاتورة"}
              </p>
              <button
                type="button"
                onClick={closeViewer}
                className="inline-flex h-9 w-9 items-center justify-center rounded-xl text-slate-muted transition-colors hover:bg-surface hover:text-slate-text"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="flex min-h-[16rem] flex-1 items-center justify-center bg-surface p-4">
              {loading && (
                <RefreshCw className="h-8 w-8 animate-spin text-primary" />
              )}
              {!loading && error && (
                <p className="rounded-xl border border-debt-border bg-debt px-4 py-3 text-sm text-debt-text">
                  {error}
                </p>
              )}
              {!loading && url && isPdfMime(mimeType, resolvedName) && (
                <iframe
                  src={url}
                  title={resolvedName ?? "فاتورة PDF"}
                  className="h-[70vh] w-full rounded-lg border border-slate-border bg-surface-card"
                />
              )}
              {!loading && url && !isPdfMime(mimeType, resolvedName) && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={url}
                  alt={resolvedName ?? "صورة الفاتورة"}
                  className="max-h-[70vh] max-w-full rounded-lg object-contain shadow-sm"
                />
              )}
            </div>

            {url && (
              <div className="flex justify-center border-t border-slate-border bg-surface px-4 py-3">
                <a
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mc-btn-soft px-4 py-2 text-sm"
                >
                  فتح في نافذة جديدة
                </a>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
