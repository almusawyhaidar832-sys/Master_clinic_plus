-- =============================================================================
-- تشخيص: من هو الحساب الذي فشل تأكيد الصرف بسبب clinic_id فاضي؟
-- =============================================================================
-- شغّل هذا الاستعلام وانسخ الناتج كامل.
-- =============================================================================

-- كل حسابات المحاسبين/الأدمن المرتبطين (أو غير المرتبطين) بعيادة الحلو
SELECT p.id, p.role, p.clinic_id, p.full_name, c.name_ar AS clinic_name
FROM public.profiles p
LEFT JOIN public.clinics c ON c.id = p.clinic_id
WHERE p.role IN ('accountant', 'super_admin')
ORDER BY p.clinic_id IS NULL DESC, p.role;
