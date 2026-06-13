import { NextRequest, NextResponse } from "next/server";
import { getAdminClient } from "@/lib/supabase/admin";
import {
  buildDoctorNewPatientAnnouncement,
  formatNameForSpeech,
} from "@/lib/queue/arabic-speech-text";
import {
  verifyDoctorCallToken,
} from "@/lib/queue/doctor-call-audio-url";
import { synthesizeArabicSpeech } from "@/lib/queue/edge-tts-server";
import { resolvePatientSpeechName } from "@/lib/queue/utils";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const entryId = searchParams.get("entryId")?.trim();
    const exp = Number(searchParams.get("exp"));
    const sig = searchParams.get("sig")?.trim() ?? "";

    if (!entryId || !sig || !verifyDoctorCallToken(entryId, exp, sig)) {
      return NextResponse.json({ error: "غير مصرح" }, { status: 401 });
    }

    const admin = getAdminClient();
    const { data: entry, error } = await admin
      .from("patient_queue")
      .select(
        "id, patient_name, ticket_number, patient:patients(full_name_ar, speech_name_ar)"
      )
      .eq("id", entryId)
      .maybeSingle();

    if (error || !entry) {
      return NextResponse.json({ error: "غير موجود" }, { status: 404 });
    }

    const patientRow = entry.patient as {
      full_name_ar?: string;
      speech_name_ar?: string | null;
    } | null;

    const speechName = resolvePatientSpeechName({
      patient: patientRow
        ? {
            full_name_ar: patientRow.full_name_ar ?? "",
            speech_name_ar: patientRow.speech_name_ar,
          }
        : null,
      patient_name: entry.patient_name,
      ticket_number: entry.ticket_number,
    });

    const plain = buildDoctorNewPatientAnnouncement(
      formatNameForSpeech(speechName) || speechName
    );
    const audio = await synthesizeArabicSpeech(plain);

    return new NextResponse(new Uint8Array(audio), {
      headers: {
        "Content-Type": "audio/mpeg",
        "Cache-Control": "public, max-age=7200",
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "تعذر توليد الصوت";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
