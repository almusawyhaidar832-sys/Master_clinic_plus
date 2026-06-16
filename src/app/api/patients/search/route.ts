import { NextRequest, NextResponse } from "next/server";
import { getApiCallerProfile } from "@/lib/auth/api-session";
import {
  isApiAssistantRole,
  isApiDoctorRole,
  isApiStaffRole,
} from "@/lib/auth/api-portal";
import { getAdminClient } from "@/lib/supabase/admin";
import { resolveAssistantContext } from "@/lib/services/assistant-appointments-server";
import { searchPatientsForDoctor } from "@/lib/services/doctor-patients";
import { getDoctorByProfileId } from "@/lib/queue/server";
import {
  PATIENT_SEARCH_MIN_LENGTH,
  searchPatientsInClinic,
} from "@/lib/services/patient-search";

async function doctorBelongsToClinic(
  admin: ReturnType<typeof getAdminClient>,
  doctorId: string,
  clinicId: string
): Promise<boolean> {
  const { data } = await admin
    .from("doctors")
    .select("id")
    .eq("id", doctorId)
    .eq("clinic_id", clinicId)
    .maybeSingle();
  return Boolean(data?.id);
}

/** GET /api/patients/search?q=...&limit=20 — live patient autocomplete */
export async function GET(req: NextRequest) {
  try {
    const profile = await getApiCallerProfile(req);
    if (!profile?.clinic_id) {
      return NextResponse.json({ error: "غير مصرح — سجّل الدخول أولاً" }, { status: 401 });
    }

    const role = String(profile.role ?? "");
    if (
      !isApiStaffRole(role) &&
      !isApiDoctorRole(role) &&
      !isApiAssistantRole(role)
    ) {
      return NextResponse.json(
        { error: "لا تملك صلاحية البحث عن المراجعين" },
        { status: 403 }
      );
    }

    const q = req.nextUrl.searchParams.get("q")?.trim() ?? "";
    const scope = req.nextUrl.searchParams.get("scope");
    const doctorIdParam =
      req.nextUrl.searchParams.get("doctor_id")?.trim() || null;
    const limit = Math.min(
      Math.max(Number(req.nextUrl.searchParams.get("limit") ?? 20), 1),
      50
    );

    if (q.length < PATIENT_SEARCH_MIN_LENGTH) {
      return NextResponse.json({ patients: [] });
    }

    const admin = getAdminClient();
    let patients: Awaited<
      ReturnType<typeof searchPatientsInClinic>
    >["patients"] = [];
    let error: string | undefined;

    let searchDoctorId: string | null = null;

    if (isApiDoctorRole(role)) {
      const doctor = await getDoctorByProfileId(profile.id);
      if (!doctor || doctor.clinic_id !== profile.clinic_id) {
        return NextResponse.json(
          { error: "حساب الطبيب غير مربوط" },
          { status: 403 }
        );
      }
      searchDoctorId = doctor.id;
    } else if (scope === "clinic") {
      searchDoctorId = null;
    } else if (doctorIdParam) {
      if (!(await doctorBelongsToClinic(admin, doctorIdParam, profile.clinic_id))) {
        return NextResponse.json({ error: "الطبيب غير موجود" }, { status: 400 });
      }
      if (isApiAssistantRole(role)) {
        const ctx = await resolveAssistantContext(admin, profile.id);
        if (!ctx || ctx.doctorId !== doctorIdParam) {
          return NextResponse.json({ error: "غير مصرح" }, { status: 403 });
        }
      }
      searchDoctorId = doctorIdParam;
    } else if (isApiAssistantRole(role)) {
      const ctx = await resolveAssistantContext(admin, profile.id);
      if (!ctx) {
        return NextResponse.json(
          { error: "حساب المساعد غير مربوط" },
          { status: 400 }
        );
      }
      searchDoctorId = ctx.doctorId;
    }

    if (searchDoctorId) {
      const scoped = await searchPatientsForDoctor(
        admin,
        profile.clinic_id,
        searchDoctorId,
        q,
        { limit, minLength: PATIENT_SEARCH_MIN_LENGTH }
      );
      patients = scoped.patients;
      error = scoped.error;
    } else {
      const clinicWide = await searchPatientsInClinic(
        admin,
        profile.clinic_id,
        q,
        { limit, minLength: PATIENT_SEARCH_MIN_LENGTH }
      );
      patients = clinicWide.patients;
      error = clinicWide.error;
    }

    if (error) {
      return NextResponse.json({ error }, { status: 400 });
    }

    return NextResponse.json({ patients });
  } catch (err) {
    console.error("[api/patients/search]", err);
    return NextResponse.json(
      { error: "تعذر البحث عن المراجعين" },
      { status: 500 }
    );
  }
}
