import { NextRequest, NextResponse } from "next/server";
import { getApiCallerProfile, isApiStaffRole } from "@/lib/auth/api-session";
import { getAdminClient } from "@/lib/supabase/admin";
import { patientBelongsToDoctor } from "@/lib/services/doctor-patients";
import {
  isToothStatus,
  normalizePatientToothState,
  procedureToStatus,
  type PatientToothState,
} from "@/lib/clinical/tooth-status";
import { ALL_FDI_TEETH } from "@/lib/clinical/constants";
import { getDoctorByProfileId } from "@/lib/queue/server";

const ALL_FDI = new Set(ALL_FDI_TEETH);

function isValidToothNumber(n: number): boolean {
  return Number.isInteger(n) && ALL_FDI.has(n);
}

async function assertPatientAccess(
  admin: ReturnType<typeof getAdminClient>,
  profile: { id: string; clinic_id: string; role?: string | null },
  patientId: string
): Promise<{ ok: true; clinicId: string } | { ok: false; status: number; error: string }> {
  const { data: patient } = await admin
    .from("patients")
    .select("id, clinic_id")
    .eq("id", patientId)
    .maybeSingle();

  if (!patient || patient.clinic_id !== profile.clinic_id) {
    return { ok: false, status: 404, error: "المراجع غير موجود" };
  }

  const role = String(profile.role ?? "").toLowerCase();
  if (role === "doctor") {
    const doctor = await getDoctorByProfileId(profile.id);
    if (!doctor) {
      return { ok: false, status: 403, error: "حساب الطبيب غير مربوط" };
    }
    const allowed = await patientBelongsToDoctor(admin, patientId, doctor.id);
    if (!allowed) {
      return { ok: false, status: 403, error: "غير مصرح لهذا المراجع" };
    }
  }

  return { ok: true, clinicId: patient.clinic_id as string };
}

/** GET ?patient_id= — المخطط التراكمي للمريض */
export async function GET(req: NextRequest) {
  try {
    const profile = await getApiCallerProfile(req);
    if (!profile?.clinic_id) {
      return NextResponse.json({ error: "غير مصرح" }, { status: 401 });
    }

    const role = String(profile.role ?? "").toLowerCase();
    if (!isApiStaffRole(role) && role !== "doctor") {
      return NextResponse.json({ error: "غير مصرح" }, { status: 403 });
    }

    const patientId = req.nextUrl.searchParams.get("patient_id")?.trim() ?? "";
    if (!patientId) {
      return NextResponse.json({ error: "patient_id مطلوب" }, { status: 400 });
    }

    const admin = getAdminClient();
    const access = await assertPatientAccess(admin, profile, patientId);
    if (!access.ok) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }

    const { data, error } = await admin
      .from("patient_tooth_states")
      .select(
        "tooth_number, status, procedure_ar, note, updated_at"
      )
      .eq("patient_id", patientId)
      .eq("clinic_id", access.clinicId)
      .order("tooth_number");

    if (error) {
      const missing =
        error.message.includes("patient_tooth_states") ||
        error.message.includes("schema cache");
      if (missing) {
        return NextResponse.json({ teeth: [], tablesMissing: true });
      }
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const teeth = (data ?? []).map((row) =>
      normalizePatientToothState({
        tooth_number: Number(row.tooth_number),
        status:
          typeof row.status === "string" && isToothStatus(row.status)
            ? row.status
            : "healthy",
        procedure_ar: row.procedure_ar as string | null,
        note: row.note as string | null,
        updated_at: row.updated_at as string | null,
      })
    );

    return NextResponse.json({ teeth });
  } catch (err) {
    console.error("[clinical/patient-tooth-chart GET]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "خطأ" },
      { status: 500 }
    );
  }
}

/** PUT — حفظ حالة سن أو أكثر (لا يمس operation_tooth_records) */
export async function PUT(req: NextRequest) {
  try {
    const profile = await getApiCallerProfile(req);
    if (!profile?.clinic_id) {
      return NextResponse.json({ error: "غير مصرح" }, { status: 401 });
    }

    const role = String(profile.role ?? "").toLowerCase();
    if (!isApiStaffRole(role) && role !== "doctor") {
      return NextResponse.json({ error: "غير مصرح" }, { status: 403 });
    }

    const body = (await req.json()) as {
      patient_id?: string;
      teeth?: Partial<PatientToothState>[];
    };

    const patientId = String(body.patient_id ?? "").trim();
    if (!patientId || !body.teeth?.length) {
      return NextResponse.json(
        { error: "patient_id و teeth مطلوبان" },
        { status: 400 }
      );
    }

    const admin = getAdminClient();
    const access = await assertPatientAccess(admin, profile, patientId);
    if (!access.ok) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }

    const now = new Date().toISOString();
    const upsertRows: Record<string, unknown>[] = [];
    const deleteTeeth: number[] = [];

    for (const raw of body.teeth) {
      const toothNum = Number(raw.tooth_number);
      if (!isValidToothNumber(toothNum)) continue;

      const status =
        raw.status && isToothStatus(raw.status)
          ? raw.status
          : raw.procedure_ar
            ? procedureToStatus(String(raw.procedure_ar))
            : "healthy";

      if (status === "healthy" && !raw.procedure_ar?.trim() && !raw.note?.trim()) {
        deleteTeeth.push(toothNum);
        continue;
      }

      upsertRows.push({
        clinic_id: access.clinicId,
        patient_id: patientId,
        tooth_number: toothNum,
        status,
        procedure_ar: raw.procedure_ar?.trim() || null,
        note: raw.note?.trim() || null,
        updated_by: profile.id,
        updated_at: now,
      });
    }

    if (deleteTeeth.length > 0) {
      const { error: delErr } = await admin
        .from("patient_tooth_states")
        .delete()
        .eq("patient_id", patientId)
        .eq("clinic_id", access.clinicId)
        .in("tooth_number", deleteTeeth);

      if (delErr) {
        const missing =
          delErr.message.includes("patient_tooth_states") ||
          delErr.message.includes("schema cache");
        return NextResponse.json(
          {
            error: missing
              ? "جدول مخطط الأسنان غير مُنشأ — شغّل سكربت 30-patient-tooth-states.sql"
              : delErr.message,
          },
          { status: 500 }
        );
      }
    }

    if (upsertRows.length > 0) {
      const { error } = await admin.from("patient_tooth_states").upsert(upsertRows, {
        onConflict: "patient_id,tooth_number",
      });

      if (error) {
        const missing =
          error.message.includes("patient_tooth_states") ||
          error.message.includes("schema cache");
        return NextResponse.json(
          {
            error: missing
              ? "جدول مخطط الأسنان غير مُنشأ — شغّل سكربت 30-patient-tooth-states.sql"
              : error.message,
          },
          { status: 500 }
        );
      }
    }

    const { data: refreshed } = await admin
      .from("patient_tooth_states")
      .select("tooth_number, status, procedure_ar, note, updated_at")
      .eq("patient_id", patientId)
      .eq("clinic_id", access.clinicId);

    const teeth = (refreshed ?? []).map((row) =>
      normalizePatientToothState({
        tooth_number: Number(row.tooth_number),
        status:
          typeof row.status === "string" && isToothStatus(row.status)
            ? row.status
            : "healthy",
        procedure_ar: row.procedure_ar as string | null,
        note: row.note as string | null,
        updated_at: row.updated_at as string | null,
      })
    );

    return NextResponse.json({ success: true, teeth });
  } catch (err) {
    console.error("[clinical/patient-tooth-chart PUT]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "خطأ" },
      { status: 500 }
    );
  }
}
