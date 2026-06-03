"use client";

import { useRef } from "react";
import { Upload, X, Scan } from "lucide-react";
import { DentalChart } from "@/components/clinical/DentalChart";
import type { SessionClinicalDraft } from "@/lib/clinical/constants";

export interface SessionClinicalRecordProps {
  value: SessionClinicalDraft;
  onChange: (draft: SessionClinicalDraft) => void;
  disabled?: boolean;
}

export function SessionClinicalRecord({
  value,
  onChange,
  disabled,
}: SessionClinicalRecordProps) {
  const fileRef = useRef<HTMLInputElement>(null);

  function addFiles(files: FileList | null) {
    if (!files?.length) return;
    const allowed = ["image/jpeg", "image/png", "image/webp", "application/pdf"];
    const next = [...value.xrayFiles];
    for (const f of Array.from(files)) {
      if (allowed.includes(f.type) || f.type.startsWith("image/")) {
        next.push(f);
      }
    }
    onChange({ ...value, xrayFiles: next });
  }

  function removeFile(index: number) {
    const next = value.xrayFiles.filter((_, i) => i !== index);
    onChange({ ...value, xrayFiles: next });
  }

  return (
    <div className="sm:col-span-2 space-y-4 rounded-xl border border-teal-200/60 bg-teal-50/30 p-4">
      <div className="flex items-center gap-2">
        <Scan className="h-5 w-5 text-teal-700" />
        <h3 className="text-base font-semibold text-slate-text">
          السجل الطبي البصري
        </h3>
      </div>
      <p className="text-xs text-slate-muted">
        خاص بهذه الجلسة فقط — كل زيارة لها أشعتها ومخططها (لا يظهر على جلسات أخرى)
      </p>

      <div>
        <p className="mb-2 text-sm font-medium text-slate-text">صور الأشعة (X-ray)</p>
        <input
          ref={fileRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,application/pdf"
          multiple
          className="hidden"
          disabled={disabled}
          onChange={(e) => {
            addFiles(e.target.files);
            e.target.value = "";
          }}
        />
        <button
          type="button"
          disabled={disabled}
          onClick={() => fileRef.current?.click()}
          className="flex w-full items-center justify-center gap-2 rounded-xl border-2 border-dashed border-teal-300 bg-white py-4 text-sm font-medium text-teal-800 transition-colors hover:bg-teal-50 disabled:opacity-50"
        >
          <Upload className="h-4 w-4" />
          رفع صور أشعة لهذه الجلسة
        </button>
        {value.xrayFiles.length > 0 && (
          <ul className="mt-2 space-y-1">
            {value.xrayFiles.map((f, i) => (
              <li
                key={`${f.name}-${i}`}
                className="flex items-center justify-between rounded-lg bg-white px-3 py-2 text-xs"
              >
                <span className="truncate text-slate-text">{f.name}</span>
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => removeFile(i)}
                  className="text-slate-muted hover:text-red-600"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <DentalChart
        value={value.teeth}
        onChange={(teeth) => onChange({ ...value, teeth })}
        disabled={disabled}
      />
    </div>
  );
}
