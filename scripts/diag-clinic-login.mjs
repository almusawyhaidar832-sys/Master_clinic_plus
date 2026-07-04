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

const url = env.NEXT_PUBLIC_SUPABASE_URL;
const service = env.SUPABASE_SERVICE_ROLE_KEY;
const anon = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!url || !service || !anon) {
  console.error("missing supabase env");
  process.exit(1);
}

const admin = createClient(url, service, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const anonClient = createClient(url, anon, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const { data: clinics } = await admin
  .from("clinics")
  .select("id,name_ar,name,created_at")
  .order("created_at", { ascending: false })
  .limit(5);

console.log("Recent clinics:", clinics?.length ?? 0);

for (const clinic of clinics ?? []) {
  console.log("\nCLINIC", clinic.name_ar || clinic.name);
  const { data: profiles } = await admin
    .from("profiles")
    .select("id,username,role,is_active,full_name")
    .eq("clinic_id", clinic.id);

  for (const p of profiles ?? []) {
    const { data: au } = await admin.auth.admin.getUserById(p.id);
    const u = au?.user;
    const email = u?.email;
    const confirmed = !!u?.email_confirmed_at;
    console.log(
      " user",
      p.username,
      p.role,
      "active",
      p.is_active,
      "email",
      email,
      "confirmed",
      confirmed
    );
    if (p.username && email) {
      const { data: rpc, error: rpcErr } = await anonClient.rpc(
        "get_email_for_username",
        { p_username: p.username }
      );
      console.log("  rpc->", rpc, rpcErr?.message || "");
      const derived = `${String(p.username).toLowerCase().replace(/\s/g, "").replace(/[^a-z0-9._-]/g, "")}@masterclinic.local`;
      console.log("  derived", derived);
    }
  }
}

let orphanCount = 0;
const { data: authList } = await admin.auth.admin.listUsers({
  page: 1,
  perPage: 500,
});
for (const u of authList?.users ?? []) {
  if (!u.email?.includes("@masterclinic.local")) continue;
  const { data } = await admin
    .from("profiles")
    .select("id")
    .eq("id", u.id)
    .maybeSingle();
  if (!data) {
    orphanCount++;
    console.log("ORPHAN AUTH", u.email, u.id.slice(0, 8));
  }
}
console.log("\nOrphan local auth users:", orphanCount);
