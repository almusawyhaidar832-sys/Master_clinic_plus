import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";

// نحاكي المصادقة (requireBotClinic) لتفادي الحاجة لقاعدة بيانات حقيقية أو
// مفتاح API فعلي — نحقن clinicId + admin وهميين مباشرة كأن المفتاح صحيح دوماً.
vi.mock("@/lib/integration/bot-route-helpers", () => ({
  requireBotClinic: vi.fn(),
}));

const { requireBotClinic } = await import("@/lib/integration/bot-route-helpers");
const { POST } = await import("./route");
const { GET } = await import("./[idempotency_key]/route");

type Row = {
  id: string;
  clinic_id: string;
  idempotency_key: string;
  processed_at: string;
  created_at: string;
};

function createFakeAdmin(rows: Row[]) {
  let counter = 0;
  return {
    from() {
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
                      error: { code: "23505", message: "duplicate key" },
                    };
                  }
                  counter += 1;
                  const now = new Date().toISOString();
                  const row: Row = {
                    id: `fake-${counter}`,
                    clinic_id: payload.clinic_id,
                    idempotency_key: payload.idempotency_key,
                    processed_at: now,
                    created_at: now,
                  };
                  rows.push(row);
                  return { data: row, error: null };
                },
              };
            },
          };
        },
      };
    },
  } as unknown as SupabaseClient;
}

const CLINIC_ID = "clinic-1";

function mockAuthOk(admin: SupabaseClient) {
  (requireBotClinic as ReturnType<typeof vi.fn>).mockResolvedValue({
    ok: true,
    clinicId: CLINIC_ID,
    admin,
  });
}

function postRequest(body: unknown) {
  return new NextRequest("http://localhost/api/bot/events", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function getRequest() {
  return new NextRequest("http://localhost/api/bot/events/evt_test", { method: "GET" });
}

describe("POST /api/bot/events + GET /api/bot/events/[idempotency_key]", () => {
  let rows: Row[];

  beforeEach(() => {
    rows = [];
    mockAuthOk(createFakeAdmin(rows));
  });

  it("GET returns 404 for a key that was never recorded", async () => {
    const res = await GET(getRequest(), {
      params: Promise.resolve({ idempotency_key: "evt_never_seen" }),
    });
    expect(res.status).toBe(404);
  });

  it("POST creates a new event on first call", async () => {
    const res = await POST(postRequest({ idempotency_key: "evt_1", clinic_id: CLINIC_ID }));
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.created).toBe(true);
    expect(data.idempotency_key).toBe("evt_1");
  });

  it("POSTing the same idempotency_key twice does not error or duplicate", async () => {
    const first = await POST(postRequest({ idempotency_key: "evt_dup" }));
    const firstData = await first.json();

    const second = await POST(postRequest({ idempotency_key: "evt_dup" }));
    const secondData = await second.json();

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(firstData.created).toBe(true);
    expect(secondData.created).toBe(false);
    expect(rows).toHaveLength(1);
  });

  it("GET finds an event after it was recorded via POST", async () => {
    await POST(postRequest({ idempotency_key: "evt_findme" }));

    const res = await GET(getRequest(), {
      params: Promise.resolve({ idempotency_key: "evt_findme" }),
    });
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.idempotency_key).toBe("evt_findme");
    expect(data.clinic_id).toBe(CLINIC_ID);
  });

  it("rejects a POST with a missing idempotency_key", async () => {
    const res = await POST(postRequest({}));
    expect(res.status).toBe(400);
  });
});
