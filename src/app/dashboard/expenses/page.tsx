import { redirect } from "next/navigation";

/** دُمجت المصروفات في صرفيات عامة */
export default function ExpensesPage() {
  redirect("/dashboard/doctor-expenses?tab=general_expenses");
}
