import { PermissionFlagsBits } from "discord.js";

const permissionNames = new Map([
  [PermissionFlagsBits.ViewChannel, "View Channel"],
  [PermissionFlagsBits.SendMessages, "Send Messages"],
  [PermissionFlagsBits.EmbedLinks, "Embed Links"],
  [PermissionFlagsBits.ReadMessageHistory, "Read Message History"],
  [PermissionFlagsBits.AttachFiles, "Attach Files"],
  [PermissionFlagsBits.ManageRoles, "Manage Roles"],
  [PermissionFlagsBits.MentionEveryone, "Mention Everyone"]
]);

function hasPermission(subject, permission) {
  return Boolean(subject?.permissions?.has?.(permission));
}

function roleName(role) {
  return role?.name ? `\`${role.name}\`` : "the selected role";
}

function compareHighest(botMember, target) {
  const botHighest = botMember?.roles?.highest;
  const targetHighest = target?.roles?.highest || target;
  if (!botHighest || !targetHighest) return null;
  if (typeof botHighest.comparePositionTo === "function") return botHighest.comparePositionTo(targetHighest);
  if (Number.isFinite(botHighest.position) && Number.isFinite(targetHighest.position)) return botHighest.position - targetHighest.position;
  return null;
}

/** Return a human-readable reason why Ricky cannot change a member. */
export function memberManagementIssue(member, { botMember, guildOwnerId } = {}) {
  if (!member) return "The selected member is no longer in this server.";
  if (guildOwnerId && member.id === guildOwnerId) return "Discord never allows a bot to manage the server owner.";
  if (botMember?.id === member.id) return "Ricky cannot manage its own member account.";
  if (!botMember) return "Ricky is not currently available as a server member.";
  if (!hasPermission(botMember, PermissionFlagsBits.ManageRoles)) return "Ricky is missing the **Manage Roles** server permission.";
  const comparison = compareHighest(botMember, member);
  if (comparison !== null && comparison <= 0) {
    return `Ricky's highest role (${roleName(botMember.roles.highest)}) must be above the member's highest role (${roleName(member.roles.highest)}).`;
  }
  if (member.manageable === false) return "Discord reports that Ricky cannot manage this member; check the member's highest role and protected status.";
  return null;
}

/** Return a human-readable reason why Ricky cannot add/remove a role. */
export function roleManagementIssue(role, { botMember, allowAdministrator = false } = {}) {
  if (!role) return "The selected role no longer exists in this server.";
  if (role.id === role.guild?.id) return "The @everyone role cannot be changed by Ricky.";
  if (role.managed) return `${roleName(role)} is managed by a Discord integration and cannot be changed by Ricky.`;
  if (!botMember) return "Ricky is not currently available as a server member.";
  if (!hasPermission(botMember, PermissionFlagsBits.ManageRoles)) return "Ricky is missing the **Manage Roles** server permission.";
  if (!allowAdministrator && hasPermission(role, PermissionFlagsBits.Administrator)) return `${roleName(role)} grants Administrator and is blocked by Ricky's safety guardrail.`;
  const comparison = compareHighest(botMember, role);
  if (comparison !== null && comparison <= 0) {
    return `Ricky's highest role (${roleName(botMember.roles.highest)}) must be above ${roleName(role)}.`;
  }
  if (role.editable === false) return `Discord reports that Ricky cannot edit ${roleName(role)}.`;
  return null;
}

/** Return the missing channel permissions for a specific workflow. */
export function channelPermissionIssue(channel, botMember, required = [
  PermissionFlagsBits.ViewChannel,
  PermissionFlagsBits.SendMessages,
  PermissionFlagsBits.EmbedLinks
]) {
  const permissions = channel?.permissionsFor?.(botMember);
  if (!permissions) return "Ricky cannot resolve its permissions in this channel.";
  const missing = required.filter(permission => !permissions.has(permission));
  if (!missing.length) return null;
  return `Ricky is missing: ${missing.map(permission => permissionNames.get(permission) || "a required permission").join(", ")}.`;
}

export function permissionLabel(permission) {
  return permissionNames.get(permission) || "Required permission";
}
