import { readFileSync } from "fs";
import { createClient } from "@supabase/supabase-js";

for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const i = line.indexOf("=");
  if (i > 0 && !line.trimStart().startsWith("#")) {
    let v = line.slice(i + 1).trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    process.env[line.slice(0, i).trim()] = v;
  }
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Missing Supabase env");
  process.exit(1);
}

const admin = createClient(url, key, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const fullSelect =
  "id, name, name_ar, phone, address, created_at, whatsapp_linked, whatsapp_session_id, is_active";
const baseSelect =
  "id, name, name_ar, phone, address, created_at, whatsapp_linked, whatsapp_session_id";

let { data, error } = await admin.from("clinics").select(fullSelect).limit(1);
console.log("clinics full select:", error?.message ?? "OK", data?.length ?? 0);

if (error) {
  ({ data, error } = await admin.from("clinics").select(baseSelect).limit(1));
  console.log("clinics base select:", error?.message ?? "OK");
}

const active = await admin
  .from("clinics")
  .select("id", { count: "exact", head: true })
  .eq("is_active", true);
console.log("is_active filter:", active.error?.message ?? `count=${active.count}`);

const patients = await admin
  .from("patients")
  .select("id", { count: "exact", head: true });
console.log("patients count:", patients.error?.message ?? patients.count);
