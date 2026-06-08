"use client";

import { useCallback, useEffect, useState } from "react";
import {
  DEVELOPER_ASSIGNABLE_ROLES,
  developerRoleLabel,
  type DeveloperClinicUserRow,
} from "@/lib/services/developer-clinic-users";
import type { UserRole } from "@/types";
import { KeyRound, Plus, RefreshCw, UserCog } from "lucide-react";
import { Button } from "@/components/ui/Button";

type Props = {
  clinicId: string;
  onMessage: (msg: { ok: boolean; text: string }) => void;
};

export function ClinicStaffPanel({ clinicId, onMessage }: Props) {
  const [users, setUsers] = useState<DeveloperClinicUserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [resetId, setResetId] = useState<string | null>(null);
  const [newPassword, setNewPassword] = useState("");

  const [addName, setAddName] = useState("");
  const [addUsername, setAddUsername] = useState("");
  const [addPassword, setAddPassword] = useState("");
  const [addRole, setAddRole] = useState<UserRole>("accountant");

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch(`/api/developer/clinics/${clinicId}/users`);
    const data = await res.json();
    if (!res.ok) {
      onMessage({ ok: false, text: data.error ?? "تعذر تحميل المستخدمين" });
      setUsers([]);
    } else {
      setUsers(data.users ?? []);
    }
    setLoading(false);
  }, [clinicId, onMessage]);

  useEffect(() => {
    void load();
  }, [load]);

  async function patchUser(
    userId: string,
    body: Record<string, unknown>,
    successText: string
  ) {
    setBusyId(userId);
    const res = await fetch(
      `/api/developer/clinics/${clinicId}/users/${userId}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }
    );
    const data = await res.json();
    setBusyId(null);
    if (!res.ok) {
      onMessage({ ok: false, text: data.error ?? "فشل التحديث" });
      return;
    }
    onMessage({ ok: true, text: successText });
    void load();
  }

  async function handleAddUser(e: React.FormEvent) {
    e.preventDefault();
    setBusyId("new");
    const res = await fetch(`/api/developer/clinics/${clinicId}/users`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        full_name: addName,
        username: addUsername,
        password: addPassword,
        role: addRole,
      }),
    });
    const data = await res.json();
    setBusyId(null);
    if (!res.ok) {
      onMessage({ ok: false, text: data.error ?? "فشل الإنشاء" });
      return;
    }
    onMessage({ ok: true, text: "تم إنشاء المستخدم" });
    setShowAdd(false);
    setAddName("");
    setAddUsername("");
    setAddPassword("");
    void load();
  }

  async function submitReset(userId: string) {
    if (newPassword.length < 6) {
      onMessage({ ok: false, text: "كلمة المرور 6 أحرف على الأقل" });
      return;
    }
    await patchUser(userId, { new_password: newPassword }, "تم تعيين كلمة مرور جديدة");
    setResetId(null);
    setNewPassword("");
  }

  return (
    <section className="mt-8 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 font-bold text-slate-100">
          <UserCog className="h-5 w-5 text-amber-400" />
          مستخدمو العيادة
        </h2>
        <div className="flex gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => void load()}
            className="border-slate-600 text-slate-300"
          >
            <RefreshCw className="h-4 w-4" />
            تحديث
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={() => setShowAdd((v) => !v)}
            className="bg-amber-600 hover:bg-amber-500"
          >
            <Plus className="h-4 w-4" />
            مستخدم جديد
          </Button>
        </div>
      </div>

      <p className="rounded-lg border border-amber-900/50 bg-amber-950/30 px-3 py-2 text-xs text-amber-200/90 leading-relaxed">
        كلمات المرور <strong>مشفّرة</strong> — ما تقدر تشوفها. استخدم «تعيين رمز
        جديد» لإعادة التعيين. تسجيل الدخول يكون بـ <strong>اسم المستخدم</strong>{" "}
        مو البريد الداخلي.
      </p>

      {showAdd && (
        <form
          onSubmit={handleAddUser}
          className="grid gap-3 rounded-xl border border-slate-700 bg-slate-900/60 p-4 sm:grid-cols-2"
        >
          <input
            className="rounded-lg border border-slate-600 bg-slate-800 px-3 py-2 text-sm text-white"
            placeholder="الاسم الكامل"
            value={addName}
            onChange={(e) => setAddName(e.target.value)}
            required
          />
          <input
            className="rounded-lg border border-slate-600 bg-slate-800 px-3 py-2 text-sm text-white"
            placeholder="اسم المستخدم (إنجليزي)"
            dir="ltr"
            value={addUsername}
            onChange={(e) => setAddUsername(e.target.value)}
            required
            pattern="[a-zA-Z0-9._-]{3,32}"
          />
          <input
            type="password"
            className="rounded-lg border border-slate-600 bg-slate-800 px-3 py-2 text-sm text-white"
            placeholder="كلمة المرور (6+)"
            value={addPassword}
            onChange={(e) => setAddPassword(e.target.value)}
            required
            minLength={6}
          />
          <select
            className="rounded-lg border border-slate-600 bg-slate-800 px-3 py-2 text-sm text-white"
            value={addRole}
            onChange={(e) => setAddRole(e.target.value as UserRole)}
          >
            {DEVELOPER_ASSIGNABLE_ROLES.map((r) => (
              <option key={r} value={r}>
                {developerRoleLabel(r)}
              </option>
            ))}
          </select>
          <Button
            type="submit"
            disabled={busyId === "new"}
            className="sm:col-span-2 bg-emerald-600 hover:bg-emerald-500"
          >
            {busyId === "new" ? "جاري الإنشاء..." : "إنشاء الحساب"}
          </Button>
        </form>
      )}

      {loading ? (
        <p className="text-sm text-slate-500">جاري التحميل...</p>
      ) : users.length === 0 ? (
        <p className="text-sm text-slate-500">لا يوجد مستخدمون لهذه العيادة.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-700">
          <table className="w-full min-w-[640px] text-sm text-right">
            <thead>
              <tr className="border-b border-slate-700 bg-slate-800/80 text-slate-400">
                <th className="px-3 py-2 font-medium">الاسم</th>
                <th className="px-3 py-2 font-medium">اسم الدخول</th>
                <th className="px-3 py-2 font-medium">الصلاحية</th>
                <th className="px-3 py-2 font-medium">الحالة</th>
                <th className="px-3 py-2 font-medium">إجراءات</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr
                  key={u.id}
                  className="border-b border-slate-800/80 text-slate-200"
                >
                  <td className="px-3 py-3">
                    <p className="font-medium">{u.full_name ?? "—"}</p>
                    {u.last_sign_in_at && (
                      <p className="text-xs text-slate-500">
                        آخر دخول:{" "}
                        {new Date(u.last_sign_in_at).toLocaleString("ar-IQ")}
                      </p>
                    )}
                  </td>
                  <td className="px-3 py-3" dir="ltr">
                    <p className="font-mono text-xs">{u.username ?? "—"}</p>
                    <p className="text-[10px] text-slate-600 truncate max-w-[180px]">
                      {u.login_email}
                    </p>
                  </td>
                  <td className="px-3 py-3">
                    <select
                      className="rounded border border-slate-600 bg-slate-800 px-2 py-1 text-xs"
                      value={u.role}
                      disabled={busyId === u.id}
                      onChange={(e) =>
                        void patchUser(
                          u.id,
                          { role: e.target.value },
                          "تم تحديث الصلاحية"
                        )
                      }
                    >
                      {DEVELOPER_ASSIGNABLE_ROLES.map((r) => (
                        <option key={r} value={r}>
                          {developerRoleLabel(r)}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-3 py-3">
                    <button
                      type="button"
                      disabled={busyId === u.id}
                      onClick={() =>
                        void patchUser(
                          u.id,
                          { is_active: !u.is_active },
                          u.is_active ? "تم التعطيل" : "تم التفعيل"
                        )
                      }
                      className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                        u.is_active
                          ? "bg-emerald-950/60 text-emerald-400"
                          : "bg-slate-700 text-slate-400"
                      }`}
                    >
                      {u.is_active ? "نشط" : "معطّل"}
                    </button>
                  </td>
                  <td className="px-3 py-3">
                    {resetId === u.id ? (
                      <div className="flex flex-wrap items-center gap-2">
                        <input
                          type="password"
                          className="w-28 rounded border border-slate-600 bg-slate-800 px-2 py-1 text-xs"
                          placeholder="رمز جديد"
                          value={newPassword}
                          onChange={(e) => setNewPassword(e.target.value)}
                          minLength={6}
                        />
                        <button
                          type="button"
                          className="text-xs text-emerald-400"
                          onClick={() => void submitReset(u.id)}
                        >
                          حفظ
                        </button>
                        <button
                          type="button"
                          className="text-xs text-slate-500"
                          onClick={() => {
                            setResetId(null);
                            setNewPassword("");
                          }}
                        >
                          إلغاء
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        className="inline-flex items-center gap-1 text-xs text-amber-400 hover:text-amber-300"
                        onClick={() => {
                          setResetId(u.id);
                          setNewPassword("");
                        }}
                      >
                        <KeyRound className="h-3.5 w-3.5" />
                        تعيين رمز جديد
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
