import test from "node:test";
import assert from "node:assert/strict";
import { compareRosterRows, GoogleRosterSheet } from "../src/google-sheets.js";

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

test("promotion roster columns can use Role and Badge Number aliases", () => {
  const result = compareRosterRows([
    { discord_id: "1", badge_number: "C-100", name: "Cole", role: "Corporal" }
  ], [member("1", ["role-corporal"])], { Corporal: "role-corporal" });
  assert.equal(result.missingDiscord.length, 0);
  assert.equal(result.mismatches.length, 0);
});

test("disabled Google roster staging cannot read even when an ID is preloaded", async () => {
  let fetchCalls = 0;
  const sheet = new GoogleRosterSheet({
    enabled: false,
    spreadsheetId: "prepared-sheet-id",
    serviceAccountJson: "not parsed while staging",
    fetchImpl: async () => {
      fetchCalls += 1;
      throw new Error("network must not be called while staged");
    }
  });
  assert.equal(sheet.configured, false);
  assert.equal(sheet.status().enabled, false);
  await assert.rejects(sheet.rows(), /Google Sheets is not configured/);
  assert.equal(fetchCalls, 0);
});
