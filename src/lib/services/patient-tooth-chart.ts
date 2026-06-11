import { authPortalHeaders } from "@/lib/auth/api-portal";
import type { AuthPortalId } from "@/lib/auth/portal-access";
import type { PatientToothState } from "@/lib/clinical/tooth-status";

export async function fetchPatientToothChart(
  patientId: string,
  portal: AuthPortalId = "doctor"
): Promise<{
  teeth: PatientToothState[];
  tablesMissing?: boolean;
  error?: string;
}> {
  try {
    const res = await fetch(
      `/api/clinical/patient-tooth-chart?patient_id=${encodeURIComponent(patientId)}`,
      {
        credentials: "include",
        headers: authPortalHeaders(portal),
      }
    );
    const data = (await res.json()) as {
      teeth?: PatientToothState[];
      tablesMissing?: boolean;
      error?: string;
    };

    if (!res.ok) {
      return {
        teeth: [],
        error: data.error ?? "تعذر تحميل مخطط الأسنان",
      };
    }

    return {
      teeth: data.teeth ?? [],
      tablesMissing: data.tablesMissing,
    };
  } catch {
    return { teeth: [], error: "تعذر الاتصال بالسيرفر" };
  }
}

export async function savePatientToothChart(
  input: {
    patient_id: string;
    teeth: PatientToothState[];
  },
  portal: AuthPortalId = "doctor"
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const res = await fetch("/api/clinical/patient-tooth-chart", {
      method: "PUT",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        ...authPortalHeaders(portal),
      },
      body: JSON.stringify(input),
    });
    const data = (await res.json()) as { error?: string };

    if (!res.ok) {
      return { ok: false, error: data.error ?? "تعذر حفظ مخطط الأسنان" };
    }

    return { ok: true };
  } catch {
    return { ok: false, error: "تعذر الاتصال بالسيرفر" };
  }
}
