import test from "node:test";
import assert from "node:assert/strict";
import { clean, memberLabel, mentionWithLabel, normalizeClockTime, normalizeDate, normalizeDateRange, normalizeMultiline, rankRoleEntries, resolveTrainingTimeZone, splitTimeRange, todayInTimeZone } from "../src/format.js";

test("clean trims and preserves ordinary text", () => {
  assert.equal(clean("  Academy Complete  "), "Academy Complete");
  assert.equal(clean("a".repeat(8), 5), "aaaa…");
});

test("member labels safely use Discord display names", () => {
  const member = { id: "907", displayName: "C-907 | Tyler M", user: { username: "tyler" } };
  assert.equal(memberLabel(member), "C-907 | Tyler M");
  assert.equal(mentionWithLabel(member), "<@907> — C-907 | Tyler M");
});

test("multi-line notes collapse excessive blank lines", () => {
  assert.equal(normalizeMultiline("A\n\n\n\nB"), "A\n\nB");
});

test("rank map becomes predictable rank-role entries", () => {
  assert.deepEqual(rankRoleEntries({ Deputy: "2", Corporal: "3" }), [{ rank: "Deputy", id: "2" }, { rank: "Corporal", id: "3" }]);
});

test("today uses the configured timezone", () => {
  const justAfterMidnightUtc = new Date("2026-08-18T06:30:00Z");
  assert.equal(todayInTimeZone("Etc/GMT+7", justAfterMidnightUtc), "08/17/2026");
});

test("training times normalize an entered timezone suffix", () => {
  assert.deepEqual(splitTimeRange("4:00 PM MST - 5:00 PM MST", "MST"), ["4:00 PM", "5:00 PM"]);
  assert.deepEqual(splitTimeRange("4:00 PM - 5:00 PM", "MST"), ["4:00 PM", "5:00 PM"]);
  assert.deepEqual(splitTimeRange("4 PM – 5 PM MST", "MST"), ["4:00 PM", "5:00 PM"]);
  assert.deepEqual(splitTimeRange("4 PM to 5 PM MST", "MST"), ["4:00 PM", "5:00 PM"]);
  assert.deepEqual(splitTimeRange("4:00 PM - 5:00 PM (MST)", "MST"), ["4:00 PM", "5:00 PM"]);
});

test("training timezone choices resolve to stable labels and IANA zones", () => {
  assert.equal(resolveTrainingTimeZone("MST").timeZoneId, "Etc/GMT+7");
  assert.equal(resolveTrainingTimeZone("EST").label, "EST");
  assert.equal(resolveTrainingTimeZone("unknown", { label: "MST", timeZoneId: "Etc/GMT+7" }).label, "MST");
});

test("dates normalize to the shared MM/DD/YYYY format", () => {
  assert.equal(normalizeDate("8/6/2026"), "08/06/2026");
  assert.equal(normalizeDate("08-06-2026"), "08/06/2026");
  assert.equal(normalizeDate("August 6, 2026"), "");
  assert.equal(normalizeDate("02/30/2026"), "");
  assert.equal(normalizeDateRange("8/1/2026 – 8/17/2026"), "08/01/2026 - 08/17/2026");
  assert.equal(normalizeDateRange("08-01-2026 - 08-17-2026"), "08/01/2026 - 08/17/2026");
});

test("times normalize to h:mm AM/PM", () => {
  assert.equal(normalizeClockTime("4:00 pm"), "4:00 PM");
  assert.equal(normalizeClockTime("4 PM"), "4:00 PM");
  assert.equal(normalizeClockTime("4 p.m."), "4:00 PM");
  assert.equal(normalizeClockTime("16:00 PM"), "");
  assert.deepEqual(splitTimeRange("4:00 pm MST - 5:00 pm MST", "MST"), ["4:00 PM", "5:00 PM"]);
});
