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
  pending: "bg-warning text-warning-text ring-1 ring-inset ring-warning-border",
  scheduled: "bg-surface text-slate-muted ring-1 ring-inset ring-slate-border",
  confirmed: "bg-success text-success-text ring-1 ring-inset ring-success-border",
  waiting: "bg-premium-50 text-premium-700 ring-1 ring-inset ring-premium-200",
  in_clinic: "bg-primary-50 text-primary-700 ring-1 ring-inset ring-primary-200",
  in_examination: "bg-primary-50 text-primary-700 ring-1 ring-inset ring-primary-200",
  ready_for_billing: "bg-royal-50 text-royal-700 ring-1 ring-inset ring-royal-200",
  ready_for_payment: "bg-royal-50 text-royal-700 ring-1 ring-inset ring-royal-300",
  completed: "bg-primary-100 text-primary-800 ring-1 ring-inset ring-primary-200",
  cancelled: "bg-debt text-debt-text ring-1 ring-inset ring-debt-border",
  no_show: "bg-surface text-slate-muted ring-1 ring-inset ring-slate-border",
};
