-- Run 1 — سطر واحد فقط (لا تدمجه مع سكربتات أخرى)

ALTER TYPE public.appointment_status ADD VALUE IF NOT EXISTS 'in_examination';
