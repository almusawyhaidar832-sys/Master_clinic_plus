"use client";

import { useCallback, useEffect, useState } from "react";
import { Send, RefreshCw, Scan } from "lucide-react";
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
import { useLanguage } from "@/contexts/LanguageContext";
import { SessionPrescriptionPanel } from "@/components/prescriptions/SessionPrescriptionPanel";

interface VisitSessionClinicalPanelProps {
  patientId: string | null;
  queueEntryId?: string | null;
  portal?: AuthPortalId;
  /** زر إرسال للمحاسبة — للطبيب فقط */
  showSendToAccounting?: boolean;
  /** حالة الطابور من القائمة — احتياط إذا لم تُرجَع من API الجلسة */
  queueStatusOverride?: string | null;
  defaultOpen?: boolean;
  className?: string;
  /** إخفاء العنوان العلوي — عند وجود عنوان في الصفحة الأم (غرفة الانتظار) */
  hideHeader?: boolean;
  /** إدخال جلسة المحاسب — عرض مضغوط قابل للطي (لا يملأ الصفحة) */
  entryReviewMode?: boolean;
}

export function VisitSessionClinicalPanel({
  patientId,
  queueEntryId,
  portal = "doctor",
  showSendToAccounting = false,
  defaultOpen = true,
  className,
  hideHeader = false,
  queueStatusOverride,
  entryReviewMode = false,
}: VisitSessionClinicalPanelProps) {
  const { t, bi } = useLanguage();
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
  const [accountingNotes, setAccountingNotes] = useState("");

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
            setInfo(t("docVisualRecordReadyOptional"));
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
        setInfo(t("docVisualRecordOpenFromQueue"));
      } else if (!created.queueEntryId) {
        setInfo(t("docVisualRecordReadyLinkQueue"));
      }
    } catch (e) {
      setSession(null);
      setError(
        e instanceof Error ? e.message : t("docLoadExamSessionFailed")
      );
    } finally {
      setLoading(false);
    }
  }, [patientId, queueEntryId, portal, t]);

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
        body: JSON.stringify({
          action: "ready_for_billing",
          doctor_notes: accountingNotes.trim() || undefined,
        }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        error?: string;
      };
      if (!res.ok) {
        throw new Error(json.error ?? t("docSendToAccountingFailed"));
      }

      if (clinicId) {
        notifyQueueRefresh({ scope: "clinic", clinicId });
      }

      setSendMessage(t("docSessionSentToAccounting"));
      setAccountingNotes("");
      await loadSession();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : t("docSendToAccountingFailed")
      );
    } finally {
      setSending(false);
    }
  }

  if (!patientId && !queueEntryId) return null;

  const isAccountantView = portal === "accountant";
  const isExamPortal = portal === "doctor" || portal === "assistant";
  const effectiveQueueStatus =
    session?.queueStatus ?? queueStatusOverride ?? null;
  const canSend = Boolean(
    session?.queueEntryId &&
      (effectiveQueueStatus === "in_progress" ||
        effectiveQueueStatus === "called")
  );

  return (
    <div className={className}>
      {!hideHeader && isAccountantView ? (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-base font-bold text-slate-800">
              {t("docReviewVisualRecord")}
            </h3>
            <p className="text-xs text-slate-500">
              {bi(
                "راجع السجل — إذا نُسي المخطط أو الأشعة أو الوصفة يمكنك إضافتها أو تعديلها هنا",
                "Review the record — add or edit chart, X-rays, or prescription if the doctor forgot"
              )}
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
      ) : !hideHeader ? (
        <div className="mb-4 flex flex-wrap items-start justify-between gap-2 border-b border-slate-100 pb-3">
          <div>
            <h3
              className={
                isExamPortal
                  ? "flex items-center gap-2 text-lg font-bold text-primary"
                  : "text-base font-bold text-slate-800"
              }
            >
              {isExamPortal && <Scan className="h-5 w-5 shrink-0" />}
              {t("docVisualMedicalRecord")}
            </h3>
            <p className="mt-1 text-xs text-slate-500">
              {t("docVisualMedicalRecordHint")}
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
                {t("docSendToAccounting")}
              </Button>
            )}
          </div>
        </div>
      ) : null}

      {hideHeader && !isAccountantView && (
        <div className="mb-3 flex justify-end gap-2">
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
              {t("docSendToAccounting")}
            </Button>
          )}
        </div>
      )}

      {loading && (
        <p className="text-sm text-slate-500">{t("docPreparingExamSession")}</p>
      )}

      {error && <Alert variant="error">{error}</Alert>}
      {info && !error && !isAccountantView && <Alert variant="info">{info}</Alert>}
      {sendMessage && <Alert variant="success">{sendMessage}</Alert>}

      {isExamPortal && canSend && (
        <div className="mb-4 rounded-xl border border-violet-200 bg-violet-50/80 p-4">
          <label className="mb-1 block text-sm font-medium text-violet-900">
            {t("docAccountingNotes")}
          </label>
          <textarea
            value={accountingNotes}
            onChange={(e) => setAccountingNotes(e.target.value)}
            placeholder={t("docAccountingNotesPlaceholder")}
            rows={3}
            className="w-full resize-none rounded-xl border border-violet-200 bg-white px-4 py-2.5 text-sm text-slate-800 focus:border-violet-400 focus:outline-none"
          />
          <p className="mt-1 text-xs text-violet-700">{t("docAccountingNotesHint")}</p>
        </div>
      )}

      {session?.operationId && !loading && (
        <VisualMedicalRecord
          key={session.operationId}
          operationId={session.operationId}
          portal={portal}
          examMode={isExamPortal}
          collapsible={
            entryReviewMode || (!isExamPortal && !isAccountantView)
          }
          defaultOpen={
            entryReviewMode ? false : isAccountantView ? true : defaultOpen
          }
          compact={isAccountantView || entryReviewMode}
          readOnly={false}
          accountantSingleChart={entryReviewMode || isAccountantView}
        />
      )}

      {showPrescriptions &&
        session?.operationId &&
        session.patientId &&
        session.doctorId &&
        !loading && (
          <SessionPrescriptionPanel
            className={isExamPortal ? "mt-4" : "mt-4"}
            examMode={isExamPortal}
            operationId={session.operationId}
            patientId={session.patientId}
            doctorId={session.doctorId}
            queueEntryId={session.queueEntryId}
            queueStatus={effectiveQueueStatus}
            portal={portal}
            readOnly={entryReviewMode || isAccountantView}
            showSendToAccounting={isExamPortal && canSend}
            onSendToAccounting={() => void sendToAccounting()}
            sendingToAccounting={sending}
          />
        )}

      {!loading && !session?.operationId && !error && isAccountantView && (
        <p className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-3 py-4 text-sm text-slate-muted">
          {t("docNoVisualRecordYet")}
        </p>
      )}

      {session?.queueStatus === "ready_for_billing" && !isAccountantView && (
        <p className="mt-2 text-xs text-violet-700">
          {t("docSessionAtAccountant")}
        </p>
      )}
    </div>
  );
}
