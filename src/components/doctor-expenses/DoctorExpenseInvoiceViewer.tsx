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
          className="fixed inset-0 z-[60] flex items-end justify-center bg-black/50 p-4 sm:items-center"
          onClick={closeViewer}
        >
          <div
            className="flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
              <p className="truncate text-sm font-bold text-slate-800">
                {resolvedName ?? "مرفق الفاتورة"}
              </p>
              <button
                type="button"
                onClick={closeViewer}
                className="rounded-lg p-1 hover:bg-slate-100"
              >
                <X className="h-5 w-5 text-slate-500" />
              </button>
            </div>

            <div className="flex min-h-[16rem] flex-1 items-center justify-center bg-slate-50 p-4">
              {loading && (
                <RefreshCw className="h-8 w-8 animate-spin text-primary" />
              )}
              {!loading && error && (
                <p className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600">
                  {error}
                </p>
              )}
              {!loading && url && isPdfMime(mimeType, resolvedName) && (
                <iframe
                  src={url}
                  title={resolvedName ?? "فاتورة PDF"}
                  className="h-[70vh] w-full rounded-lg border border-slate-200 bg-white"
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
              <div className="border-t border-slate-200 px-4 py-3 text-center">
                <a
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm font-medium text-primary hover:underline"
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
