/**
 * Phase 2 verification — multi-select dental chart pure logic.
 * Run: node scripts/verify-dental-chart-logic.mjs
 */

import assert from "node:assert/strict";

function toggleSelectedTeeth(prev, toothNum) {
  if (prev.includes(toothNum)) return prev.filter((t) => t !== toothNum);
  return [...prev, toothNum].sort((a, b) => a - b);
}

function applyProcedureToTeeth(value, selectedTeeth, procedure, note) {
  const next = { ...value };
  const trimmedNote = note.trim() || undefined;
  for (const toothNum of selectedTeeth) {
    next[toothNum] = {
      tooth_number: toothNum,
      procedure_ar: procedure,
      note: trimmedNote,
    };
  }
  return next;
}

function removeTeethFromValue(value, selectedTeeth) {
  const next = { ...value };
  for (const toothNum of selectedTeeth) delete next[toothNum];
  return next;
}

function formatTeethLabel(teeth) {
  const sorted = [...teeth].sort((a, b) => a - b);
  if (sorted.length === 1) return `السن ${sorted[0]}`;
  return `الأسنان ${sorted.join("، ")}`;
}

function teethPayloadFromDraft(teeth) {
  return Object.values(teeth);
}

// toggle
assert.deepEqual(toggleSelectedTeeth([], 16), [16]);
assert.deepEqual(toggleSelectedTeeth([16], 17), [16, 17]);
assert.deepEqual(toggleSelectedTeeth([17, 16], 16), [17]);
assert.deepEqual(toggleSelectedTeeth([16], 16), []);

// apply multi
const applied = applyProcedureToTeeth({}, [16, 17, 18], "حشوة", "  ملاحظة  ");
assert.equal(Object.keys(applied).length, 3);
assert.equal(applied[16].procedure_ar, "حشوة");
assert.equal(applied[17].note, "ملاحظة");
assert.equal(applied[18].tooth_number, 18);

// apply preserves other teeth
const merged = applyProcedureToTeeth({ 11: { tooth_number: 11, procedure_ar: "كشف" } }, [16], "خلع", "");
assert.equal(merged[11].procedure_ar, "كشف");
assert.equal(merged[16].procedure_ar, "خلع");

// remove multi
const removed = removeTeethFromValue(
  { 16: { tooth_number: 16, procedure_ar: "حشوة" }, 17: { tooth_number: 17, procedure_ar: "حشوة" } },
  [16, 17]
);
assert.deepEqual(removed, {});

// label
assert.equal(formatTeethLabel([16]), "السن 16");
assert.equal(formatTeethLabel([18, 16, 17]), "الأسنان 16، 17، 18");

// save payload (integration with session-records)
const draft = applyProcedureToTeeth({}, [16, 17], "تاج", "");
const payload = teethPayloadFromDraft(draft);
assert.equal(payload.length, 2);
assert.deepEqual(
  payload.map((t) => t.tooth_number).sort(),
  [16, 17]
);

console.log("✓ dental chart multi-select logic — all checks passed");
