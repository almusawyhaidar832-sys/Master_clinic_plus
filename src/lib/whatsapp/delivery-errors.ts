export interface WhatsAppDeliveryResult {
  sent: boolean;
  skipped?: boolean;
  error?: string;
  messageBody?: string;
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
      return "رقم الجوال غير صالح — استخدم صيغة عراقية مثل 07XX XXX XXXX.";
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
