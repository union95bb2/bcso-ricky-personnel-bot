import test from "node:test";
import assert from "node:assert/strict";
import { compareRosterRows } from "../src/google-sheets.js";

function member(id, roles = []) {
  return { id, displayName: id, user: { bot: false }, roles: { cache: new Map(roles.map(roleId => [roleId, { id: roleId }])) } };
}

test("roster comparison reports missing members and rank mismatches without mutating Discord state", () => {
  const result = compareRosterRows([
    { discord_id: "1", callsign: "C-100", rank: "Corporal" },
    { discord_id: "2", callsign: "C-200", rank: "Deputy" },
    { discord_id: "9", callsign: "C-900", rank: "Deputy" }
  ], [member("1", ["role-deputy"]), member("2", ["role-deputy"]), member("3")], { Deputy: "role-deputy", Corporal: "role-corporal" });
  assert.equal(result.totalRows, 3);
  assert.equal(result.missingDiscord.length, 1);
  assert.equal(result.mismatches.length, 1);
  assert.equal(result.mismatches[0].expected, "Corporal");
  assert.deepEqual(result.sheetOnlyIds, ["3"]);
});
