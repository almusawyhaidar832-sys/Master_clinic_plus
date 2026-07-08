import { authPortalHeaders } from "@/lib/auth/api-portal";
import type { AuthPortalId } from "@/lib/auth/portal-access";
import type { ProfitDeductionLedger } from "@/lib/services/profit-deduction-ledger";

export async function fetchProfitDeductionLedgerViaApi(
  from: string,
  to: string,
  portal: AuthPortalId = "accountant"
): Promise<ProfitDeductionLedger> {
  const res = await fetch(
    `/api/clinic/profit-ledger?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
    {
      credentials: "include",
      headers: authPortalHeaders(portal),
    }
  );
  const json = (await res.json().catch(() => ({}))) as ProfitDeductionLedger & {
    error?: string;
  };
  if (!res.ok) {
    throw new Error(json.error ?? "تعذر تحميل تفصيل الربح");
  }
  return json;
}
