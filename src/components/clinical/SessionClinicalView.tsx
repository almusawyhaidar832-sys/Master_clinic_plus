"use client";

import { Scan } from "lucide-react";
import { DentalChart } from "@/components/clinical/DentalChart";
import {
  hasClinicalData,
  teethArrayToMap,
  type OperationClinicalData,
} from "@/lib/clinical/types";

interface SessionClinicalViewProps {
  data?: OperationClinicalData | null;
  /** يظهر القسم حتى لو فارغ */
  alwaysShow?: boolean;
}

export function SessionClinicalView({
  data,
  alwaysShow = true,
}: SessionClinicalViewProps) {
  const hasData = hasClinicalData(data);
  if (!alwaysShow && !hasData) return null;

  const teethMap = teethArrayToMap(data?.teeth ?? []);

  return (
    <details
      className="mt-3 rounded-lg border border-teal-200/50 bg-teal-50/20"
      open={hasData}
    >
      <summary className="cursor-pointer list-none px-3 py-2.5 text-sm font-medium text-teal-900 [&::-webkit-details-marker]:hidden">
        <span className="inline-flex items-center gap-2">
          <Scan className="h-4 w-4" />
          السجل الطبي البصري
          {hasData && (
            <span className="text-xs font-normal text-teal-700/80">
              ({data!.teeth.length} سن
              {data!.xrays.length > 0 ? ` · ${data!.xrays.length} أشعة` : ""})
            </span>
          )}
        </span>
      </summary>

      <div className="space-y-3 border-t border-teal-200/40 px-3 pb-3 pt-2">
        {!hasData ? (
          <p className="text-xs text-slate-muted">
            لا يوجد مخطط أسنان أو صور أشعة مسجّلة لهذه الجلسة
          </p>
        ) : (
          <>
            {data!.xrays.length > 0 && (
              <div>
                <p className="mb-2 text-xs font-medium text-slate-text">
                  صور الأشعة
                </p>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {data!.xrays.map((x) => {
                    const isPdf =
                      x.mime_type === "application/pdf" ||
                      x.file_name?.toLowerCase().endsWith(".pdf");
                    return (
                      <a
                        key={x.id}
                        href={x.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="block overflow-hidden rounded-lg border border-slate-border bg-white"
                      >
                        {isPdf ? (
                          <div className="flex h-24 items-center justify-center text-xs text-slate-muted">
                            PDF — {x.file_name ?? "أشعة"}
                          </div>
                        ) : (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={x.url}
                            alt={x.file_name ?? "أشعة"}
                            className="h-24 w-full object-cover"
                          />
                        )}
                        {x.file_name && (
                          <p className="truncate px-2 py-1 text-[10px] text-slate-muted">
                            {x.file_name}
                          </p>
                        )}
                      </a>
                    );
                  })}
                </div>
              </div>
            )}

            {data!.teeth.length > 0 && (
              <DentalChart value={teethMap} readOnly />
            )}
          </>
        )}
      </div>
    </details>
  );
}
