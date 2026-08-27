import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { commands } from "../src/commands.js";
import { commandCoverage } from "../src/workflow-spec.js";

const commandMap = new Map(commands.map(command => [command.name, command]));

test("every registered slash command has exactly one documented handler path", () => {
  assert.equal(commandMap.size, commands.length);
  const coverage = commandCoverage([...commandMap.keys()]);
  assert.deepEqual(coverage.missingHandlers, []);
  assert.deepEqual(coverage.undocumentedHandlers, []);
  assert.deepEqual(coverage.missingRequirements, []);
  assert.deepEqual(coverage.missingChannelChecks, []);
});

test("every command has a safe description and valid Discord name", () => {
  for (const command of commands) {
    assert.match(command.name, /^[a-z0-9-]{1,32}$/);
    assert.ok(command.description.length >= 5);
  }
});

test("pab-health acknowledges before its live Discord checks", async () => {
  const source = await readFile(new URL("../src/index.js", import.meta.url), "utf8");
  const start = source.indexOf("async function runHealthCheck");
  const end = source.indexOf("async function runRosterSync", start);
  const handler = source.slice(start, end);
  assert.match(handler, /await interaction\.deferReply\(\{ ephemeral: true \}\)/);
  assert.match(handler, /return interaction\.editReply\(/);
  assert.doesNotMatch(handler, /return interaction\.reply\(/);
});

test("promotion modal keeps the rank placeholder within Discord's limit", async () => {
  const source = await readFile(new URL("../src/index.js", import.meta.url), "utf8");
  const start = source.indexOf("async function showPromotionModal");
  const end = source.indexOf("async function showRoleAwardModal", start);
  const handler = source.slice(start, end);
  assert.match(handler, /const rankPlaceholder = choices\.length > 90/);
  assert.match(handler, /placeholder: rankPlaceholder/);
});

test("promotion approval adds the new rank and retains prior rank roles", async () => {
  const source = await readFile(new URL("../src/index.js", import.meta.url), "utf8");
  const start = source.indexOf("async function approvePromotion");
  const end = source.indexOf("async function approveDemotion", start);
  const handler = source.slice(start, end);
  assert.match(handler, /member\.roles\.add\(targetRoleId/);
  assert.doesNotMatch(handler, /member\.roles\.remove/);
  assert.match(handler, /Existing rank roles were retained/);
});

test("demotion is a separate guided command with the same canonical rank choices", () => {
  const demotion = commandMap.get("demotion");
  assert.ok(demotion);
  assert.equal(demotion.options.find(option => option.name === "target-rank").choices.length, 15);
  assert.deepEqual(demotion.options.find(option => option.name === "date").choices.map(choice => choice.value), ["today", "manual"]);
});

test("promotion rejects downward rank changes and demotion replaces rank roles", async () => {
  const source = await readFile(new URL("../src/index.js", import.meta.url), "utf8");
  const promotion = source.slice(source.indexOf('if (kind === "promotion-modal")'), source.indexOf('if (kind === "demotion-modal")'));
  assert.match(promotion, /Use \/demotion for a lower rank/);
  const demotion = source.slice(source.indexOf("async function approveDemotion"), source.indexOf("async function approveRoleAward"));
  assert.match(demotion, /member\.roles\.remove/);
  assert.match(demotion, /member\.roles\.add\(targetRoleId/);
});

test("rank actions ping PAB and Command in final record and announcement destinations", async () => {
  const source = await readFile(new URL("../src/index.js", import.meta.url), "utf8");
  const start = source.indexOf("function rankActionRoleMentions");
  const end = source.indexOf("async function approveRoleAward", start);
  const handlers = source.slice(start, end);
  assert.match(handlers, /config\.pabRoleId/);
  assert.match(handlers, /config\.commandRoleId/);
  assert.match(handlers, /allowedMentions: \{ users: \[member\.id\], roles: rankActionRoleMentions\(\) \}/);
  assert.match(handlers, /allowedMentions: \{ users: \[member\.id\], roles: rankRoles \}/);
});

test("role-changing and date-bearing forms expose the same Today/manual control", () => {
  for (const name of ["training-log", "promotion", "demotion", "award-role", "remove-role", "personnel-status"]) {
    const date = commandMap.get(name).options.find(option => option.name === "date");
    assert.ok(date, `${name} must expose a date selector`);
    assert.equal(date.required, true);
    assert.deepEqual(date.choices.map(choice => choice.value), ["today", "manual"]);
  }
});

test("promotion-case target rank is a bounded canonical choice menu", () => {
  const targetRank = commandMap.get("promotion-case").options.find(option => option.name === "target-rank");
  assert.ok(targetRank);
  assert.equal(targetRank.required, true);
  assert.deepEqual(targetRank.choices.map(choice => choice.value), [
    "DST", "Deputy", "Senior Deputy", "Corporal", "Sergeant", "Staff Sergeant",
    "Lieutenant", "Captain", "Major", "Commander",
    "Division Chief", "Chief Deputy", "Assistant Sheriff", "UnderSheriff", "Sheriff"
  ]);
  assert.equal(targetRank.choices[0].name, "Deputy Sheriff Trainee (DST)");
});

test("real-server PAB intake fields are represented in the guided commands", () => {
  const training = commandMap.get("training-log");
  assert.deepEqual(training.options.filter(option => option.required).map(option => option.name), ["trainer", "trainee", "division", "date", "timezone"]);
  const department = commandMap.get("department-record");
  assert.ok(department.options.some(option => option.name === "source-link"));
  assert.ok(department.options.some(option => option.name === "added-role"));
  assert.ok(department.options.some(option => option.name === "removed-role"));
  assert.ok(department.options.some(option => option.name === "cc-role"));
});

test("administrator routing commands expose bounded choices", () => {
  const channel = commandMap.get("config-channel");
  const activity = commandMap.get("config-activity");
  assert.ok(channel);
  assert.ok(activity);
  assert.equal(channel.options.find(option => option.name === "setting").choices.length, 13);
  assert.deepEqual(activity.options.find(option => option.name === "mode").choices.map(choice => choice.value), ["add", "remove"]);
});
