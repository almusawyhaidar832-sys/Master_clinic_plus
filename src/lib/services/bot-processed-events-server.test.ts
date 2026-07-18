import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  getProcessedEvent,
  recordProcessedEvent,
  type ProcessedEventRow,
} from "@/lib/services/bot-processed-events-server";

/**
 * محاكاة صغيرة لعميل Supabase تغطي فقط سلاسل الاستدعاء التي يستخدمها
 * bot-processed-events-server.ts — تكفي لاختبار منطق التكرار (idempotency)
 * بدون الحاجة لقاعدة بيانات حقيقية.
 */
function createFakeAdmin(seed: ProcessedEventRow[] = []) {
  const rows: ProcessedEventRow[] = [...seed];
  let counter = rows.length;

  const admin = {
    from(table: string) {
      if (table !== "bot_processed_events") {
        throw new Error(`unexpected table in fake admin: ${table}`);
      }
      return {
        select() {
          let clinicId: string | undefined;
          let idempotencyKey: string | undefined;
          const builder = {
            eq(column: string, value: string) {
              if (column === "clinic_id") clinicId = value;
              if (column === "idempotency_key") idempotencyKey = value;
              return builder;
            },
            async maybeSingle() {
              const row =
                rows.find(
                  (r) => r.clinic_id === clinicId && r.idempotency_key === idempotencyKey
                ) ?? null;
              return { data: row, error: null };
            },
          };
          return builder;
        },
        insert(payload: { clinic_id: string; idempotency_key: string }) {
          return {
            select() {
              return {
                async maybeSingle() {
                  const exists = rows.some(
                    (r) =>
                      r.clinic_id === payload.clinic_id &&
                      r.idempotency_key === payload.idempotency_key
                  );
                  if (exists) {
                    return {
                      data: null,
                      error: {
                        code: "23505",
                        message: "duplicate key value violates unique constraint",
                      },
                    };
                  }
                  counter += 1;
                  const now = new Date().toISOString();
                  const newRow: ProcessedEventRow = {
                    id: `fake-id-${counter}`,
                    clinic_id: payload.clinic_id,
                    idempotency_key: payload.idempotency_key,
                    processed_at: now,
                    created_at: now,
                  };
                  rows.push(newRow);
                  return { data: newRow, error: null };
                },
              };
            },
          };
        },
      };
    },
  };

  return { admin: admin as unknown as SupabaseClient, rows };
}

describe("bot-processed-events-server", () => {
  it("getProcessedEvent returns null when the key does not exist yet", async () => {
    const { admin } = createFakeAdmin();
    const result = await getProcessedEvent(admin, "clinic-1", "evt_missing");
    expect(result).toBeNull();
  });

  it("recordProcessedEvent creates a new record on first call", async () => {
    const { admin } = createFakeAdmin();
    const { record, created } = await recordProcessedEvent(admin, "clinic-1", "evt_abc");

    expect(created).toBe(true);
    expect(record.clinic_id).toBe("clinic-1");
    expect(record.idempotency_key).toBe("evt_abc");

    const fetched = await getProcessedEvent(admin, "clinic-1", "evt_abc");
    expect(fetched?.idempotency_key).toBe("evt_abc");
  });

  it("recording the same idempotency_key twice does not duplicate", async () => {
    const { admin, rows } = createFakeAdmin();

    const first = await recordProcessedEvent(admin, "clinic-1", "evt_dup");
    const second = await recordProcessedEvent(admin, "clinic-1", "evt_dup");

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.record.id).toBe(first.record.id);

    const matches = rows.filter(
      (r) => r.clinic_id === "clinic-1" && r.idempotency_key === "evt_dup"
    );
    expect(matches).toHaveLength(1);
  });

  it("the same idempotency_key is isolated per clinic", async () => {
    const { admin } = createFakeAdmin();

    await recordProcessedEvent(admin, "clinic-1", "evt_shared");
    const otherClinic = await recordProcessedEvent(admin, "clinic-2", "evt_shared");

    expect(otherClinic.created).toBe(true);

    const clinic1Event = await getProcessedEvent(admin, "clinic-1", "evt_shared");
    const clinic2Event = await getProcessedEvent(admin, "clinic-2", "evt_shared");
    expect(clinic1Event?.clinic_id).toBe("clinic-1");
    expect(clinic2Event?.clinic_id).toBe("clinic-2");
  });
});
