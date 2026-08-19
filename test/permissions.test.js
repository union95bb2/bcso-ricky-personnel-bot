import test from "node:test";
import assert from "node:assert/strict";
import { PermissionFlagsBits } from "discord.js";
import { channelPermissionIssue, memberManagementIssue, roleManagementIssue } from "../src/permissions.js";

function permissions(...allowed) {
  return { has: value => allowed.includes(value) };
}

function role(name, position, extra = {}) {
  return {
    id: `${name}-${position}`,
    name,
    position,
    guild: { id: "guild" },
    managed: false,
    editable: true,
    permissions: permissions(),
    ...extra
  };
}

function bot(highest, allowed = [PermissionFlagsBits.ManageRoles]) {
  return {
    id: "bot",
    permissions: permissions(...allowed),
    roles: { highest: role("Ricky Controller", highest) }
  };
}

test("member hierarchy diagnostics identify the server owner", () => {
  const issue = memberManagementIssue({ id: "owner", roles: { highest: role("Owner", 10) } }, { botMember: bot(20), guildOwnerId: "owner" });
  assert.match(issue, /server owner/i);
});

test("member hierarchy diagnostics identify a member above Ricky", () => {
  const issue = memberManagementIssue({ id: "member", roles: { highest: role("Sheriff", 30) }, manageable: false }, { botMember: bot(5), guildOwnerId: "owner" });
  assert.match(issue, /must be above/);
  assert.match(issue, /Sheriff/);
});

test("role hierarchy diagnostics identify missing Manage Roles", () => {
  const issue = roleManagementIssue(role("Deputy", 2), { botMember: bot(5, []) });
  assert.match(issue, /Manage Roles/);
});

test("role hierarchy diagnostics block administrator roles", () => {
  const adminRole = role("Administrator", 2, { permissions: permissions(PermissionFlagsBits.Administrator) });
  const issue = roleManagementIssue(adminRole, { botMember: bot(5) });
  assert.match(issue, /Administrator/);
});

test("channel diagnostics name missing permissions", () => {
  const channel = { permissionsFor: () => permissions(PermissionFlagsBits.ViewChannel) };
  const issue = channelPermissionIssue(channel, bot(5));
  assert.match(issue, /Send Messages/);
  assert.match(issue, /Embed Links/);
});
