import test from "node:test";
import assert from "node:assert/strict";
import { evaluatePromotionEligibility, promotionEligibilityLines } from "../src/promotion-eligibility.js";

const row = {
  bcso_promotion_evaluation_roster_personnel_promotion_review_eligibility_tracking_employee_deputy: "(C-110) W. Dorfman",
  current_rank: "Corporal",
  rank_sought: "Sergeant",
  hours_of_service: "218",
  reports_made_8_12_26_8_16_26: "0",
  disciplinary_actions: "None",
  disciplinary_details_date: "",
  pab_recommendation: "Pending",
  supervisor_comments: ""
};

test("promotion evaluation matches the live sheet's composite employee field and stays advisory", () => {
  const result = evaluatePromotionEligibility({
    rows: [row],
    member: { id: "110", nickname: "C-110 | CPL. W. Dorfman | BCSO", displayName: "W. Dorfman", user: { username: "wdorfman" } },
    memberRank: "Corporal",
    currentRank: "Corporal",
    requestedRank: "Sergeant"
  });
  assert.equal(result.matched, true);
  assert.equal(result.answer, "Needs human PAB review");
  assert.equal(result.row.callsign, "C-110");
  assert.ok(result.checks.some(check => check.label === "PAB recommendation" && check.state === "review"));
  assert.match(promotionEligibilityLines(result).join("\n"), /never changes roles/);
});

test("promotion evaluation flags a rank mismatch and non-clear disciplinary field", () => {
  const result = evaluatePromotionEligibility({
    rows: [{ ...row, current_rank: "Deputy", disciplinary_actions: "Under review", pab_recommendation: "Not eligible" }],
    member: { id: "110", nickname: "C-110 | CPL. W. Dorfman", displayName: "W. Dorfman", user: { username: "wdorfman" } },
    memberRank: "Corporal",
    currentRank: "Corporal",
    requestedRank: "Sergeant"
  });
  assert.equal(result.answer, "Not eligible on the current record");
  assert.ok(result.checks.some(check => check.label === "Rank alignment" && check.state === "review"));
  assert.ok(result.checks.some(check => check.label === "Disciplinary field" && check.state === "review"));
  assert.ok(result.checks.some(check => check.label === "PAB recommendation" && check.state === "fail"));
});

test("promotion evaluation reports missing evidence without deciding from an absent row", () => {
  const result = evaluatePromotionEligibility({ rows: [], member: { id: "1", displayName: "Nobody" } });
  assert.equal(result.matched, false);
  assert.equal(result.answer, "No promotion evaluation row found");
  assert.equal(result.checks[0].state, "missing");
});
