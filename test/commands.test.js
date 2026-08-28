import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { commands } from "../src/commands.js";
import { ADMIN_COMMANDS, PAB_COMMANDS, SELF_SERVICE_COMMANDS, WORKFLOW_CHANNELS, commandCoverage } from "../src/workflow-spec.js";

const commandMap = new Map(commands.map(command => [command.name, command]));

test("every registered slash command has exactly one documented handler path", () => {
  assert.equal(commandMap.size, commands.length);
  const coverage = commandCoverage([...commandMap.keys()]);
  assert.deepEqual(coverage.missingHandlers, []);
  assert.deepEqual(coverage.undocumentedHandlers, []);
  assert.deepEqual(coverage.missingRequirements, []);
  assert.deepEqual(coverage.missingChannelChecks, []);
});

test("command groups and option/route keys are disjoint", () => {
  const groups = [ADMIN_COMMANDS, PAB_COMMANDS, SELF_SERVICE_COMMANDS];
  for (const command of commands) {
    const memberships = groups.filter(group => group.has(command.name));
    assert.equal(memberships.length, 1, `${command.name} must belong to exactly one permission group`);
    const optionNames = command.options.map(option => option.name);
    assert.equal(new Set(optionNames).size, optionNames.length, `${command.name} has duplicate option names`);
  }
  for (const [commandName, routeKeys] of Object.entries(WORKFLOW_CHANNELS)) {
    assert.equal(new Set(routeKeys).size, routeKeys.length, `${commandName} has duplicate destination checks`);
  }
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

test("promotion target rank is a required canonical dropdown", () => {
  const promotion = commandMap.get("promotion");
  const targetRank = promotion.options.find(option => option.name === "target-rank");
  assert.ok(targetRank);
  assert.equal(targetRank.required, true);
  assert.equal(targetRank.choices.length, 15);
  assert.equal(targetRank.choices[0].name, "Deputy Sheriff Trainee (DST)");
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

test("rank actions require a different Command reviewer after PAB review", async () => {
  const source = await readFile(new URL("../src/index.js", import.meta.url), "utf8");
  assert.match(source, /action\.data\.pabApprovedBy === interaction\.user\.id/);
  assert.match(source, /A different Command reviewer must approve and apply this rank change; the PAB reviewer cannot self-approve/);
});

test("role-changing and date-bearing forms expose the same Today/manual control", () => {
  for (const name of ["training-log", "promotion", "demotion", "award-role", "remove-role", "personnel-status"]) {
    const date = commandMap.get(name).options.find(option => option.name === "date");
    assert.ok(date, `${name} must expose a date selector`);
    assert.equal(date.required, true);
    assert.deepEqual(date.choices.map(choice => choice.value), ["today", "manual"]);
  }
});

test("award and remove role workflows expose up to five selectable roles", async () => {
  for (const name of ["award-role", "remove-role"]) {
    const command = commandMap.get(name);
    assert.ok(command);
    assert.match(command.description, /1–5/);
    assert.equal(command.options.find(option => option.name === "role").required, true);
    assert.match(command.options.find(option => option.name === "role").description, /role-2 through role-5/);
    assert.deepEqual(
      command.options.filter(option => option.name.startsWith("role")).map(option => option.name),
      ["role", "role-2", "role-3", "role-4", "role-5"]
    );
    assert.ok(command.options.findIndex(option => option.name === "date") < command.options.findIndex(option => option.name === "role-2"), `${name} must place required date before optional roles`);
  }
  const source = await readFile(new URL("../src/index.js", import.meta.url), "utf8");
  assert.match(source, /function selectedAwardRoles/);
  assert.match(source, /member\.roles\.add\(missingRoleIds/);
  assert.match(source, /member\.roles\.remove\(roleIds/);
  assert.match(source, /Roles awarded/);
  assert.match(source, /Roles removed/);
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
