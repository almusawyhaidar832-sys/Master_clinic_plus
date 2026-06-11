-- نطق الاسم للنداء الصوتي (تشكيل)
ALTER TABLE public.patients
  ADD COLUMN IF NOT EXISTS speech_name_ar TEXT;

COMMENT ON COLUMN public.patients.speech_name_ar IS
  'تشكيل الاسم للنداء الصوتي — مثل أَحْمَد. إن وُجد يُستخدم بدل full_name_ar في TTS.';
