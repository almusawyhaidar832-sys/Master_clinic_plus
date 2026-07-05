export interface WhatsAppDeliveryResult {
  sent: boolean;
  skipped?: boolean;
  error?: string;
  messageBody?: string;
  deliveryWarning?: string;
  providerMessageStatus?: string;
}

/** رسائل عربية لحالات فشل إرسال واتساب — للمحاسب والمساعد */

export function describeWhatsAppDeliveryError(
  error?: string | null
): string {
  switch (error) {
    case "no_patient_phone":
      return "لم يُدخل رقم جوال المراجع.";
    case "whatsapp_not_configured":
      return "واتساب غير مُعدّ — أضف WHATSAPP_API_URL و WHATSAPP_API_KEY في إعدادات الخادم.";
    case "whatsapp_not_linked":
      return "واتساب غير مربوط — افتح «إعدادات واتساب» وامسح رمز QR من الهاتف.";
    case "invalid_phone_after_normalize":
      return "رقم الجوال غير صالح — استخدم 078 أو 077 (مثال: 07801234567).";
    case "number_not_on_whatsapp":
      return "هذا الرقم غير مسجّل على واتساب — تحقق من الرقم.";
    case "evolution_pending_delivery":
      return "Evolution قبل الطلب لكن الرسالة لم تصل للجوال — سيرفر Railway يحتاج تحديث (تواصل مع مطوّر النظام).";
    case "evolution_server_ack_only":
      return "واتسapp قبل الرسالة على السيرفر لكن لم تُسلّم للجوال بعد — قد تصل خلال دقيقة أو السيرفر يحتاج تحديث.";
    case "evolution_delivery_error":
      return "Evolution أبلغ عن خطأ في التسليم — أعد «إصلاح واتساب» أو حدّث سيرفر Railway.";
    case "whatsapp_lid_jid":
      return "واتساب يستخدم LID لهذا الرقم — على Railway: WPP_LID_MODE=false وحدّث صورة Evolution إلى 2.4.0-rc2 ثم أعد QR.";
    case "text_send_failed":
      return "تعذر إرسال رسالة التفاصيل — تحقق من ربط واتساب العيادة.";
    case "invoice_pdf_failed":
      return "تعذر إرسال PDF الفاتورة — حاول مرة أخرى أو أرسل النص فقط.";
    case "prescription_pdf_failed":
      return "تعذر إرسال PDF الوصفة — تحقق من حجم الملف وربط واتساب.";
    case "pdf_requires_evolution":
      return "إرسال PDF يتطلب Evolution API — راجع إعدادات WHATSAPP.";
    default:
      if (error?.includes("not connected") || error?.includes("disconnected")) {
        return "جلسة واتساب غير متصلة — أعد الربط من إعدادات واتساب.";
      }
      if (error?.includes("instance") && error?.includes("not")) {
        return "جلسة واتساب العيادة غير موجودة — راجع إعدادات واتساب.";
      }
      return error?.trim()
        ? `تعذر إرسال واتساب: ${error}`
        : "تعذر إرسال رسالة واتساب للمراجع.";
  }
}

/** تجميع أخطاء حزمة المحاسب (نص + PDF) */
export function describeWhatsAppPackageErrors(errors: string[]): string {
  if (errors.length === 0) return describeWhatsAppDeliveryError(null);
  const parts = errors.map((e) => describeWhatsAppDeliveryError(e));
  return parts.join(" — ");
}
