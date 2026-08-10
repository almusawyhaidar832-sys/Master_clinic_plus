/**
 * يتحقق أن اسم المستخدم يتحوّل إلى بريد الدخول الصحيح — نفس المسار الذي
 * تستخدمه صفحة الدخول (مفتاح anon العام فقط، بدون صلاحيات إدارية).
 *
 *   node scripts/check-username-login-resolves.mjs ali123 mohamed123
 */
import { readFileSync } from "fs";
import { createClient } from "@supabase/supabase-js";

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

const anon = createClient(
  env.NEXT_PUBLIC_SUPABASE_URL,
  env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

for (const username of process.argv.slice(2)) {
  const { data, error } = await anon.rpc("get_email_for_username", {
    p_username: username,
  });
  console.log(`${username} → ${data ?? "لا يوجد"} ${error?.message ?? ""}`);
}
