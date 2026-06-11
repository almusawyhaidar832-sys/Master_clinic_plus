export const APPOINTMENT_STATUS_LABELS: Record<string, string> = {
  pending: "قيد المراجعة",
  scheduled: "مجدول",
  confirmed: "مؤكد",
  waiting: "في الانتظار",
  in_clinic: "داخل العيادة",
  in_examination: "داخل الكشف",
  ready_for_billing: "عند المحاسب",
  ready_for_payment: "جاهز للدفع",
  completed: "مكتمل",
  cancelled: "ملغي",
  no_show: "لم يحضر",
};

export const APPOINTMENT_STATUS_COLORS: Record<string, string> = {
  pending: "bg-amber-100 text-amber-800 ring-1 ring-amber-300",
  scheduled: "bg-slate-100 text-slate-700",
  confirmed: "bg-emerald-100 text-emerald-700",
  waiting: "bg-amber-50 text-amber-900 ring-1 ring-amber-400",
  in_clinic: "bg-teal-100 text-teal-800",
  in_examination: "bg-teal-100 text-teal-700",
  ready_for_billing: "bg-violet-50 text-violet-800 ring-1 ring-violet-200",
  ready_for_payment: "bg-violet-100 text-violet-800 ring-1 ring-violet-300",
  completed: "bg-blue-100 text-blue-700",
  cancelled: "bg-red-100 text-red-600",
  no_show: "bg-orange-100 text-orange-700",
};
