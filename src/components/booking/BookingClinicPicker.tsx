"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Building2, MapPin, Phone, Search } from "lucide-react";
import { Input } from "@/components/ui/Input";
import { Alert } from "@/components/ui/Alert";
import type { PublicClinicSummary } from "@/lib/booking/types";

export function BookingClinicPicker() {
  const router = useRouter();
  const [clinics, setClinics] = useState<PublicClinicSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch("/api/booking/clinics");
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "تعذر تحميل العيادات");
        if (!cancelled) setClinics(data.clinics ?? []);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "تعذر تحميل العيادات");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const filtered = clinics.filter((c) => {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    const hay = [c.nameAr, c.name, c.address, c.bookingCode]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return hay.includes(q);
  });

  function selectClinic(code: string) {
    router.push(`/booking?clinic=${encodeURIComponent(code)}`);
  }

  return (
    <div className="mx-auto w-full max-w-lg">
      <div className="mb-8 text-center">
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-teal-500/10 text-3xl">
          📅
        </div>
        <h1 className="text-2xl font-bold text-slate-text">بوابة الحجوزات</h1>
        <p className="mt-2 text-slate-muted">
          اختر عيادتك لحجز موعدك بسهولة وأمان
        </p>
      </div>

      <div className="relative mb-4">
        <Search className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-muted" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="ابحث باسم العيادة أو العنوان..."
          className="pr-10"
        />
      </div>

      {error && <Alert variant="error" className="mb-4">{error}</Alert>}

      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-24 animate-pulse rounded-xl bg-surface-card"
            />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-200 bg-surface-card p-8 text-center text-slate-muted">
          {clinics.length === 0
            ? "لا توجد عيادات متاحة للحجز عبر الإنترنت حالياً."
            : "لا توجد نتائج مطابقة لبحثك."}
        </div>
      ) : (
        <ul className="space-y-3">
          {filtered.map((clinic) => (
            <li key={clinic.id}>
              <button
                type="button"
                onClick={() => selectClinic(clinic.bookingCode)}
                className="flex w-full items-start gap-4 rounded-xl border border-slate-200/80 bg-surface-card p-4 text-right shadow-sm transition hover:border-teal-300 hover:shadow-md"
              >
                {clinic.logoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={clinic.logoUrl}
                    alt=""
                    className="h-12 w-12 shrink-0 rounded-lg object-cover"
                  />
                ) : (
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-teal-500/10 text-teal-600">
                    <Building2 className="h-6 w-6" />
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-slate-text">
                    {clinic.nameAr || clinic.name}
                  </p>
                  {clinic.address && (
                    <p className="mt-1 flex items-center gap-1 text-sm text-slate-muted">
                      <MapPin className="h-3.5 w-3.5 shrink-0" />
                      <span className="truncate">{clinic.address}</span>
                    </p>
                  )}
                  {clinic.phone && (
                    <p className="mt-0.5 flex items-center gap-1 text-sm text-slate-muted">
                      <Phone className="h-3.5 w-3.5 shrink-0" />
                      <span dir="ltr">{clinic.phone}</span>
                    </p>
                  )}
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
