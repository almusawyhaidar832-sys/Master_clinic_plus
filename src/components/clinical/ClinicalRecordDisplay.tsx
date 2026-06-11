"use client";

import { InteractiveDentalChart } from "@/components/clinical/InteractiveDentalChart";
import {
  teethArrayToMap,
  type OperationClinicalData,
} from "@/lib/clinical/types";

interface ClinicalRecordDisplayProps {
  data: OperationClinicalData;
}

/** عرض محفوظ — أشعة + مخطط أسنان الجلسة (قراءة فقط) */
export function ClinicalRecordDisplay({ data }: ClinicalRecordDisplayProps) {
  const teethMap = teethArrayToMap(data.teeth ?? []);

  return (
    <div className="space-y-3">
      {data.xrays.length > 0 && (
        <div>
          <p className="mb-2 text-xs font-medium text-slate-text">صور الأشعة</p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {data.xrays.map((x) => {
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

      {data.teeth.length > 0 && (
        <InteractiveDentalChart
          mode="session"
          value={teethMap}
          readOnly
          embedded
        />
      )}
    </div>
  );
}
