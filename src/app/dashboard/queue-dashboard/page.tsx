import { redirect } from "next/navigation";

/** إعادة توجيه — شاشة العمليات مدمجة في غرفة الانتظار */
export default function QueueDashboardRedirect() {
  redirect("/dashboard/queue");
}
