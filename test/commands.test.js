import test from "node:test";
import assert from "node:assert/strict";
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

test("role-changing and date-bearing forms expose the same Today/manual control", () => {
  for (const name of ["training-log", "promotion", "award-role", "remove-role", "personnel-status"]) {
    const date = commandMap.get(name).options.find(option => option.name === "date");
    assert.ok(date, `${name} must expose a date selector`);
    assert.equal(date.required, true);
    assert.deepEqual(date.choices.map(choice => choice.value), ["today", "manual"]);
  }
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
