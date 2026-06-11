import { NextRequest, NextResponse } from "next/server";
import { getApiCallerProfile } from "@/lib/auth/api-session";
import { isApiDoctorRole, isApiStaffRole } from "@/lib/auth/api-portal";
import { getAdminClient } from "@/lib/supabase/admin";
import { searchPatientsForDoctor } from "@/lib/services/doctor-patients";
import { getDoctorByProfileId } from "@/lib/queue/server";
import {
  PATIENT_SEARCH_MIN_LENGTH,
  searchPatientsInClinic,
} from "@/lib/services/patient-search";

/** GET /api/patients/search?q=...&limit=20 — live patient autocomplete */
export async function GET(req: NextRequest) {
  try {
    const profile = await getApiCallerProfile(req);
    if (!profile?.clinic_id) {
      return NextResponse.json({ error: "غير مصرح — سجّل الدخول أولاً" }, { status: 401 });
    }

    const role = String(profile.role ?? "");
    if (!isApiStaffRole(role) && !isApiDoctorRole(role)) {
      return NextResponse.json(
        { error: "لا تملك صلاحية البحث عن المراجعين" },
        { status: 403 }
      );
    }

    const q = req.nextUrl.searchParams.get("q")?.trim() ?? "";
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

    if (isApiDoctorRole(role)) {
      const doctor = await getDoctorByProfileId(profile.id);
      if (!doctor || doctor.clinic_id !== profile.clinic_id) {
        return NextResponse.json(
          { error: "حساب الطبيب غير مربوط" },
          { status: 403 }
        );
      }
      const scoped = await searchPatientsForDoctor(
        admin,
        profile.clinic_id,
        doctor.id,
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
