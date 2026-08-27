import test from "node:test";
import assert from "node:assert/strict";
import { canonicalRankRoleEntries, clean, durationLabel, memberLabel, mentionWithLabel, normalizeClockTime, normalizeDate, normalizeDateRange, normalizeMultiline, parseDiscordMessageLink, rankRoleEntries, resolveTrainingTimeZone, splitTimeRange, todayInTimeZone, TRAINING_DIVISION_CHOICES, TRAINING_TIME_CHOICES } from "../src/format.js";
import { BCSO_RANK_MATRIX } from "../src/rank-matrix.js";

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

test("canonical rank entries follow progression order and ignore obsolete aliases", () => {
  assert.deepEqual(canonicalRankRoleEntries({ "2nd Lieutenant": "old-2", Lieutenant: "lt", Deputy: "dep", Corporal: "corp" }), [
    { rank: "Deputy", id: "dep" }, { rank: "Corporal", id: "corp" }, { rank: "Lieutenant", id: "lt" }
  ]);
  assert.equal(BCSO_RANK_MATRIX.some(rank => rank.key === "1st Lieutenant" || rank.key === "2nd Lieutenant"), false);
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

test("training time dropdown choices cover one hourly day", () => {
  assert.equal(TRAINING_TIME_CHOICES.length, 24);
  assert.equal(TRAINING_TIME_CHOICES[0].value, "12:00 AM");
  assert.equal(TRAINING_TIME_CHOICES[16].value, "4:00 PM");
  assert.equal(TRAINING_TIME_CHOICES[23].value, "11:00 PM");
});

test("training division choices cover the live PAB program categories", () => {
  assert.deepEqual(TRAINING_DIVISION_CHOICES.map(choice => choice.value), ["BCSO / POST Academy", "FTO", "SAR", "SEB", "TED", "DET", "Other"]);
});

test("training duration is derived consistently from the selected range", () => {
  assert.equal(durationLabel("4:00 PM", "5:00 PM"), "1 hour");
  assert.equal(durationLabel("4:00 PM", "4:30 PM"), "30 minutes");
  assert.equal(durationLabel("11:30 PM", "12:15 AM"), "45 minutes");
  assert.equal(durationLabel("4:00 PM", "4:00 PM"), "Not calculated");
  assert.equal(durationLabel("not a time", "5:00 PM"), "Not calculated");
});

test("dates normalize to the shared MM/DD/YYYY format", () => {
  assert.equal(normalizeDate("8/6/2026"), "08/06/2026");
  assert.equal(normalizeDate("08-06-2026"), "08/06/2026");
  assert.equal(normalizeDate("August 6, 2026"), "");
  assert.equal(normalizeDate("02/30/2026"), "");
  assert.equal(normalizeDateRange("8/1/2026 – 8/17/2026"), "08/01/2026 - 08/17/2026");
  assert.equal(normalizeDateRange("08-01-2026 - 08-17-2026"), "08/01/2026 - 08/17/2026");
});

test("source links are restricted to the configured BCSO guild", () => {
  assert.deepEqual(parseDiscordMessageLink("https://discord.com/channels/guild/channel/message", "guild"), null);
  assert.deepEqual(parseDiscordMessageLink("https://discord.com/channels/1539383172536467516/123/456", "1539383172536467516"), {
    guildId: "1539383172536467516",
    channelId: "123",
    messageId: "456",
    messageLink: "https://discord.com/channels/1539383172536467516/123/456"
  });
  assert.equal(parseDiscordMessageLink("https://discord.com/channels/other/123/456", "1539383172536467516"), null);
});

test("times normalize to h:mm AM/PM", () => {
  assert.equal(normalizeClockTime("4:00 pm"), "4:00 PM");
  assert.equal(normalizeClockTime("4 PM"), "4:00 PM");
  assert.equal(normalizeClockTime("4 p.m."), "4:00 PM");
  assert.equal(normalizeClockTime("16:00 PM"), "");
  assert.deepEqual(splitTimeRange("4:00 pm MST - 5:00 pm MST", "MST"), ["4:00 PM", "5:00 PM"]);
});
