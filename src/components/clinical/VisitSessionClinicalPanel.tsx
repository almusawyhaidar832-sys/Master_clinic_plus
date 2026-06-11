"use client";

import { useCallback, useEffect, useState } from "react";
import { Send, RefreshCw } from "lucide-react";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { VisualMedicalRecord } from "@/components/clinical/VisualMedicalRecord";
import {
  ensureVisitSession,
  fetchVisitSessionByQueue,
  type VisitSessionPayload,
} from "@/lib/clinical/visit-session-client";
import { authPortalHeaders } from "@/lib/auth/api-portal";
import type { AuthPortalId } from "@/lib/auth/portal-access";
import { notifyQueueRefresh } from "@/lib/queue/queue-refresh";
import { useClinicProfile } from "@/contexts/ClinicProfileContext";
import { useClinicModules } from "@/contexts/ClinicModulesContext";
import { SessionPrescriptionPanel } from "@/components/prescriptions/SessionPrescriptionPanel";

interface VisitSessionClinicalPanelProps {
  patientId: string | null;
  queueEntryId?: string | null;
  portal?: AuthPortalId;
  /** زر إرسال للمحاسبة — للطبيب فقط */
  showSendToAccounting?: boolean;
  defaultOpen?: boolean;
  className?: string;
}

export function VisitSessionClinicalPanel({
  patientId,
  queueEntryId,
  portal = "doctor",
  showSendToAccounting = false,
  defaultOpen = true,
  className,
}: VisitSessionClinicalPanelProps) {
  const { profile } = useClinicProfile();
  const clinicId = profile?.id ?? null;
  const { hasModule } = useClinicModules();
  const showPrescriptions = hasModule("smart_prescriptions");

  const [session, setSession] = useState<VisitSessionPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [sendMessage, setSendMessage] = useState<string | null>(null);

  const loadSession = useCallback(async () => {
    if (!patientId && !queueEntryId) {
      setSession(null);
      setError(null);
      setInfo(null);
      return;
    }

    setLoading(true);
    setError(null);
    setSendMessage(null);
    setInfo(null);

    try {
      if (queueEntryId) {
        const existing = await fetchVisitSessionByQueue(queueEntryId, portal);
        if (existing) {
          setSession(existing);
          if (existing.withoutQueue) {
            setInfo("السجل البصري جاهز — الربط بالطابور اختياري لهذه الجلسة");
          }
          return;
        }
      }

      if (!patientId && !queueEntryId) {
        setSession(null);
        return;
      }

      const created = await ensureVisitSession(
        {
          patientId: patientId ?? null,
          queueEntryId: queueEntryId ?? null,
        },
        portal
      );
      setSession(created);

      if (created.withoutQueue) {
        setInfo(
          "تم فتح السجل البصري — لإرسال الجلسة للمحاسبة ابدأ الكشف من قائمة الانتظار أولاً"
        );
      } else if (!created.queueEntryId) {
        setInfo("السجل البصري جاهز — اربط الزيارة من الطابور لإرسالها للمحاسبة");
      }
    } catch (e) {
      setSession(null);
      setError(e instanceof Error ? e.message : "تعذر تحميل جلسة الكشف");
    } finally {
      setLoading(false);
    }
  }, [patientId, queueEntryId, portal]);

  useEffect(() => {
    void loadSession();
  }, [loadSession]);

  async function sendToAccounting() {
    if (!session?.queueEntryId) return;
    setSending(true);
    setSendMessage(null);
    setError(null);

    try {
      const res = await fetch(`/api/queue/${session.queueEntryId}`, {
        method: "PATCH",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          ...authPortalHeaders(portal),
        },
        body: JSON.stringify({ action: "ready_for_billing" }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        error?: string;
      };
      if (!res.ok) {
        throw new Error(json.error ?? "تعذر الإرسال للمحاسبة");
      }

      if (clinicId) {
        notifyQueueRefresh({ scope: "clinic", clinicId });
      }

      setSendMessage("✓ أُرسلت الجلسة للمحاسبة");
      await loadSession();
    } catch (e) {
      setError(e instanceof Error ? e.message : "تعذر الإرسال للمحاسبة");
    } finally {
      setSending(false);
    }
  }

  if (!patientId && !queueEntryId) return null;

  const isAccountantView = portal === "accountant";
  const canSend =
    showSendToAccounting &&
    session?.queueEntryId &&
    (session.queueStatus === "in_progress" || session.queueStatus === "called");

  return (
    <div className={className}>
      {isAccountantView ? (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-base font-bold text-slate-800">
              مراجعة السجل البصري
            </h3>
            <p className="text-xs text-slate-500">
              ما سجّله الطبيب أثناء الكشف — اضغط الزر أدناه للعرض بعد إدخال الجلسة
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void loadSession()}
            disabled={loading}
          >
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          </Button>
        </div>
      ) : (
        <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
          <div>
            <h3 className="text-base font-bold text-slate-800">السجل الطبي البصري</h3>
            <p className="text-xs text-slate-500">
              مخطط الأسنان وصور الأشعة — تُحفظ على جلسة اليوم وتظهر للمحاسب
            </p>
          </div>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void loadSession()}
              disabled={loading}
            >
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            </Button>
            {canSend && (
              <Button
                type="button"
                size="sm"
                onClick={() => void sendToAccounting()}
                disabled={sending}
              >
                {sending ? (
                  <RefreshCw className="h-4 w-4 animate-spin" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
                إرسال للمحاسبة
              </Button>
            )}
          </div>
        </div>
      )}

      {loading && (
        <p className="text-sm text-slate-muted">جاري تجهيز جلسة الكشف...</p>
      )}

      {error && <Alert variant="error">{error}</Alert>}
      {info && !error && !isAccountantView && <Alert variant="info">{info}</Alert>}
      {sendMessage && <Alert variant="success">{sendMessage}</Alert>}

      {session?.operationId && !loading && (
        <VisualMedicalRecord
          key={session.operationId}
          operationId={session.operationId}
          portal={portal}
          collapsible
          defaultOpen={isAccountantView ? false : defaultOpen}
          compact={isAccountantView}
          readOnly={isAccountantView}
        />
      )}

      {showPrescriptions &&
        session?.operationId &&
        session.patientId &&
        session.doctorId &&
        !loading && (
          <SessionPrescriptionPanel
            className="mt-4"
            operationId={session.operationId}
            patientId={session.patientId}
            doctorId={session.doctorId}
            queueEntryId={session.queueEntryId}
            portal={portal}
            readOnly={isAccountantView}
          />
        )}

      {!loading && !session?.operationId && !error && isAccountantView && (
        <p className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-3 py-4 text-sm text-slate-muted">
          لا يوجد سجل بصري من الطبيب لهذه الزيارة بعد — يمكنك إكمال إدخال الجلسة
          والدفع أعلاه.
        </p>
      )}

      {session?.queueStatus === "ready_for_billing" && !isAccountantView && (
        <p className="mt-2 text-xs text-violet-700">
          الجلسة عند المحاسب — يمكنه إكمال الفاتورة من الطابور.
        </p>
      )}
    </div>
  );
}
