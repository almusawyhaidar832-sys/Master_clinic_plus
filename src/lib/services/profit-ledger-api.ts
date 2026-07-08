import { authPortalHeaders } from "@/lib/auth/api-portal";
import type { AuthPortalId } from "@/lib/auth/portal-access";
import type { ProfitDeductionLedger } from "@/lib/services/profit-deduction-ledger";

export async function fetchProfitDeductionLedgerViaApi(
  from: string,
  to: string,
  portal: AuthPortalId = "accountant",
  clinicId?: string | null
): Promise<ProfitDeductionLedger> {
  const params = new URLSearchParams({ from, to });
  if (clinicId) {
    params.set("clinic_id", clinicId);
  }

  const res = await fetch(`/api/clinic/profit-ledger?${params.toString()}`, {
    credentials: "include",
    headers: authPortalHeaders(portal),
  });
  const json = (await res.json().catch(() => ({}))) as ProfitDeductionLedger & {
    error?: string;
  };
  if (!res.ok) {
    throw new Error(json.error ?? "تعذر تحميل تفصيل الربح");
  }
  return json;
}
