import test from "node:test";
import assert from "node:assert/strict";
import { BCSO_RANK_MATRIX, REQUIRED_RANK_KEYS } from "../src/rank-matrix.js";

test("BCSO rank matrix includes DST and the complete documented promotion ladder", () => {
  assert.equal(BCSO_RANK_MATRIX[0].key, "DST");
  assert.equal(BCSO_RANK_MATRIX[0].displayName, "Deputy Sheriff Trainee");
  assert.deepEqual(REQUIRED_RANK_KEYS, [
    "DST", "Deputy", "Senior Deputy", "Corporal", "Sergeant", "Staff Sergeant",
    "2nd Lieutenant", "1st Lieutenant", "Captain", "Major", "Commander",
    "Division Chief", "Chief Deputy", "Assistant Sheriff", "UnderSheriff", "Sheriff"
  ]);
  assert.ok(BCSO_RANK_MATRIX.find(rank => rank.key === "DST").aliases.includes("Deputy Sheriff Trainee"));
});
