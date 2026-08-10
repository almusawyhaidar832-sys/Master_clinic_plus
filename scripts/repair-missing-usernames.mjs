/**
 * إصلاح الحسابات التي بلا username في profiles — لا تستطيع الدخول باسم مستخدم
 * لأن get_email_for_username يطابق على profiles.username فقط.
 *
 * افتراضياً معاينة فقط. للتطبيق الفعلي:
 *   node scripts/repair-missing-usernames.mjs --apply
 */
import { readFileSync } from "fs";
import { createClient } from "@supabase/supabase-js";

const APPLY = process.argv.includes("--apply");

const env = {};
for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  if (!line || line.startsWith("#")) continue;
  const i = line.indexOf("=");
  if (i < 0) continue;
  env[line.slice(0, i).trim()] = line
    .slice(i + 1)
    .trim()
    .replace(/^["']|["']$/g, "");
}

const url = env.NEXT_PUBLIC_SUPABASE_URL;
const service = env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !service) {
  console.error("missing supabase env");
  process.exit(1);
}

const admin = createClient(url, service, {
  auth: { autoRefreshToken: false, persistSession: false },
});

function sanitize(raw) {
  return String(raw)
    .trim()
    .toLowerCase()
    .replace(/\s/g, "")
    .replace(/[^a-z0-9._-]/g, "");
}

const { data: profiles, error } = await admin
  .from("profiles")
  .select("id, full_name, role, username, clinic_id, is_active");

if (error) {
  console.error("profiles read failed:", error.message);
  process.exit(1);
}

const { data: clinics } = await admin.from("clinics").select("id, name_ar, name");
const clinicName = new Map(
  (clinics ?? []).map((c) => [c.id, c.name_ar || c.name])
);

const taken = new Set(
  profiles.filter((p) => p.username).map((p) => sanitize(p.username))
);

const missing = profiles.filter((p) => !p.username);
console.log(`Profiles without username: ${missing.length}`);

for (const profile of missing) {
  const { data: authUser } = await admin.auth.admin.getUserById(profile.id);
  const email = authUser?.user?.email ?? null;
  const label = `${profile.full_name ?? "—"} (${profile.role}) @ ${
    clinicName.get(profile.clinic_id) ?? "بلا عيادة"
  }`;

  if (!email) {
    console.log(`SKIP  ${label} — لا يوجد بريد في auth`);
    continue;
  }

  const candidate = sanitize(email.split("@")[0]);

  if (candidate.length < 3 || candidate.length > 32) {
    console.log(`SKIP  ${label} — الاسم المشتق غير صالح (${candidate})`);
    continue;
  }
  if (taken.has(candidate)) {
    console.log(`SKIP  ${label} — «${candidate}» محجوز لحساب آخر`);
    continue;
  }

  if (!APPLY) {
    console.log(`WOULD SET ${label} → ${candidate}  [${email}]`);
    taken.add(candidate);
    continue;
  }

  const { error: updErr } = await admin
    .from("profiles")
    .update({ username: candidate })
    .eq("id", profile.id);

  if (updErr) {
    console.log(`FAIL  ${label} → ${candidate}: ${updErr.message}`);
    continue;
  }

  taken.add(candidate);
  console.log(`SET   ${label} → ${candidate}  [${email}]`);
}

console.log(APPLY ? "\nتم التطبيق." : "\nمعاينة فقط — أضف --apply للتطبيق.");
