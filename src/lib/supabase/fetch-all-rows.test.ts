import { describe, expect, it } from "vitest";
import { fetchAllRows, fetchAllRowsInChunks } from "./fetch-all-rows";

function fakeTable(rows: number[]) {
  const calls: Array<[number, number]> = [];
  const build = () => ({
    range: async (from: number, to: number) => {
      calls.push([from, to]);
      return { data: rows.slice(from, to + 1), error: null };
    },
  });
  return { build, calls };
}

describe("fetchAllRows", () => {
  it("reads every page past the 1000-row PostgREST cap", async () => {
    const all = Array.from({ length: 2500 }, (_, i) => i);
    const { build, calls } = fakeTable(all);
    const { data, error } = await fetchAllRows<number>(build);
    expect(error).toBeNull();
    expect(data).toEqual(all);
    expect(calls).toEqual([
      [0, 999],
      [1000, 1999],
      [2000, 2999],
    ]);
  });

  it("does one extra request when the total is an exact page multiple", async () => {
    const all = Array.from({ length: 2000 }, (_, i) => i);
    const { build, calls } = fakeTable(all);
    const { data } = await fetchAllRows<number>(build);
    expect(data?.length).toBe(2000);
    expect(calls.length).toBe(3);
  });

  it("returns the error instead of a partial sum", async () => {
    let n = 0;
    const { data, error } = await fetchAllRows<number>(() => ({
      range: async () => {
        n += 1;
        return n === 1
          ? { data: Array.from({ length: 1000 }, () => 1), error: null }
          : { data: null, error: { message: "boom" } };
      },
    }));
    expect(data).toBeNull();
    expect(error?.message).toBe("boom");
  });
});

describe("fetchAllRowsInChunks", () => {
  it("splits large id lists, de-duplicates, and pages each chunk", async () => {
    const ids = Array.from({ length: 400 }, (_, i) => `id-${i}`);
    const chunks: string[][] = [];
    const { data, error } = await fetchAllRowsInChunks<{ id: string }>(
      [...ids, ...ids.slice(0, 50)],
      (chunk) => {
        chunks.push(chunk);
        return {
          range: async (from: number, to: number) => ({
            data: chunk.slice(from, to + 1).map((id) => ({ id })),
            error: null,
          }),
        };
      }
    );
    expect(error).toBeNull();
    expect(data?.map((r) => r.id)).toEqual(ids);
    expect(chunks.map((c) => c.length)).toEqual([150, 150, 100]);
  });

  it("returns nothing for an empty list without querying", async () => {
    let called = false;
    const { data } = await fetchAllRowsInChunks<unknown>([], () => {
      called = true;
      return { range: async () => ({ data: [], error: null }) };
    });
    expect(data).toEqual([]);
    expect(called).toBe(false);
  });
});
