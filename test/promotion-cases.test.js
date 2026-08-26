import test from "node:test";
import assert from "node:assert/strict";
import { caseIsComplete, caseMissingChecks, completeCaseCheck, createPromotionCaseData, reopenCaseCheck } from "../src/promotion-cases.js";

test("promotion case checks require all three human verification steps", () => {
  let data = createPromotionCaseData({ memberId: "member-1", memberLabel: "Deputy", fromRank: "Deputy", toRank: "Senior Deputy", createdBy: "pab-1" });
  assert.equal(caseIsComplete(data), false);
  assert.deepEqual(caseMissingChecks(data).map(check => check.key), ["timeInRank", "hours", "psd"]);
  data = completeCaseCheck(data, "timeInRank", { value: "01/01/2026 → 07/01/2026 (181 calendar days)", source: "PAB record", reviewedBy: "pab-2" });
  data = completeCaseCheck(data, "hours", { value: "24 hours — July 2026", source: "Shift log", reviewedBy: "pab-2" });
  data = completeCaseCheck(data, "psd", { value: "Eligible", source: "PSD review", reviewedBy: "psd-1" });
  assert.equal(caseIsComplete(data), true);
  assert.equal(data.status, "ready-for-oots");
});

test("a reopened check returns a case to pending verification and records why", () => {
  let data = createPromotionCaseData({ memberId: "member-1", memberLabel: "Deputy", fromRank: "Deputy", toRank: "Senior Deputy", createdBy: "pab-1" });
  data = completeCaseCheck(data, "hours", { value: "24 hours — July 2026", source: "Shift log", reviewedBy: "pab-2" });
  data = reopenCaseCheck(data, "hours", "Source was not attached", "oots-1", "2026-08-25T12:00:00.000Z");
  assert.equal(data.status, "pending-verification");
  assert.equal(data.checks.hours.state, "pending");
  assert.equal(data.events.at(-1).reason, "Source was not attached");
});
