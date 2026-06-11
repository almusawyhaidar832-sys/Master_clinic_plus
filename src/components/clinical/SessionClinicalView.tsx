"use client";

import { Scan } from "lucide-react";
import { ClinicalRecordDisplay } from "@/components/clinical/ClinicalRecordDisplay";
import {
  hasClinicalData,
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
          <ClinicalRecordDisplay data={data!} />
        )}
      </div>
    </details>
  );
}
