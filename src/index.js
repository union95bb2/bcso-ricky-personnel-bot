import {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  Client,
  EmbedBuilder,
  Events,
  GatewayIntentBits,
  ModalBuilder,
  PermissionFlagsBits,
  TextInputBuilder,
  TextInputStyle
} from "discord.js";
import { randomUUID } from "node:crypto";
import { config, configLabels, configurationIssues, missingConfiguration } from "./config.js";
import { commands } from "./commands.js";
import { clean, dateInTimeZone, durationLabel, endOfDateTimestamp, memberLabel, mentionWithLabel, normalizeDate, normalizeDateRange, normalizeMultiline, parseDiscordMessageLink, rankRoleEntries, resolveTrainingTimeZone, splitTimeRange, todayInTimeZone } from "./format.js";
import { PendingActions } from "./pending-actions.js";
import { channelPermissionIssue, memberManagementIssue, roleManagementIssue } from "./permissions.js";
import { PabStore } from "./store.js";
import { ADMIN_COMMANDS, PAB_COMMANDS, SELF_SERVICE_COMMANDS, WORKFLOW_CHANNELS, WORKFLOW_REQUIREMENTS } from "./workflow-spec.js";
import { acquireProcessLock } from "./process-lock.js";
import { GoogleRosterSheet, compareRosterRows } from "./google-sheets.js";
import { evaluatePromotionEligibility, promotionEligibilityLines } from "./promotion-eligibility.js";
import { logError } from "./logger.js";
import { memberThreadName, sendRecord } from "./record-destinations.js";
import { RmsStore } from "./rms/store.js";

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildMessages] });
const store = new PabStore(config.dataPath);
const rms = config.rmsEnabled ? new RmsStore(config.rmsDataPath) : null;
const pending = new PendingActions(store, { ttlMinutes: config.pendingActionTtlMinutes });
const rosterSheet = new GoogleRosterSheet({
  enabled: config.googleSheetsEnabled,
  spreadsheetId: config.googleSheetsSpreadsheetId,
  range: config.googleSheetsRange,
  serviceAccountJson: config.googleSheetsServiceAccountJson
});
const promotionTestsSheet = new GoogleRosterSheet({
  enabled: config.googlePromotionTestsEnabled,
  spreadsheetId: config.googlePromotionTestsSpreadsheetId,
  range: config.googlePromotionTestsRange,
  serviceAccountJson: config.googleSheetsServiceAccountJson
});
let releaseProcessLock;
try {
  releaseProcessLock = acquireProcessLock(`${config.dataPath}.lock`);
} catch (error) {
  console.error(`Ricky startup blocked: ${error instanceof Error ? error.message : "another instance is already running"}`);
  store.close();
  rms?.close();
  process.exit(1);
}
const BLUE = 0x1d4e89;
const GREEN = 0x2d7d46;
const DATE_FORMAT_HINT = "MM/DD/YYYY";
const DATE_RANGE_FORMAT_HINT = `${DATE_FORMAT_HINT} - ${DATE_FORMAT_HINT}`;

function hasRole(member, roleId) {
  return Boolean(roleId) && member.roles.cache.has(roleId);
}

function isServerAdministrator(member) {
  return member.permissions.has(PermissionFlagsBits.Administrator);
}

function mayUsePab(member) {
  return hasRole(member, config.pabRoleId) || hasRole(member, config.commandRoleId) || member.permissions.has(PermissionFlagsBits.Administrator);
}

function mayApprovePromotion(member) {
  return hasRole(member, config.commandRoleId) || member.permissions.has(PermissionFlagsBits.Administrator);
}

function rankNameForMember(member) {
  return rankRoleEntries(config.rankRoleIds).find(({ id }) => member.roles.cache.has(id))?.rank || "PAB";
}

function isApprovedAwardRole(role) {
  return config.awardableRoleIds.has(role.id)
    && !Object.values(config.rankRoleIds).includes(role.id)
    && role.id !== role.guild.id
    && !role.managed
    && !role.permissions.has(PermissionFlagsBits.Administrator);
}

function awardRoleEligibilityMessage(role, action = "award") {
  if (!config.awardableRoleIds.size) {
    return `No qualification or unit roles are configured for PAB ${action}s yet. A server administrator must add the intended role ID to the protected \`AWARDABLE_ROLE_IDS\` setting, restart Ricky, then run \`/pab-health\`.`;
  }
  if (!config.awardableRoleIds.has(role.id)) {
    const configured = [...config.awardableRoleIds].map(id => `<@&${id}>`).join(", ");
    return `**${role.name}** is not on Ricky's PAB ${action} allow-list. The currently configured role(s) are: ${configured}. Rank, PAB, Command, moderation, and administrator roles cannot be changed with this command.`;
  }
  if (Object.values(config.rankRoleIds).includes(role.id)) {
    return `**${role.name}** is a configured rank role. Rank changes must use \`/promotion\` and Command approval.`;
  }
  if (role.managed) return `**${role.name}** is a managed integration role and cannot be changed by Ricky.`;
  if (role.permissions.has(PermissionFlagsBits.Administrator)) return `**${role.name}** has Administrator permission and is blocked from PAB qualification/unit changes.`;
  return `**${role.name}** is not eligible for PAB ${action}s. Run \`/pab-health\` to check the allow-list and role hierarchy.`;
}

function isNotifiableRole(role, botMember = null) {
  return role
    && role.id !== role.guild.id
    && !role.managed
    && !role.permissions.has(PermissionFlagsBits.Administrator)
    && (role.mentionable || botMember?.permissions.has(PermissionFlagsBits.MentionEveryone));
}

function unauthorized(interaction) {
  return interaction.reply({ content: "Only PAB or Command members can use this workflow.", ephemeral: true });
}

function unauthorizedAdmin(interaction) {
  return interaction.reply({ content: "Only a server administrator can run live setup diagnostics or export the local PAB ledger.", ephemeral: true });
}

function memberManagementError(interaction, member) {
  return memberManagementIssue(member, {
    botMember: interaction.guild.members.me,
    guildOwnerId: interaction.guild.ownerId
  });
}

function roleManagementError(interaction, role) {
  return roleManagementIssue(role, { botMember: interaction.guild.members.me });
}

function discordPermissionError(error) {
  const code = error?.code || error?.rawError?.code;
  if (code === 50013) return "Discord denied that action (Missing Permissions). Run `/pab-health` and fix the listed bot or channel permission.";
  if (code === 50001) return "Ricky cannot access that Discord resource. Check the channel or role visibility and run `/pab-health`.";
  if (code === 10007) return "The selected member is no longer in this server. Run the command again.";
  if (code === 10011) return "The selected role no longer exists. Run the command again and choose a current role.";
  if (code === 10003) return "The selected channel no longer exists. Ask an administrator to update the protected channel IDs.";
  return null;
}

function modalReply(interaction, payload) {
  return interaction.deferred || interaction.replied
    ? interaction.editReply(payload)
    : interaction.reply({ ...payload, ephemeral: true });
}

async function requiresConfiguration(interaction) {
  const issues = configurationIssues(WORKFLOW_REQUIREMENTS[interaction.commandName] || []);
  if (issues.length) {
    await interaction.reply({ content: `This workflow is not ready yet: ${issues.map(issue => `\`${issue}\``).join(", ")}. A server administrator can run \`/setup-status\`.`, ephemeral: true });
    return true;
  }
  const botMember = interaction.guild.members.me;
  const channelIssues = [];
  for (const key of WORKFLOW_CHANNELS[interaction.commandName] || []) {
    try {
      const channel = await fetchChannel(config[key]);
      const issue = channelPermissionIssue(channel, botMember);
      if (issue) channelIssues.push(`${configLabels[key]}: ${issue}`);
    } catch (error) {
      channelIssues.push(`${configLabels[key] || key}: ${discordPermissionError(error) || "not accessible"}`);
    }
  }
  if (interaction.commandName === "inactivity-review") {
    for (const activityChannelId of config.activityChannelIds) {
      try {
        const channel = await fetchChannel(activityChannelId);
        const issue = channelPermissionIssue(channel, botMember, [PermissionFlagsBits.ViewChannel]);
        if (issue) channelIssues.push(`ACTIVITY_CHANNEL_IDS ${activityChannelId}: ${issue}`);
      } catch (error) {
        channelIssues.push(`ACTIVITY_CHANNEL_IDS ${activityChannelId}: ${discordPermissionError(error) || "not accessible"}`);
      }
    }
  }
  if (channelIssues.length) {
    await interaction.reply({ content: `This workflow is not ready because Ricky cannot use the configured destination: ${channelIssues.map(issue => `\`${issue}\``).join(", ")}. A server administrator can run \`/pab-health\`.`, ephemeral: true });
    return true;
  }
  return false;
}

function input(id, label, style, { placeholder, required = true, maxLength = 1000 } = {}) {
  return new TextInputBuilder()
    .setCustomId(id)
    .setLabel(label)
    .setStyle(style)
    .setPlaceholder(placeholder || "")
    .setRequired(required)
    .setMaxLength(maxLength);
}

function approvalRow(id, type, label = "Approve & post") {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`approve:${type}:${id}`).setLabel(label).setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`renew:${type}:${id}`).setLabel(`Renew ${ttlLabel()}`).setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`cancel:${type}:${id}`).setLabel("Cancel").setStyle(ButtonStyle.Secondary)
  );
}

function ttlLabel() {
  const minutes = config.pendingActionTtlMinutes;
  if (minutes % (24 * 60) === 0) return `${minutes / (24 * 60)}d`;
  if (minutes % 60 === 0) return `${minutes / 60}h`;
  return `${minutes}m`;
}

function expiryText(id) {
  const details = pending.details(id);
  if (!details) return "Expiry unavailable — rerun the command if this preview is stale.";
  return `Expires <t:${Math.floor(details.expiresAt / 1000)}:F> (<t:${Math.floor(details.expiresAt / 1000)}:R>)`;
}

function approvalLabel(type, stage = "final") {
  return {
    promotion: stage === "pab" ? "PAB review & forward" : "Command approve & apply",
    "role-removal": "Approve & remove",
    "promotion-check": "Approve checklist",
    "inactivity-review": "Post private review",
    announcement: "Approve & announce"
  }[type] || "Approve & post";
}

function approvalMentionUsers(data = {}) {
  return [...new Set([data.memberId, data.traineeId, data.trainerId].filter(Boolean))];
}

async function postApprovalRequest(interaction, id, type, data, embed, { commandLevel = false, stage = "final" } = {}) {
  const channel = await fetchChannel(config.pabApprovalsChannelId);
  const roles = [config.pabRoleId, commandLevel ? config.commandRoleId : null].filter(Boolean);
  const users = approvalMentionUsers(data);
  const prefix = roles.map(roleId => `<@&${roleId}>`).join(" ");
  const level = commandLevel ? "Command approval required after PAB review" : "PAB approval required";
  await channel.send({
    content: `${prefix} ${level} for ${data.memberLabel || data.traineeLabel || "this record"}. Submitted by <@${interaction.user.id}>. ${expiryText(id)}`,
    allowedMentions: { roles, users: [...new Set([...users, interaction.user.id])] },
    embeds: [embed],
    components: [approvalRow(id, type, approvalLabel(type, stage))]
  });
  if (rms) {
    try {
      const approvalStage = commandLevel ? "command" : stage === "pab" ? "pab" : "pab";
      rms.createApproval({ guildId: interaction.guild.id, sourceActionId: id, workflowType: type, stage: approvalStage, requestedBy: interaction.user.id, expiresAt: pending.details(id)?.expiresAt || null, notes: data.memberLabel || data.traineeLabel || null });
      rms.audit({ guildId: interaction.guild.id, actorDiscordId: interaction.user.id, action: "approval_requested", entityType: "approval", entityId: id, metadata: { workflowType: type, stage: approvalStage } });
    } catch (error) {
      logError("rms.approval-request", error, { workflowType: type, actionId: id });
    }
  }
}

function rmsApprovalDecision(interaction, actionId, status, notes = null) {
  if (!rms) return;
  try {
    const changes = rms.decideApprovalsForSource(interaction.guild.id, actionId, { status, decidedBy: interaction.user.id, notes });
    rms.audit({ guildId: interaction.guild.id, actorDiscordId: interaction.user.id, action: `approval_${status}`, entityType: "approval", entityId: actionId, metadata: { changes, status } });
  } catch (error) {
    logError("rms.approval-decision", error, { actionId, status });
  }
}

function rmsApprovalRenewal(interaction, actionId, expiresAt) {
  if (!rms) return;
  try {
    const changes = rms.renewApprovalsForSource(interaction.guild.id, actionId, expiresAt);
    rms.audit({ guildId: interaction.guild.id, actorDiscordId: interaction.user.id, action: "approval_renewed", entityType: "approval", entityId: actionId, metadata: { changes, expiresAt } });
  } catch (error) {
    logError("rms.approval-renewal", error, { actionId });
  }
}

function trainingEmbed(data, title = "BCSO Training Record") {
  return new EmbedBuilder()
    .setColor(BLUE)
    .setTitle(title)
    .addFields(
      { name: "Trainer", value: data.trainerLabel, inline: false },
      { name: "Trainee", value: data.traineeLabel, inline: false },
      { name: "Division / program", value: data.division, inline: true },
      { name: "Date", value: data.date, inline: true },
      { name: "Time", value: `${data.startTime} ${data.timeZoneLabel || config.timeZoneLabel} – ${data.endTime} ${data.timeZoneLabel || config.timeZoneLabel}`, inline: true },
      { name: "Session duration", value: data.duration || "Not calculated", inline: true },
      { name: "Training", value: data.trainingType, inline: false },
      { name: "Outcome", value: data.outcome, inline: false },
      { name: "Notes", value: data.notes, inline: false },
      { name: "Signed", value: `${data.signedBy}\n${data.signerRank}`, inline: false }
    )
    .setTimestamp();
}

function promotionEmbed(data, title = "Ricky Personnel Action — Promotion") {
  return new EmbedBuilder()
    .setColor(GREEN)
    .setTitle(title)
    .addFields(
      { name: "Member", value: data.memberLabel, inline: false },
      { name: "Previous rank", value: data.fromRank, inline: true },
      { name: "New rank", value: data.toRank, inline: true },
      { name: "Effective date", value: data.effectiveDate, inline: true },
      { name: "Authorized by", value: data.authorizedBy, inline: false },
      { name: "Reason / reference", value: data.reason, inline: false }
    )
    .setFooter({ text: "BCSO Personnel Administration Bureau" })
    .setTimestamp();
}

function roleAwardEmbed(data, title = "BCSO Qualification / Unit Role Award") {
  return new EmbedBuilder()
    .setColor(BLUE)
    .setTitle(title)
    .addFields(
      { name: "Member", value: data.memberLabel, inline: false },
      { name: "Role awarded", value: `<@&${data.roleId}> — ${data.roleName}`, inline: false },
      { name: "Effective date", value: data.effectiveDate, inline: true },
      { name: "Authorized by", value: data.authorizedBy, inline: true },
      { name: "Reason / reference", value: data.reason, inline: false }
    )
    .setFooter({ text: "Ricky PAB" })
    .setTimestamp();
}

function roleRemovalEmbed(data, title = "BCSO Qualification / Unit Role Removal") {
  return new EmbedBuilder()
    .setColor(0xb45309)
    .setTitle(title)
    .addFields(
      { name: "Member", value: data.memberLabel, inline: false },
      { name: "Role removed", value: `<@&${data.roleId}> — ${data.roleName}`, inline: false },
      { name: "Effective date", value: data.effectiveDate, inline: true },
      { name: "Authorized by", value: data.authorizedBy, inline: true },
      { name: "Reason / reference", value: data.reason, inline: false }
    )
    .setFooter({ text: "Ricky PAB" })
    .setTimestamp();
}

function departmentRecordText(data) {
  const added = data.addedRoleId ? `+ <@&${data.addedRoleId}>` : "+ None";
  const removed = data.removedRoleId ? `- <@&${data.removedRoleId}>` : "- None";
  const heading = config.brandEmoji
    ? `${config.brandEmoji} — BLAINE COUNTY SHERIFF'S OFFICE — ${config.brandEmoji}`
    : "— BLAINE COUNTY SHERIFF'S OFFICE —";
  return [
    `**${heading}**`,
    "*Blaine County Sheriff's Office | Department Record*",
    "⸻",
    `<@${data.memberId}>`,
    `**Callsign:** \`${data.callsign}\``,
    `**Record Type:** ${data.recordType}`,
    "**Roles Changed:**",
    added,
    removed,
    `**Note:** ${data.note}`,
    data.sourceMessageLink ? `**Source request:** [Open original request](${data.sourceMessageLink})` : null,
    `**Record ID:** \`${data.recordId}\``,
    `**CC:** <@&${config.pabRoleId}>${data.ccRoleId ? ` <@&${data.ccRoleId}>` : ""}`
  ].filter(Boolean).join("\n");
}

function recordEmbed(title, color, fields, footer = "Ricky PAB") {
  return new EmbedBuilder().setColor(color).setTitle(title).addFields(fields).setFooter({ text: footer }).setTimestamp();
}

function promotionCheckEmbed(data, title = "BCSO Promotion Eligibility Check") {
  const fields = [
    { name: "Member", value: data.memberLabel, inline: false },
    { name: "Rank under review", value: data.rank, inline: true },
    { name: "Requested rank", value: data.requestedRank, inline: true },
    { name: "Eligibility summary", value: data.eligibility, inline: false },
    { name: "Supporting reference", value: data.reference, inline: false },
    { name: "PAB recommendation", value: data.recommendation, inline: false }
  ];
  if (data.googleEligibility) fields.push({ name: "Google promotion evaluation (read-only)", value: clean(data.googleEligibility.join("\n"), 1024), inline: false });
  return recordEmbed(title, BLUE, fields, "Ricky PAB — This is not promotion approval");
}

function statusEmbed(data, title = "BCSO Personnel Status Record") {
  return recordEmbed(title, 0x6b7280, [
    { name: "Member", value: data.memberLabel, inline: false },
    { name: "Status", value: data.status, inline: true },
    { name: "Effective date", value: data.effectiveDate, inline: true },
    { name: "Authorized by", value: data.authorizedBy, inline: false },
    { name: "Record detail", value: data.detail, inline: false }
  ]);
}

function inactivityReviewEmbed(data, title = "BCSO PAB Inactivity Review") {
  return recordEmbed(title, 0xf59e0b, [
    { name: "Member", value: data.memberLabel, inline: false },
    { name: "Review period", value: data.reviewPeriod, inline: true },
    { name: "Last known activity", value: data.lastActivity, inline: true },
    { name: "Activity source", value: data.lastActivitySource || "PAB-provided — verify source", inline: true },
    { name: "Activity summary", value: data.summary, inline: false },
    { name: "PAB follow-up", value: data.followUp, inline: false }
  ], "Private PAB review — no role, access, or disciplinary action is applied");
}

function birthdayEmbed(member, month, day) {
  return recordEmbed("BCSO Birthday Announcement", BLUE, [
    { name: "Member", value: mentionWithLabel(member), inline: false },
    { name: "Message", value: `Please wish ${memberLabel(member)} a happy birthday!`, inline: false }
  ], "Opt-in birthday notice — month/day only");
}

function rosterSyncEmbed(result, sourceLabel = "Google Sheet roster") {
  const missing = result.missingDiscord.length
    ? result.missingDiscord.slice(0, 15).map(item => `• ${item.discordId} · ${item.callsign || item.displayName || "unnamed"}`).join("\n")
    : "None";
  const mismatches = result.mismatches.length
    ? result.mismatches.slice(0, 15).map(item => `• <@${item.discordId}> · sheet: **${item.expected}** · Discord: **${item.actual}**`).join("\n")
    : "None";
  const notInSheet = result.sheetOnlyIds.length ? `${result.sheetOnlyIds.length} Discord member(s) not represented in the sheet` : "None detected";
  return recordEmbed("Ricky Bot Roster Comparison", result.missingDiscord.length || result.mismatches.length ? 0xb45309 : GREEN, [
    { name: "Source", value: sourceLabel, inline: false },
    { name: "Rows read", value: String(result.totalRows), inline: true },
    { name: "Sheet IDs not in Discord", value: String(result.missingDiscord.length), inline: true },
    { name: "Rank mismatches", value: String(result.mismatches.length), inline: true },
    { name: "Sheet IDs not in Discord", value: clean(missing, 1024), inline: false },
    { name: "Rank mismatches — review only", value: clean(mismatches, 1024), inline: false },
    { name: "Discord members not in sheet", value: notInSheet, inline: false }
  ], "Read-only comparison — Ricky never changes roles from a spreadsheet");
}

function announcementEmbed(data, title = "BCSO PAB Announcement") {
  return new EmbedBuilder().setColor(BLUE).setTitle(title).setDescription(data.message).setFooter({ text: `Posted by ${data.authorName}` }).setTimestamp();
}

function correctionEmbed(data, title = "BCSO PAB Record Correction") {
  return recordEmbed(title, 0xdc2626, [
    { name: "Original record", value: `[Open original record](${data.messageLink})`, inline: false },
    { name: "Correction", value: data.correction, inline: false },
    { name: "Corrected by", value: data.correctedBy, inline: false }
    ], "Ricky PAB — Original records are preserved for auditability");
}

async function fetchChannel(id) {
  const channel = await client.channels.fetch(id);
  if (!channel?.isTextBased()) throw new Error(`Configured channel ${id} is not a text-based channel.`);
  if (channel.guildId !== config.guildId) throw new Error(`Configured channel ${id} is not in the configured BCSO server.`);
  return channel;
}

/**
 * Validate the configured guild, permissions, channels, and manageable roles
 * before the bot announces itself as ready. Runtime command checks remain in
 * place as a second line of defense when Discord settings change later.
 */
async function startupReadinessIssues(readyClient) {
  const issues = configurationIssues(Object.keys(configLabels));
  if (issues.length) return issues;

  let guild;
  try {
    guild = await readyClient.guilds.fetch(config.guildId);
  } catch {
    return [`DISCORD_GUILD_ID ${config.guildId} is not reachable by this bot`];
  }
  if (!guild || guild.id !== config.guildId) return ["configured guild could not be resolved"];

  try {
    const registered = await readyClient.application.commands.fetch({ guildId: config.guildId });
    const registeredNames = new Set(registered.map(command => command.name));
    const expectedNames = new Set(commands.map(command => command.name));
    const missingCommands = [...expectedNames].filter(name => !registeredNames.has(name));
    const unexpectedCommands = [...registeredNames].filter(name => !expectedNames.has(name));
    if (missingCommands.length) issues.push(`guild command registration is incomplete (missing: ${missingCommands.join(", ")})`);
    if (unexpectedCommands.length) issues.push(`guild command registration contains stale/unexpected commands: ${unexpectedCommands.join(", ")}`);
  } catch {
    issues.push("guild command registration could not be verified");
  }

  const botMember = await guild.members.fetchMe().catch(() => null);
  if (!botMember) return ["Ricky is not visible as a member of the configured guild"];

  const requiredBotPermissions = [
    [PermissionFlagsBits.ViewChannel, "View Channel"],
    [PermissionFlagsBits.SendMessages, "Send Messages"],
    [PermissionFlagsBits.EmbedLinks, "Embed Links"],
    [PermissionFlagsBits.ReadMessageHistory, "Read Message History"],
    [PermissionFlagsBits.ManageRoles, "Manage Roles"],
    [PermissionFlagsBits.AttachFiles, "Attach Files"]
  ];
  for (const [permission, label] of requiredBotPermissions) {
    if (!botMember.permissions.has(permission)) issues.push(`Ricky is missing the ${label} server permission`);
  }

  const destinationChannels = [
    ["TRAINING_RECORDS_CHANNEL_ID", config.trainingRecordsChannelId],
    ...(config.trainingRecordsForumChannelId ? [["TRAINING_RECORDS_FORUM_CHANNEL_ID", config.trainingRecordsForumChannelId, [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks, PermissionFlagsBits.CreatePublicThreads]]] : []),
    ["PERSONNEL_RECORDS_CHANNEL_ID", config.personnelRecordsChannelId],
    ...(config.personnelJacketsForumChannelId ? [["PERSONNEL_JACKETS_FORUM_CHANNEL_ID", config.personnelJacketsForumChannelId, [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks, PermissionFlagsBits.CreatePublicThreads]]] : []),
    ["PROMOTIONS_ANNOUNCEMENTS_CHANNEL_ID", config.promotionsAnnouncementsChannelId],
    ["AUDIT_LOG_CHANNEL_ID", config.auditLogChannelId],
    ["PAB_APPROVALS_CHANNEL_ID", config.pabApprovalsChannelId],
    ["QUALIFICATIONS_RECORDS_CHANNEL_ID", config.qualificationsRecordsChannelId],
    ["PAB_ANNOUNCEMENTS_CHANNEL_ID", config.pabAnnouncementsChannelId],
    ["INACTIVITY_REVIEW_CHANNEL_ID", config.inactivityReviewChannelId]
  ];
  for (const [label, id] of destinationChannels) {
    try {
      const channel = await fetchChannel(id);
      const issue = channelPermissionIssue(channel, botMember);
      if (issue) issues.push(`${label}: ${issue}`);
    } catch {
      issues.push(`${label} ${id} is invalid, inaccessible, or outside the configured guild`);
    }
  }
  for (const id of config.activityChannelIds) {
    try {
      const channel = await fetchChannel(id);
      const issue = channelPermissionIssue(channel, botMember, [PermissionFlagsBits.ViewChannel]);
      if (issue) issues.push(`ACTIVITY_CHANNEL_IDS ${id}: ${issue}`);
    } catch {
      issues.push(`ACTIVITY_CHANNEL_IDS ${id} is invalid, inaccessible, or outside the configured guild`);
    }
  }

  const pabRole = await guild.roles.fetch(config.pabRoleId).catch(() => null);
  const commandRole = await guild.roles.fetch(config.commandRoleId).catch(() => null);
  if (!pabRole) issues.push(`PAB_ROLE_ID ${config.pabRoleId} was not found in the configured guild`);
  if (!commandRole) issues.push(`COMMAND_ROLE_ID ${config.commandRoleId} was not found in the configured guild`);
  for (const { rank, id } of rankRoleEntries(config.rankRoleIds)) {
    const role = await guild.roles.fetch(id).catch(() => null);
    if (!role) issues.push(`RANK_ROLE_IDS.${rank} ${id} was not found in the configured guild`);
    else {
      const issue = roleManagementIssue(role, { botMember });
      if (issue) issues.push(`RANK_ROLE_IDS.${rank}: ${issue}`);
    }
  }
  for (const id of config.awardableRoleIds) {
    const role = await guild.roles.fetch(id).catch(() => null);
    if (!role) issues.push(`AWARDABLE_ROLE_IDS ${id} was not found in the configured guild`);
    else {
      const issue = roleManagementIssue(role, { botMember });
      if (issue) issues.push(`AWARDABLE_ROLE_IDS ${id}: ${issue}`);
    }
  }
  return issues;
}

async function audit(title, description) {
  const channel = await fetchChannel(config.auditLogChannelId);
  await channel.send({ embeds: [new EmbedBuilder().setColor(0x6b7280).setTitle(title).setDescription(clean(description, 4096)).setTimestamp()] });
}

function saveReceipt(type, interaction, action, message, recordId = null) {
  const receiptId = store.record({
    type,
    actorId: interaction.user.id,
    memberId: action.data.memberId || action.data.traineeId || null,
    recordId,
    message,
    data: action.data
  });
  if (!rms) return receiptId;
  try {
    rmsApprovalDecision(interaction, action.id, "approved");
    const memberId = action.data.memberId || action.data.traineeId || null;
    if (!memberId) return receiptId;
    const member = interaction.guild.members.cache.get(memberId);
    const label = String(action.data.memberLabel || action.data.traineeLabel || member?.displayName || memberId);
    const callsign = label.match(/\bC-?\d{1,4}\b/i)?.[0].replace(/^C(\d)/i, "C-$1").toUpperCase() || null;
    const rmsMember = rms.upsertMember({ guildId: interaction.guild.id, discordId: memberId, callsign, displayName: member?.displayName || label, rank: member ? rankNameForMember(member) : action.data.toRank || null, source: "discord" });
    const record = rms.createRecord({ guildId: interaction.guild.id, memberId: rmsMember.id, recordType: type, effectiveDate: action.data.effectiveDate || action.data.date || null, createdBy: interaction.user.id, sourceChannelId: message?.channelId, sourceMessageId: message?.id, sourceRecordId: receiptId, data: action.data });
    if (type === "training") rms.addTrainingRecord({ recordId: record.id, trainerDiscordId: action.data.trainerId || "unknown", division: action.data.division || null, trainingDate: action.data.date || "unknown", startTime: action.data.startTime || null, endTime: action.data.endTime || null, timeZone: action.data.timeZoneLabel || null, trainingType: action.data.trainingType || null, outcome: action.data.outcome || null, notes: action.data.notes || null });
    if (type === "promotion") rms.addPromotionRecord({ recordId: record.id, fromRank: action.data.fromRank || "unknown", toRank: action.data.toRank || "unknown", promotionDate: action.data.effectiveDate || "unknown", reason: action.data.reason || null, authorizationReference: action.data.authorizedBy || null });
    rms.audit({ guildId: interaction.guild.id, actorDiscordId: interaction.user.id, action: "record_finalized", entityType: "record", entityId: record.id, metadata: { recordType: type, discordReceiptId: receiptId } });
  } catch (error) {
    logError("rms.record-finalization", error, { recordType: type, discordReceiptId: receiptId });
  }
  return receiptId;
}

async function showTrainingModal(interaction) {
  const trainer = interaction.options.getMember("trainer");
  const trainee = interaction.options.getMember("trainee");
  if (!trainer || !trainee) return interaction.reply({ content: "Both members must be in this server.", ephemeral: true });
  const timezone = resolveTrainingTimeZone(interaction.options.getString("timezone"), { label: config.timeZoneLabel, timeZoneId: config.timeZoneId });
  const division = clean(interaction.options.getString("division"), 80) || "BCSO / POST Academy";
  const dateMode = interaction.options.getString("date") || "manual";
  const selectedStart = interaction.options.getString("start-time");
  const selectedEnd = interaction.options.getString("end-time");
  if (Boolean(selectedStart) !== Boolean(selectedEnd)) return interaction.reply({ content: "Choose both Start time and End time, or leave both blank and enter the range in the form.", ephemeral: true });
  const modal = new ModalBuilder().setCustomId(`training-modal:${trainer.id}:${trainee.id}:${timezone.value}:${encodeURIComponent(division)}`).setTitle(`BCSO training record — ${timezone.label}`);
  const dateInput = input("date", `Date (${DATE_FORMAT_HINT})`, TextInputStyle.Short, { placeholder: DATE_FORMAT_HINT, maxLength: 64 });
  const timeInput = input("time", `Start/end time (${timezone.label})`, TextInputStyle.Short, { placeholder: `4:00 PM - 5:00 PM ${timezone.label}`, maxLength: 80 });
  if (selectedStart && selectedEnd) timeInput.setValue(`${selectedStart} - ${selectedEnd} ${timezone.label}`);
  if (dateMode === "today") dateInput.setValue(todayInTimeZone(timezone.timeZoneId));
  modal.addComponents(
    new ActionRowBuilder().addComponents(dateInput),
    new ActionRowBuilder().addComponents(timeInput),
    new ActionRowBuilder().addComponents(input("training-type", "Training completed", TextInputStyle.Short, { placeholder: "Classroom, practical, and ride-along", maxLength: 200 })),
    new ActionRowBuilder().addComponents(input("outcome", "Outcome / recommendation", TextInputStyle.Paragraph, { placeholder: "Academy Complete — good to proceed to Deputy", maxLength: 800 })),
    new ActionRowBuilder().addComponents(input("notes", "Notes", TextInputStyle.Paragraph, { placeholder: "Performance, follow-up needs, and any important detail", maxLength: 1000 }))
  );
  return interaction.showModal(modal);
}

async function showPromotionModal(interaction) {
  const member = interaction.options.getMember("member");
  if (!member) return interaction.reply({ content: "That member must be in this server.", ephemeral: true });
  const managementIssue = memberManagementError(interaction, member);
  if (managementIssue) return interaction.reply({ content: managementIssue, ephemeral: true });
  const choices = rankRoleEntries(config.rankRoleIds).map(({ rank }) => rank).join(", ") || "Configure RANK_ROLE_IDS first";
  const modal = new ModalBuilder().setCustomId(`promotion-modal:${member.id}`).setTitle("BCSO promotion record");
  const effectiveDate = input("effective-date", `Effective date (${DATE_FORMAT_HINT})`, TextInputStyle.Short, { placeholder: DATE_FORMAT_HINT, maxLength: 64 });
  if (interaction.options.getString("date") === "today") effectiveDate.setValue(todayInTimeZone(config.timeZoneId));
  modal.addComponents(
    new ActionRowBuilder().addComponents(effectiveDate),
    new ActionRowBuilder().addComponents(input("from-rank", "Current rank", TextInputStyle.Short, { placeholder: choices, maxLength: 80 })),
    new ActionRowBuilder().addComponents(input("to-rank", "New rank", TextInputStyle.Short, { placeholder: choices, maxLength: 80 })),
    new ActionRowBuilder().addComponents(input("authorized-by", "Authorized by", TextInputStyle.Short, { placeholder: "Sheriff / Undersheriff / Command member", maxLength: 200 })),
    new ActionRowBuilder().addComponents(input("reason", "Reason or approval reference", TextInputStyle.Paragraph, { placeholder: "Completed POST Academy and probationary requirements", maxLength: 1000 }))
  );
  return interaction.showModal(modal);
}

async function showRoleAwardModal(interaction) {
  const member = interaction.options.getMember("member");
  const role = interaction.options.getRole("role");
  if (!member || !role) return interaction.reply({ content: "The member and role must be available in this server.", ephemeral: true });
  if (!isApprovedAwardRole(role)) return interaction.reply({ content: awardRoleEligibilityMessage(role, "award"), ephemeral: true });
  const memberIssue = memberManagementError(interaction, member);
  if (memberIssue) return interaction.reply({ content: memberIssue, ephemeral: true });
  const roleIssue = roleManagementError(interaction, role);
  if (roleIssue) return interaction.reply({ content: roleIssue, ephemeral: true });
  const modal = new ModalBuilder().setCustomId(`role-award-modal:${member.id}:${role.id}`).setTitle("BCSO role award record");
  const effectiveDate = input("effective-date", `Effective date (${DATE_FORMAT_HINT})`, TextInputStyle.Short, { placeholder: DATE_FORMAT_HINT, maxLength: 64 });
  if (interaction.options.getString("date") === "today") effectiveDate.setValue(todayInTimeZone(config.timeZoneId));
  modal.addComponents(
    new ActionRowBuilder().addComponents(effectiveDate),
    new ActionRowBuilder().addComponents(input("authorized-by", "Authorized by", TextInputStyle.Short, { placeholder: "PAB / Command member", maxLength: 200 })),
    new ActionRowBuilder().addComponents(input("reason", "Reason or approval reference", TextInputStyle.Paragraph, { placeholder: "Completed TEU certification requirements", maxLength: 1000 }))
  );
  return interaction.showModal(modal);
}

async function showRoleRemovalModal(interaction) {
  const member = interaction.options.getMember("member");
  const role = interaction.options.getRole("role");
  if (!member || !role) return interaction.reply({ content: "The member and role must be available in this server.", ephemeral: true });
  if (!isApprovedAwardRole(role)) return interaction.reply({ content: awardRoleEligibilityMessage(role, "removal"), ephemeral: true });
  const memberIssue = memberManagementError(interaction, member);
  if (memberIssue) return interaction.reply({ content: memberIssue, ephemeral: true });
  const roleIssue = roleManagementError(interaction, role);
  if (roleIssue) return interaction.reply({ content: roleIssue, ephemeral: true });
  if (!member.roles.cache.has(role.id)) return interaction.reply({ content: "That member does not currently hold the selected role.", ephemeral: true });
  const modal = new ModalBuilder().setCustomId(`role-removal-modal:${member.id}:${role.id}`).setTitle("BCSO role removal record");
  const effectiveDate = input("effective-date", `Effective date (${DATE_FORMAT_HINT})`, TextInputStyle.Short, { placeholder: DATE_FORMAT_HINT, maxLength: 64 });
  if (interaction.options.getString("date") === "today") effectiveDate.setValue(todayInTimeZone(config.timeZoneId));
  modal.addComponents(
    new ActionRowBuilder().addComponents(effectiveDate),
    new ActionRowBuilder().addComponents(input("authorized-by", "Authorized by", TextInputStyle.Short, { placeholder: "PAB / Command member", maxLength: 200 })),
    new ActionRowBuilder().addComponents(input("reason", "Reason or approval reference", TextInputStyle.Paragraph, { placeholder: "Transfer, expiration, or approved removal reference", maxLength: 1000 }))
  );
  return interaction.showModal(modal);
}

async function showDepartmentRecordModal(interaction) {
  const member = interaction.options.getMember("member");
  if (!member) return interaction.reply({ content: "That member must be in this server.", ephemeral: true });
  const callsign = clean(interaction.options.getString("callsign"), 32);
  const addedRole = interaction.options.getRole("added-role");
  const removedRole = interaction.options.getRole("removed-role");
  const ccRole = interaction.options.getRole("cc-role");
  const sourceLink = clean(interaction.options.getString("source-link"), 300);
  const source = sourceLink ? parseDiscordMessageLink(sourceLink, config.guildId) : null;
  if (sourceLink && !source) return interaction.reply({ content: "The optional source link must be a message link from this BCSO server.", ephemeral: true });
  const draftId = pending.create({ type: "department-record-draft", createdBy: interaction.user.id, data: { memberId: member.id, callsign, addedRoleId: addedRole?.id || null, removedRoleId: removedRole?.id || null, ccRoleId: ccRole?.id || null, sourceMessageLink: source?.messageLink || null } });
  const modal = new ModalBuilder().setCustomId(`department-record-modal:${draftId}`).setTitle("PAB department record");
  modal.addComponents(
    new ActionRowBuilder().addComponents(input("record-type", "Record type", TextInputStyle.Short, { placeholder: "Training completion, promotion, role update", maxLength: 100 })),
    new ActionRowBuilder().addComponents(input("note", "Approved note", TextInputStyle.Paragraph, { placeholder: "Clear factual summary for the department record", maxLength: 1000 }))
  );
  return interaction.showModal(modal);
}

async function showCorrectionModal(interaction) {
  const reference = parseDiscordMessageLink(interaction.options.getString("message-link"), config.guildId);
  if (!reference) return interaction.reply({ content: "Use **Copy Message Link** from a record in this BCSO server. The original record is never edited or deleted.", ephemeral: true });
  const draftId = pending.create({ type: "correction-draft", createdBy: interaction.user.id, data: reference });
  const modal = new ModalBuilder().setCustomId(`correction-modal:${draftId}`).setTitle("PAB record correction");
  modal.addComponents(new ActionRowBuilder().addComponents(input("correction", "Correction / clarification", TextInputStyle.Paragraph, { placeholder: "State the corrected information clearly and factually.", maxLength: 1000 })));
  return interaction.showModal(modal);
}

async function showPromotionCheckModal(interaction) {
  const member = interaction.options.getMember("member");
  if (!member) return interaction.reply({ content: "That member must be in this server.", ephemeral: true });
  const draftId = pending.create({ type: "promotion-check-draft", createdBy: interaction.user.id, data: { memberId: member.id } });
  const modal = new ModalBuilder().setCustomId(`promotion-check-modal:${draftId}`).setTitle("PAB promotion eligibility check");
  modal.addComponents(
    new ActionRowBuilder().addComponents(input("rank", "Current rank", TextInputStyle.Short, { placeholder: "Deputy", maxLength: 80 })),
    new ActionRowBuilder().addComponents(input("requested-rank", "Rank under consideration", TextInputStyle.Short, { placeholder: "Senior Deputy", maxLength: 80 })),
    new ActionRowBuilder().addComponents(input("eligibility", "Eligibility summary", TextInputStyle.Paragraph, { placeholder: "Human review of the current BCSO requirements", maxLength: 800 })),
    new ActionRowBuilder().addComponents(input("reference", "Supporting record / reference", TextInputStyle.Paragraph, { placeholder: "Relevant training, time-in-rank, or Command reference", maxLength: 800 })),
    new ActionRowBuilder().addComponents(input("recommendation", "PAB recommendation", TextInputStyle.Paragraph, { placeholder: "Eligible to submit / hold / needs review", maxLength: 800 }))
  );
  return interaction.showModal(modal);
}

async function showPersonnelStatusModal(interaction) {
  const member = interaction.options.getMember("member");
  if (!member) return interaction.reply({ content: "That member must be in this server.", ephemeral: true });
  const status = interaction.options.getString("status");
  const draftId = pending.create({ type: "personnel-status-draft", createdBy: interaction.user.id, data: { memberId: member.id, status } });
  const modal = new ModalBuilder().setCustomId(`personnel-status-modal:${draftId}`).setTitle("BCSO personnel status record");
  const effectiveDate = input("effective-date", `Effective date (${DATE_FORMAT_HINT})`, TextInputStyle.Short, { placeholder: DATE_FORMAT_HINT, maxLength: 64 });
  if (interaction.options.getString("date") === "today") effectiveDate.setValue(todayInTimeZone(config.timeZoneId));
  modal.addComponents(
    new ActionRowBuilder().addComponents(effectiveDate),
    new ActionRowBuilder().addComponents(input("authorized-by", "Authorized by", TextInputStyle.Short, { placeholder: "Command member / approval reference", maxLength: 200 })),
    new ActionRowBuilder().addComponents(input("detail", "Record detail", TextInputStyle.Paragraph, { placeholder: "Factual status details and any approved follow-up", maxLength: 1000 }))
  );
  return interaction.showModal(modal);
}

async function showInactivityReviewModal(interaction) {
  const member = interaction.options.getMember("member");
  if (!member) return interaction.reply({ content: "That member must be in this server.", ephemeral: true });
  const draftId = pending.create({ type: "inactivity-review-draft", createdBy: interaction.user.id, data: { memberId: member.id } });
  const modal = new ModalBuilder().setCustomId(`inactivity-review-modal:${draftId}`).setTitle("PAB inactivity review");
  modal.addComponents(
    new ActionRowBuilder().addComponents(input("review-period", `Review period (${DATE_RANGE_FORMAT_HINT})`, TextInputStyle.Short, { placeholder: DATE_RANGE_FORMAT_HINT, maxLength: 80 })),
    new ActionRowBuilder().addComponents(input("last-activity", "Last known activity (optional override)", TextInputStyle.Short, { placeholder: "Leave blank to use Ricky's last tracked activity", required: false, maxLength: 80 })),
    new ActionRowBuilder().addComponents(input("summary", "Activity summary", TextInputStyle.Paragraph, { placeholder: "Factual attendance or activity notes for PAB review", maxLength: 1000 })),
    new ActionRowBuilder().addComponents(input("follow-up", "PAB follow-up", TextInputStyle.Paragraph, { placeholder: "Contact member / confirm status / no follow-up needed", maxLength: 1000 }))
  );
  return interaction.showModal(modal);
}

async function showAnnouncementModal(interaction) {
  const notifyRole = interaction.options.getRole("notify-role");
  if (notifyRole && !isNotifiableRole(notifyRole, interaction.guild.members.me)) return interaction.reply({ content: "Choose a mentionable, normal BCSO notification role. @everyone, managed roles, administrator roles, and roles Ricky cannot mention are blocked.", ephemeral: true });
  const draftId = pending.create({ type: "announcement-draft", createdBy: interaction.user.id, data: { notifyRoleId: notifyRole?.id || null } });
  const modal = new ModalBuilder().setCustomId(`announcement-modal:${draftId}`).setTitle("PAB announcement");
  modal.addComponents(
    new ActionRowBuilder().addComponents(input("title", "Announcement title", TextInputStyle.Short, { placeholder: "PAB Update", maxLength: 200 })),
    new ActionRowBuilder().addComponents(input("message", "Announcement message", TextInputStyle.Paragraph, { placeholder: "Clear, approved announcement text", maxLength: 1800 }))
  );
  return interaction.showModal(modal);
}

async function showMemberProfile(interaction) {
  const member = interaction.options.getMember("member");
  if (!member) return interaction.reply({ content: "That member must be in this server.", ephemeral: true });
  const roles = member.roles.cache.filter(role => role.id !== interaction.guild.id).sort((a, b) => b.position - a.position).map(role => `<@&${role.id}>`).join(" ") || "No assigned roles";
  const rank = rankNameForMember(member);
  return interaction.reply({
    ephemeral: true,
    embeds: [recordEmbed("PAB Member Snapshot", BLUE, [
      { name: "Member", value: mentionWithLabel(member), inline: false },
      { name: "Current rank", value: rank, inline: true },
      { name: "Joined server", value: member.joinedTimestamp ? `<t:${Math.floor(member.joinedTimestamp / 1000)}:D>` : "Unavailable", inline: true },
      { name: "Current roles", value: clean(roles, 1024), inline: false }
    ], "Live Discord role snapshot — not a personnel or IA history")],
    allowedMentions: { parse: [] }
  });
}

function setupStatusEmbed() {
  const keys = Object.keys(configLabels);
  const issues = configurationIssues(keys);
  const complete = keys.filter(key => !issues.some(issue => issue.startsWith(configLabels[key])));
  return recordEmbed("Ricky Setup Status", issues.length ? 0xb45309 : GREEN, [
    { name: "Ready", value: complete.length ? complete.map(key => `✓ ${configLabels[key]}`).join("\n") : "Nothing configured yet.", inline: false },
    { name: "Needs server-admin configuration", value: issues.length ? issues.map(issue => `• ${issue}`).join("\n") : "All required IDs and allow-lists are configured.", inline: false },
    { name: "Next step", value: issues.length ? "Copy the needed IDs in Discord Developer Mode, update the protected `.env`, then run `/pab-health`." : "Run `/pab-health`, register commands if needed, and complete a sandbox record before live use.", inline: false }
  ], "No token values are ever displayed");
}

function dashboardEmbed() {
  const summary = store.summary();
  const pendingItems = store.listPending(5);
  const recent = store.findRecords({ limit: 5 });
  const pendingText = pendingItems.length
    ? pendingItems.map(item => `• ${item.type} · expires <t:${Math.floor(item.expiresAt / 1000)}:R>`).join("\n")
    : "No pending previews.";
  const recentText = recent.length
    ? recent.map(item => `${item.messageUrl ? `[${item.type}](${item.messageUrl})` : item.type} · <t:${Math.floor(item.createdAt / 1000)}:R>`).join("\n")
    : "No completed records in the local ledger yet.";
  return recordEmbed("Ricky BCSO PAB Control Panel", BLUE, [
    { name: "Completed bot records", value: String(summary.completed), inline: true },
    { name: "Open approvals", value: String(summary.pending), inline: true },
    { name: "Last completed", value: summary.latestAt ? `<t:${Math.floor(summary.latestAt / 1000)}:R>` : "No records yet", inline: true },
    { name: "Open queue", value: pendingText, inline: false },
    { name: "Recent activity", value: recentText, inline: false },
    { name: "Quick workflow", value: "`/department-record` · `/training-log` · `/promotion` · `/inactivity-review`", inline: false }
  ], "PAB-only control surface");
}

function recordSearchEmbed(records, queryLabel) {
  const entries = records.length
    ? records.map(item => {
      const link = item.messageUrl ? `[Open record](${item.messageUrl})` : "Receipt only";
      const reference = item.recordId ? ` · ${item.recordId}` : "";
      return `• **${item.type}**${reference} · ${link} · <t:${Math.floor(item.createdAt / 1000)}:d>`;
    }).join("\n")
    : "No matching bot-posted records were found in the local ledger.";
  return recordEmbed("PAB Record Search", BLUE, [{ name: queryLabel, value: clean(entries, 1024), inline: false }]);
}

async function runHealthCheck(interaction) {
  // The live check performs many Discord fetches. Acknowledge the command
  // before those network calls so Discord does not show “The application did
  // not respond” when the diagnostic takes longer than the initial window.
  await interaction.deferReply({ ephemeral: true });
  const configuredChannels = [
    ["Training records", config.trainingRecordsChannelId], ["Personnel records", config.personnelRecordsChannelId],
    ["Promotion announcements", config.promotionsAnnouncementsChannelId], ["PAB audit log", config.auditLogChannelId],
    ["PAB approvals", config.pabApprovalsChannelId], ["Qualification records", config.qualificationsRecordsChannelId],
    ["PAB announcements", config.pabAnnouncementsChannelId], ["Inactivity review", config.inactivityReviewChannelId],
    ["Birthday announcements (optional)", config.birthdayChannelId], ["Service milestones (optional)", config.serviceMilestonesChannelId],
    ["Training records Forum (optional)", config.trainingRecordsForumChannelId, [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks, PermissionFlagsBits.CreatePublicThreads]],
    ["Personnel jackets Forum (optional)", config.personnelJacketsForumChannelId, [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks, PermissionFlagsBits.CreatePublicThreads]],
    ...[...config.activityChannelIds].map(id => [`Activity source ${id}`, id, [PermissionFlagsBits.ViewChannel]])
  ];
  const missing = missingConfiguration(Object.keys(configLabels));
  const botMember = interaction.guild.members.me;
  const botPermissionChecks = [
    [PermissionFlagsBits.ViewChannel, "View Channel"],
    [PermissionFlagsBits.SendMessages, "Send Messages"],
    [PermissionFlagsBits.EmbedLinks, "Embed Links"],
    [PermissionFlagsBits.ReadMessageHistory, "Read Message History"],
    [PermissionFlagsBits.ManageRoles, "Manage Roles"],
    [PermissionFlagsBits.AttachFiles, "Attach Files"]
  ];
  const botPermissions = botMember
    ? botPermissionChecks.map(([permission, label]) => `${botMember.permissions.has(permission) ? "✓" : "✗"} ${label}`).join("\n")
    : "✗ Ricky is not currently visible as a server member.";
  const channelChecks = [];
  for (const [label, id, requiredPermissions] of configuredChannels) {
    if (!id) { channelChecks.push(`• ${label}: not configured`); continue; }
    try {
      const channel = await fetchChannel(id);
      const issue = channelPermissionIssue(channel, botMember, requiredPermissions);
      channelChecks.push(`${issue ? "✗" : "✓"} ${label}: ${issue || "reachable"}`);
    } catch {
      channelChecks.push(`✗ ${label}: invalid, inaccessible, or outside this server`);
    }
  }
  const roleChecks = [];
  const botHighestRole = botMember?.roles?.highest;
  const hierarchySummary = botHighestRole
    ? `Ricky's highest assigned role is **${botHighestRole.name}** (position ${botHighestRole.position}). Move this actual assigned role above every configured rank or award role Ricky must manage. Moving an unassigned role will not change Ricky's permissions.`
    : "Ricky's highest assigned role could not be resolved.";
  const roleTargets = [
    ["PAB", config.pabRoleId, false], ["Command", config.commandRoleId, false],
    ...rankRoleEntries(config.rankRoleIds).map(item => [`Rank: ${item.rank}`, item.id, true]),
    ...[...config.awardableRoleIds].map(id => ["Allow-listed role", id, true])
  ];
  for (const [label, id, requiresManagement] of roleTargets) {
    if (!id) { roleChecks.push(`• ${label}: not configured`); continue; }
    const role = await interaction.guild.roles.fetch(id).catch(() => null);
    if (!role) roleChecks.push(`✗ ${label}: role not found`);
    else if ((label === "PAB" || label === "Command") && !isNotifiableRole(role, botMember)) roleChecks.push(`✗ ${label}: found but not mentionable (or elevated/managed)`);
    else if (requiresManagement) {
      const issue = roleManagementError(interaction, role);
      roleChecks.push(`${issue ? "✗" : "✓"} ${label}: ${issue || "manageable"}`);
    }
    else roleChecks.push(`✓ ${label}: found`);
  }
  return interaction.editReply({
    embeds: [recordEmbed("Ricky Live Health Check", missing.length ? 0xb45309 : GREEN, [
      { name: "Configuration", value: missing.length ? `Missing: ${missing.join(", ")}` : "All required IDs and allow-lists are present.", inline: false },
      { name: "Bot permissions", value: botPermissions, inline: false },
      { name: "Channels", value: clean(channelChecks.join("\n"), 1024), inline: false },
      { name: "Optional integrations", value: `Birthday notices: ${config.birthdayChannelId ? "configured" : "disabled"}\nService milestones: ${config.serviceMilestonesChannelId ? "configured" : "disabled"}\nGoogle roster comparison: ${config.googleSheetsEnabled ? (rosterSheet.configured ? "enabled/configured" : "enabled/incomplete") : (config.googleSheetsSpreadsheetId ? "staged (disabled)" : "disabled")}\nGoogle promotion evaluation: ${config.googlePromotionTestsEnabled ? (promotionTestsSheet.configured ? "enabled/configured" : "enabled/incomplete") : (config.googlePromotionTestsSpreadsheetId ? "staged (disabled)" : "disabled")}`, inline: false },
      { name: "Role hierarchy", value: clean(`${hierarchySummary}\n\n${roleChecks.join("\n") || "No rank/award roles configured yet."}`, 1024), inline: false }
    ], "Read-only check — no settings, roles, or messages were changed")]
  });
}

async function runRosterSync(interaction) {
  if (!config.googleSheetsEnabled) {
    return interaction.reply({ content: "Google Sheets roster comparison is staged but disabled. A server administrator must set `GOOGLE_SHEETS_ENABLED=true`, confirm the protected service-account credentials and range, then restart Ricky Bot before `/roster-sync` can run.", ephemeral: true });
  }
  if (!rosterSheet.configured) {
    return interaction.reply({ content: "Google Sheets comparison is enabled but incomplete. Set `GOOGLE_SHEETS_SPREADSHEET_ID`, `GOOGLE_SHEETS_RANGE`, and `GOOGLE_SHEETS_SERVICE_ACCOUNT_JSON`, share the sheet with the service-account email, then restart Ricky Bot.", ephemeral: true });
  }
  await interaction.deferReply({ ephemeral: true });
  try {
    const rows = await rosterSheet.rows();
    const members = [...(await interaction.guild.members.fetch()).values()];
    const result = compareRosterRows(rows, members, config.rankRoleIds);
    await interaction.editReply({ embeds: [rosterSyncEmbed(result, `Google Sheets · ${config.googleSheetsRange}`)] });
  } catch (error) {
    await interaction.editReply({ content: `Google Sheets comparison failed: ${error instanceof Error ? error.message : "unknown error"}` });
  }
}

function parseTodayParts() {
  const [month, day, year] = todayInTimeZone(config.timeZoneId).split("/").map(Number);
  return { month, day, year };
}

function localDateParts(timeZone, value) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "numeric", day: "numeric" }).formatToParts(value);
  return Object.fromEntries(parts.filter(({ type }) => type !== "literal").map(({ type, value: part }) => [type, Number(part)]));
}

function monthsSince(timestamp, timeZone = config.timeZoneId, now = new Date()) {
  const joined = localDateParts(timeZone, new Date(timestamp));
  const current = localDateParts(timeZone, now);
  const months = (current.year - joined.year) * 12 + current.month - joined.month;
  return current.day === joined.day ? months : -1;
}

function monthsSinceDateText(dateText, timeZone = config.timeZoneId, now = new Date()) {
  const match = String(dateText || "").match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) return -1;
  const joined = { month: Number(match[1]), day: Number(match[2]), year: Number(match[3]) };
  const current = localDateParts(timeZone, now);
  const months = (current.year - joined.year) * 12 + current.month - joined.month;
  return current.day === joined.day ? months : -1;
}

async function postDailyNotices(readyClient) {
  const guild = await readyClient.guilds.fetch(config.guildId).catch(() => null);
  if (!guild) return;
  const { month, day, year } = parseTodayParts();
  const members = [...(await guild.members.fetch()).values()].filter(member => !member.user.bot);
  if (config.birthdayChannelId) {
    const channel = await fetchChannel(config.birthdayChannelId).catch(() => null);
    if (channel) {
      for (const entry of store.birthdaysOn(guild.id, month, day)) {
        const member = members.find(candidate => candidate.id === entry.memberId);
        const marker = `birthday:${guild.id}:${entry.memberId}:${year}`;
        if (!member || store.hasDelivered(marker)) continue;
        const message = await channel.send({ content: `🎂 <@${member.id}>`, embeds: [birthdayEmbed(member, month, day)], allowedMentions: { users: [member.id] } });
        if (message) store.markDelivered(marker);
      }
    }
  }
  if (config.serviceMilestonesChannelId) {
    const channel = await fetchChannel(config.serviceMilestonesChannelId).catch(() => null);
    if (channel) {
      for (const member of members) {
        if (!member.joinedTimestamp) continue;
        const months = monthsSince(member.joinedTimestamp);
        if (![1, 3, 6, 12].includes(months) && (months < 12 || months % 12 !== 0)) continue;
        const marker = `service:${guild.id}:${member.id}:${year}:${months}`;
        if (store.hasDelivered(marker)) continue;
        const label = months < 12 ? `${months}-month` : `${Math.floor(months / 12)}-year`;
        const message = await channel.send({ content: `🎉 <@${member.id}>`, embeds: [recordEmbed("BCSO Service Milestone", GREEN, [
          { name: "Member", value: mentionWithLabel(member), inline: false },
          { name: "Milestone", value: `${label} anniversary`, inline: true },
          { name: "Source", value: "Discord server join date; verify against the official roster when appropriate.", inline: false }
        ], "Automatic notice — no rank or personnel decision")], allowedMentions: { users: [member.id] } });
        if (message) store.markDelivered(marker);
      }
      const promotion = store.latestPromotion(member.id);
      const rankMonths = promotion?.data?.effectiveDate ? monthsSinceDateText(promotion.data.effectiveDate) : -1;
      if (promotion && ([1, 3, 6, 12].includes(rankMonths) || (rankMonths >= 12 && rankMonths % 12 === 0))) {
        const marker = `rank:${guild.id}:${member.id}:${promotion.id}:${year}:${rankMonths}`;
        if (!store.hasDelivered(marker)) {
          const label = rankMonths < 12 ? `${rankMonths}-month` : `${Math.floor(rankMonths / 12)}-year`;
          const message = await channel.send({ content: `🏅 <@${member.id}>`, embeds: [recordEmbed("BCSO Rank Anniversary", BLUE, [
            { name: "Member", value: mentionWithLabel(member), inline: false },
            { name: "Rank", value: promotion.data.toRank || "Configured rank", inline: true },
            { name: "Milestone", value: `${label} in rank`, inline: true },
            { name: "Source", value: "Ricky promotion receipt; informational only.", inline: false }
          ], "Automatic notice — no promotion or personnel decision")], allowedMentions: { users: [member.id] } });
          if (message) store.markDelivered(marker);
        }
      }
    }
  }
}

async function syncRmsMembers(guild) {
  if (!rms) return;
  const members = [...(await guild.members.fetch()).values()].filter(member => !member.user.bot);
  for (const member of members) {
    const callsign = member.displayName.match(/\bC-?\d{1,4}\b/i)?.[0].replace(/^C(\d)/i, "C-$1").toUpperCase() || null;
    rms.upsertMember({ guildId: guild.id, discordId: member.id, callsign, displayName: member.displayName, rank: rankNameForMember(member), joinedAt: member.joinedTimestamp, source: "discord-sync" });
  }
  rms.audit({ guildId: guild.id, actorDiscordId: "system", action: "member_sync", entityType: "member", metadata: { count: members.length } });
}

async function sendPendingReminders() {
  const destinationId = config.pabApprovalsChannelId || config.auditLogChannelId;
  if (!destinationId) return;
  const channel = await fetchChannel(destinationId).catch(() => null);
  if (!channel) return;
  for (const item of pending.expiring(config.pendingReminderMinutes)) {
    try {
      const awaitingCommand = item.type === "promotion" && item.data?.pabApprovedBy;
      const roles = awaitingCommand ? [config.commandRoleId].filter(Boolean) : [config.pabRoleId].filter(Boolean);
      const roleMentions = roles.map(roleId => `<@&${roleId}>`).join(" ");
      const sent = await channel.send({
        content: `${roleMentions} ⏰ Approval reminder: **${approvalLabel(item.type, awaitingCommand ? "final" : item.type === "promotion" ? "pab" : "final")}** submitted by <@${item.createdBy}> expires <t:${Math.floor(item.expiresAt / 1000)}:F> (<t:${Math.floor(item.expiresAt / 1000)}:R>). Use the original preview's **Renew** button if more review time is needed.`,
        allowedMentions: { roles, users: [item.createdBy] }
      });
      if (sent) pending.markReminder(item.id);
    } catch (error) {
      console.error(`Pending approval reminder failed: ${error instanceof Error ? error.message : "unknown error"}`);
    }
  }
}

function exportAudit(interaction) {
  const payload = {
    exportedAt: new Date().toISOString(),
    guildId: config.guildId,
    records: store.exportRecords()
  };
  const attachment = new AttachmentBuilder(Buffer.from(JSON.stringify(payload, null, 2)), { name: `bcso-pab-audit-${new Date().toISOString().slice(0, 10)}.json` });
  return interaction.reply({ content: "Private local-ledger export. Handle it as PAB personnel data.", files: [attachment], ephemeral: true });
}

function findRecord(interaction) {
  const member = interaction.options.getMember("member");
  const recordId = clean(interaction.options.getString("record-id"), 80).toUpperCase();
  if (!member && !recordId) return interaction.reply({ content: "Choose a member or enter a PAB record ID.", ephemeral: true });
  const records = store.findRecords({ memberId: member?.id || null, recordId: recordId || null, limit: 10 });
  const label = member ? `Records for ${mentionWithLabel(member)}` : `Record ID: ${recordId}`;
  return interaction.reply({ embeds: [recordSearchEmbed(records, label)], ephemeral: true, allowedMentions: { parse: [] } });
}

function personnelHistory(interaction) {
  const member = interaction.options.getMember("member");
  if (!member) return interaction.reply({ content: "That member must be in this server.", ephemeral: true });
  const records = store.findRecords({ memberId: member.id, limit: 50 });
  return interaction.reply({
    embeds: [recordSearchEmbed(records, `Personnel history for ${mentionWithLabel(member)}`)],
    ephemeral: true,
    allowedMentions: { parse: [] }
  });
}

async function handleModal(interaction) {
  const modalParts = interaction.customId.split(":");
  const kind = modalParts[0];
  if (kind === "training-modal") {
    const [, trainerId, traineeId, timezoneValue, divisionValue] = modalParts;
    const timezone = resolveTrainingTimeZone(timezoneValue, { label: config.timeZoneLabel, timeZoneId: config.timeZoneId });
    const division = clean(divisionValue ? decodeURIComponent(divisionValue) : "BCSO / POST Academy", 80);
    const [trainer, trainee] = await Promise.all([interaction.guild.members.fetch(trainerId), interaction.guild.members.fetch(traineeId)]);
    const [startTime, endTime] = splitTimeRange(interaction.fields.getTextInputValue("time"), timezone.label);
    if (!startTime || !endTime) return modalReply(interaction, { content: `Enter a time range such as \`4 PM - 5 PM\` or \`4:00 PM - 5:00 PM ${timezone.label}\`.` });
    const date = normalizeDate(interaction.fields.getTextInputValue("date"));
    if (!date) return modalReply(interaction, { content: `Enter the date as \`${DATE_FORMAT_HINT}\`, for example \`08/06/2026\`.` });
    const data = {
      trainerId,
      traineeId,
      trainerLabel: mentionWithLabel(trainer),
      traineeLabel: mentionWithLabel(trainee),
      division,
      date,
      startTime,
      endTime,
      duration: durationLabel(startTime, endTime),
      timeZoneLabel: timezone.label,
      trainingType: clean(interaction.fields.getTextInputValue("training-type"), 200),
      outcome: normalizeMultiline(interaction.fields.getTextInputValue("outcome")),
      notes: normalizeMultiline(interaction.fields.getTextInputValue("notes")),
      signedBy: memberLabel(interaction.member),
      signerRank: rankNameForMember(interaction.member)
    };
    const id = pending.create({ type: "training", createdBy: interaction.user.id, data });
    const embed = trainingEmbed(data, "Preview — BCSO Training Record");
    await postApprovalRequest(interaction, id, "training", data, embed);
    return modalReply(interaction, { content: `Preview only — review the record, then approve to post it. ${expiryText(id)}`, embeds: [embed], components: [approvalRow(id, "training")] });
  }
  if (kind === "promotion-modal") {
    const member = await interaction.guild.members.fetch(modalParts[1]);
    const fromRank = clean(interaction.fields.getTextInputValue("from-rank"), 80);
    const toRank = clean(interaction.fields.getTextInputValue("to-rank"), 80);
    if (!config.rankRoleIds[fromRank] || !config.rankRoleIds[toRank]) return modalReply(interaction, { content: `Both ranks must exactly match configured ranks: ${Object.keys(config.rankRoleIds).join(", ") || "none"}.` });
    if (fromRank === toRank) return modalReply(interaction, { content: "The current and new rank cannot be the same." });
    const data = {
      memberId: member.id,
      memberLabel: mentionWithLabel(member),
      effectiveDate: normalizeDate(interaction.fields.getTextInputValue("effective-date")),
      fromRank,
      toRank,
      authorizedBy: clean(interaction.fields.getTextInputValue("authorized-by"), 200),
      reason: normalizeMultiline(interaction.fields.getTextInputValue("reason"))
    };
    if (!data.effectiveDate) return modalReply(interaction, { content: `Enter the effective date as \`${DATE_FORMAT_HINT}\`, for example \`08/06/2026\`.` });
    const id = pending.create({ type: "promotion", createdBy: interaction.user.id, data });
    const approvalEmbed = promotionEmbed(data, "Approval Required — BCSO Promotion");
    await postApprovalRequest(interaction, id, "promotion", data, approvalEmbed, { stage: "pab" });
    return modalReply(interaction, { content: `Promotion request sent to the private PAB approvals channel for PAB review. After PAB forwards it, Command will be pinged for final approval. No roles changed. ${expiryText(id)}`, embeds: [promotionEmbed(data, "Submitted — BCSO Personnel Action")], components: [approvalRow(id, "promotion", approvalLabel("promotion", "pab"))] });
  }
  if (kind === "role-award-modal") {
    const [, memberId, roleId] = modalParts;
    const [member, role] = await Promise.all([interaction.guild.members.fetch(memberId), interaction.guild.roles.fetch(roleId)]);
    if (!role || !isApprovedAwardRole(role)) return modalReply(interaction, { content: "That role is no longer eligible for PAB awards." });
    const data = {
      memberId: member.id,
      memberLabel: mentionWithLabel(member),
      roleId: role.id,
      roleName: clean(role.name, 100),
      effectiveDate: normalizeDate(interaction.fields.getTextInputValue("effective-date")),
      authorizedBy: clean(interaction.fields.getTextInputValue("authorized-by"), 200),
      reason: normalizeMultiline(interaction.fields.getTextInputValue("reason"))
    };
    if (!data.effectiveDate) return modalReply(interaction, { content: `Enter the effective date as \`${DATE_FORMAT_HINT}\`, for example \`08/06/2026\`.` });
    const id = pending.create({ type: "role-award", createdBy: interaction.user.id, data });
    const embed = roleAwardEmbed(data, "Preview — BCSO Role Award");
    await postApprovalRequest(interaction, id, "role-award", data, embed);
    return modalReply(interaction, { content: `Preview only — review the award, then approve to apply the role and post it. ${expiryText(id)}`, embeds: [embed], components: [approvalRow(id, "role-award")] });
  }
  if (kind === "role-removal-modal") {
    const [, memberId, roleId] = modalParts;
    const [member, role] = await Promise.all([interaction.guild.members.fetch(memberId), interaction.guild.roles.fetch(roleId)]);
    if (!role || !isApprovedAwardRole(role)) return modalReply(interaction, { content: "That role is no longer eligible for PAB removal." });
    if (!member.roles.cache.has(role.id)) return modalReply(interaction, { content: "That member no longer holds the selected role." });
    const data = {
      memberId: member.id,
      memberLabel: mentionWithLabel(member),
      roleId: role.id,
      roleName: clean(role.name, 100),
      effectiveDate: normalizeDate(interaction.fields.getTextInputValue("effective-date")),
      authorizedBy: clean(interaction.fields.getTextInputValue("authorized-by"), 200),
      reason: normalizeMultiline(interaction.fields.getTextInputValue("reason"))
    };
    if (!data.effectiveDate) return modalReply(interaction, { content: `Enter the effective date as \`${DATE_FORMAT_HINT}\`, for example \`08/06/2026\`.` });
    const id = pending.create({ type: "role-removal", createdBy: interaction.user.id, data });
    const embed = roleRemovalEmbed(data, "Preview — BCSO Role Removal");
    await postApprovalRequest(interaction, id, "role-removal", data, embed);
    return modalReply(interaction, { content: `Preview only — review the approved removal before it changes the role. ${expiryText(id)}`, embeds: [embed], components: [approvalRow(id, "role-removal", "Approve & remove")] });
  }
  if (kind === "department-record-modal") {
    const draft = pending.take(modalParts[1], interaction.user.id, action => action.type === "department-record-draft" ? null : "This form expired. Run the command again.");
    if (draft.error) return modalReply(interaction, { content: draft.error });
    const { memberId, callsign, addedRoleId, removedRoleId, ccRoleId, sourceMessageLink } = draft.action.data;
    const member = await interaction.guild.members.fetch(memberId);
    const data = {
      memberId: member.id,
      callsign,
      addedRoleId,
      removedRoleId,
      ccRoleId,
      sourceMessageLink,
      recordType: clean(interaction.fields.getTextInputValue("record-type"), 100),
      note: normalizeMultiline(interaction.fields.getTextInputValue("note")),
      recordId: `PAB-${randomUUID().slice(0, 8).toUpperCase()}`
    };
    const id = pending.create({ type: "department-record", createdBy: interaction.user.id, data });
    const embed = new EmbedBuilder().setColor(BLUE).setTitle("Preview — PAB Department Record").setDescription(departmentRecordText(data));
    await postApprovalRequest(interaction, id, "department-record", data, embed);
    return modalReply(interaction, { content: `Preview only — approve to post the PAB department record. ${expiryText(id)}`, embeds: [embed], components: [approvalRow(id, "department-record")] });
  }
  if (kind === "correction-modal") {
    const draft = pending.take(modalParts[1], interaction.user.id, action => action.type === "correction-draft" ? null : "This form expired. Run the command again.");
    if (draft.error) return modalReply(interaction, { content: draft.error });
    const data = { ...draft.action.data, correction: normalizeMultiline(interaction.fields.getTextInputValue("correction")), correctedBy: memberLabel(interaction.member) };
    const id = pending.create({ type: "correction", createdBy: interaction.user.id, data });
    const embed = correctionEmbed(data, "Preview — BCSO PAB Record Correction");
    await postApprovalRequest(interaction, id, "correction", data, embed);
    return modalReply(interaction, { content: `Preview only — approval posts a new correction and preserves the original record. ${expiryText(id)}`, embeds: [embed], components: [approvalRow(id, "correction")] });
  }
  if (kind === "promotion-check-modal") {
    const draft = pending.take(modalParts[1], interaction.user.id, action => action.type === "promotion-check-draft" ? null : "This form expired. Run the command again.");
    if (draft.error) return modalReply(interaction, { content: draft.error });
    const member = await interaction.guild.members.fetch(draft.action.data.memberId);
    const rank = clean(interaction.fields.getTextInputValue("rank"), 80);
    const requestedRank = clean(interaction.fields.getTextInputValue("requested-rank"), 80);
    let googleEligibility;
    if (!config.googlePromotionTestsEnabled) {
      googleEligibility = ["Google promotion evaluation: staged/disabled. No sheet was read."];
    } else if (!promotionTestsSheet.configured) {
      googleEligibility = ["Google promotion evaluation: enabled but not configured. Set the protected spreadsheet ID and service-account JSON."];
    } else {
      try {
        const [promotionRows, rosterRows] = await Promise.all([
          promotionTestsSheet.rows(),
          rosterSheet.configured ? rosterSheet.rows() : Promise.resolve([])
        ]);
        googleEligibility = promotionEligibilityLines(evaluatePromotionEligibility({ rows: promotionRows, rosterRows, member, memberRank: rankNameForMember(member), currentRank: rank, requestedRank }));
      } catch (error) {
        googleEligibility = [`Google promotion evaluation could not be read: ${error instanceof Error ? error.message : "unknown error"}`];
      }
    }
    const data = {
      memberId: member.id,
      memberLabel: mentionWithLabel(member),
      rank,
      requestedRank,
      eligibility: normalizeMultiline(interaction.fields.getTextInputValue("eligibility")),
      reference: normalizeMultiline(interaction.fields.getTextInputValue("reference")),
      recommendation: normalizeMultiline(interaction.fields.getTextInputValue("recommendation")),
      googleEligibility
    };
    const id = pending.create({ type: "promotion-check", createdBy: interaction.user.id, data });
    const embed = promotionCheckEmbed(data, "Preview — BCSO Promotion Eligibility Check");
    await postApprovalRequest(interaction, id, "promotion-check", data, embed);
    return modalReply(interaction, { content: `Preview only — this is a human PAB checklist, not promotion approval. ${expiryText(id)}`, embeds: [embed], components: [approvalRow(id, "promotion-check", "Approve checklist")] });
  }
  if (kind === "personnel-status-modal") {
    const draft = pending.take(modalParts[1], interaction.user.id, action => action.type === "personnel-status-draft" ? null : "This form expired. Run the command again.");
    if (draft.error) return modalReply(interaction, { content: draft.error });
    const member = await interaction.guild.members.fetch(draft.action.data.memberId);
    const data = {
      memberId: member.id,
      memberLabel: mentionWithLabel(member),
      status: draft.action.data.status,
      effectiveDate: normalizeDate(interaction.fields.getTextInputValue("effective-date")),
      authorizedBy: clean(interaction.fields.getTextInputValue("authorized-by"), 200),
      detail: normalizeMultiline(interaction.fields.getTextInputValue("detail"))
    };
    if (!data.effectiveDate) return modalReply(interaction, { content: `Enter the effective date as \`${DATE_FORMAT_HINT}\`, for example \`08/06/2026\`.` });
    const id = pending.create({ type: "personnel-status", createdBy: interaction.user.id, data });
    const embed = statusEmbed(data, "Preview — BCSO Personnel Status");
    await postApprovalRequest(interaction, id, "personnel-status", data, embed);
    return modalReply(interaction, { content: `Preview only — approval posts this record only. It will not change roles or remove access. ${expiryText(id)}`, embeds: [embed], components: [approvalRow(id, "personnel-status")] });
  }
  if (kind === "inactivity-review-modal") {
    const draft = pending.take(modalParts[1], interaction.user.id, action => action.type === "inactivity-review-draft" ? null : "This form expired. Run the command again.");
    if (draft.error) return modalReply(interaction, { content: draft.error });
    const member = await interaction.guild.members.fetch(draft.action.data.memberId);
    const reviewPeriod = normalizeDateRange(interaction.fields.getTextInputValue("review-period"));
    const manualLastActivity = clean(interaction.fields.getTextInputValue("last-activity"), 80);
    const manualLastActivityDate = manualLastActivity ? normalizeDate(manualLastActivity) : "";
    if (!reviewPeriod) return modalReply(interaction, { content: `Enter the review period as \`${DATE_RANGE_FORMAT_HINT}\`.` });
    if (manualLastActivity && !manualLastActivityDate) return modalReply(interaction, { content: `Enter the last activity date as \`${DATE_FORMAT_HINT}\`, or leave it blank for Ricky to use its activity ledger.` });
    const [, reviewEnd] = reviewPeriod.split(" - ");
    const trackedActivity = manualLastActivityDate ? null : store.lastActivity(member.id, { guildId: interaction.guild.id, until: endOfDateTimestamp(reviewEnd) });
    if (!manualLastActivityDate && !trackedActivity) return modalReply(interaction, { content: "Ricky has no tracked activity for this member in the selected period. Enter a PAB-verified date manually, or configure and allow the activity-source channels before trying again." });
    const data = {
      memberId: member.id,
      memberLabel: mentionWithLabel(member),
      reviewPeriod,
      lastActivity: manualLastActivityDate || dateInTimeZone(config.timeZoneId, trackedActivity.occurredAt),
      lastActivitySource: manualLastActivityDate ? "PAB-provided — verify source" : `Discord activity in <#${trackedActivity.channelId}>`,
      summary: normalizeMultiline(interaction.fields.getTextInputValue("summary")),
      followUp: normalizeMultiline(interaction.fields.getTextInputValue("follow-up"))
    };
    const id = pending.create({ type: "inactivity-review", createdBy: interaction.user.id, data });
    const embed = inactivityReviewEmbed(data, "Preview — BCSO PAB Inactivity Review");
    await postApprovalRequest(interaction, id, "inactivity-review", data, embed);
    return modalReply(interaction, { content: `Preview only — approval posts a private PAB review. It does not change roles, access, or apply discipline. ${expiryText(id)}`, embeds: [embed], components: [approvalRow(id, "inactivity-review", "Post private review")] });
  }
  if (kind === "announcement-modal") {
    const draft = pending.take(modalParts[1], interaction.user.id, action => action.type === "announcement-draft" ? null : "This form expired. Run the command again.");
    if (draft.error) return modalReply(interaction, { content: draft.error });
    const data = {
      ...draft.action.data,
      title: clean(interaction.fields.getTextInputValue("title"), 200),
      message: normalizeMultiline(interaction.fields.getTextInputValue("message")),
      authorName: memberLabel(interaction.member)
    };
    const id = pending.create({ type: "announcement", createdBy: interaction.user.id, data });
    const embed = announcementEmbed(data, `Preview — ${data.title}`);
    await postApprovalRequest(interaction, id, "announcement", data, embed);
    return modalReply(interaction, { content: `Preview only — review the announcement and its selected notification role. ${expiryText(id)}`, embeds: [embed], components: [approvalRow(id, "announcement", "Approve & announce")] });
  }
}

async function approveTraining(interaction, action) {
  const roleMentions = config.pabRoleId ? [config.pabRoleId] : [];
  const content = [`<@${action.data.trainerId}>`, `<@${action.data.traineeId}>`, ...roleMentions.map(roleId => `<@&${roleId}>`)].join(" ");
  const { message } = await sendRecord({
    guild: interaction.guild,
    baseChannelId: config.trainingRecordsChannelId,
    forumChannelId: config.trainingRecordsForumChannelId,
    memberId: action.data.traineeId,
    threadName: memberThreadName(action.data.traineeLabel, "Training"),
    payload: { content, allowedMentions: { users: [action.data.trainerId, action.data.traineeId], roles: roleMentions }, embeds: [trainingEmbed(action.data)] },
    store
  });
  saveReceipt("training", interaction, action, message);
  action.committed = true;
  await audit("Training record posted", `${action.data.traineeLabel} | Trainer: ${action.data.trainerLabel} | Posted by <@${interaction.user.id}>`);
  return interaction.update({ content: "Training record posted and logged.", embeds: [trainingEmbed(action.data)], components: [] });
}

async function approvePromotion(interaction, action) {
  if (!mayApprovePromotion(interaction.member)) return interaction.reply({ content: "A Command member must approve and apply a promotion.", ephemeral: true });
  const member = await interaction.guild.members.fetch(action.data.memberId);
  const memberIssue = memberManagementError(interaction, member);
  if (memberIssue) throw new Error(memberIssue);
  const configuredRanks = rankRoleEntries(config.rankRoleIds);
  const currentRankRoles = configuredRanks.filter(({ id }) => member.roles.cache.has(id)).map(({ id }) => id);
  const targetRoleId = config.rankRoleIds[action.data.toRank];
  const roleTargets = await Promise.all([...new Set([...currentRankRoles, targetRoleId])].map(id => interaction.guild.roles.fetch(id)));
  const roleIssue = roleTargets.map(role => roleManagementError(interaction, role)).find(Boolean);
  if (roleIssue) throw new Error(roleIssue);
  if (!member.roles.cache.has(config.rankRoleIds[action.data.fromRank])) throw new Error(`${member.user.tag} does not currently have the configured ${action.data.fromRank} role.`);
  const rolesToRemove = currentRankRoles.filter(id => id !== targetRoleId);
  if (!member.roles.cache.has(targetRoleId)) await member.roles.add(targetRoleId, `BCSO promotion approved by ${interaction.user.tag}`);
  if (rolesToRemove.length) await member.roles.remove(rolesToRemove, `BCSO promotion to ${action.data.toRank} approved by ${interaction.user.tag}`);
  const [recordResult, announcementChannel] = await Promise.all([
    sendRecord({
      guild: interaction.guild,
      baseChannelId: config.personnelRecordsChannelId,
      forumChannelId: config.personnelJacketsForumChannelId,
      memberId: member.id,
      threadName: memberThreadName(action.data.memberLabel),
      payload: { content: `<@${member.id}>`, allowedMentions: { users: [member.id] }, embeds: [promotionEmbed(action.data)] },
      store
    }),
    fetchChannel(config.promotionsAnnouncementsChannelId)
  ]);
  const recordMessage = recordResult.message;
  await announcementChannel.send({ content: `Please congratulate <@${member.id}> on promotion to **${action.data.toRank}**.`, allowedMentions: { users: [member.id] }, embeds: [promotionEmbed(action.data, "BCSO Promotion") ] });
  saveReceipt("promotion", interaction, action, recordMessage);
  action.committed = true;
  await audit("Promotion applied", `${action.data.memberLabel} | ${action.data.fromRank} → ${action.data.toRank} | Approved by <@${interaction.user.id}>`);
  return interaction.update({ content: `Promotion applied: ${action.data.memberLabel} is now **${action.data.toRank}**. Records and announcement posted.`, embeds: [promotionEmbed(action.data)], components: [] });
}

async function approveRoleAward(interaction, action) {
  const member = await interaction.guild.members.fetch(action.data.memberId);
  const role = await interaction.guild.roles.fetch(action.data.roleId);
  if (!role || !isApprovedAwardRole(role)) throw new Error("The selected role is no longer eligible for PAB awards.");
  const memberIssue = memberManagementError(interaction, member);
  if (memberIssue) throw new Error(memberIssue);
  const roleIssue = roleManagementError(interaction, role);
  if (roleIssue) throw new Error(roleIssue);
  if (!member.roles.cache.has(action.data.roleId)) await member.roles.add(action.data.roleId, `BCSO role award approved by ${interaction.user.tag}`);
  const { message } = await sendRecord({
    guild: interaction.guild,
    baseChannelId: config.qualificationsRecordsChannelId,
    forumChannelId: config.personnelJacketsForumChannelId,
    memberId: member.id,
    threadName: memberThreadName(action.data.memberLabel),
    payload: { content: `<@${member.id}>`, allowedMentions: { users: [member.id] }, embeds: [roleAwardEmbed(action.data)] },
    store
  });
  saveReceipt("role-award", interaction, action, message);
  action.committed = true;
  await audit("Qualification or unit role awarded", `${action.data.memberLabel} | ${action.data.roleName} | Awarded by <@${interaction.user.id}>`);
  return interaction.update({ content: `Role applied and recorded: ${action.data.memberLabel} received **${action.data.roleName}**.`, embeds: [roleAwardEmbed(action.data)], components: [] });
}

async function approveRoleRemoval(interaction, action) {
  const member = await interaction.guild.members.fetch(action.data.memberId);
  const role = await interaction.guild.roles.fetch(action.data.roleId);
  if (!role || !isApprovedAwardRole(role)) throw new Error("The selected role is no longer eligible for PAB removal.");
  const memberIssue = memberManagementError(interaction, member);
  if (memberIssue) throw new Error(memberIssue);
  const roleIssue = roleManagementError(interaction, role);
  if (roleIssue) throw new Error(roleIssue);
  if (!member.roles.cache.has(action.data.roleId)) throw new Error("The member no longer holds the selected role.");
  await member.roles.remove(action.data.roleId, `BCSO role removal approved by ${interaction.user.tag}`);
  const { message } = await sendRecord({
    guild: interaction.guild,
    baseChannelId: config.qualificationsRecordsChannelId,
    forumChannelId: config.personnelJacketsForumChannelId,
    memberId: member.id,
    threadName: memberThreadName(action.data.memberLabel),
    payload: { content: `<@${member.id}>`, allowedMentions: { users: [member.id] }, embeds: [roleRemovalEmbed(action.data)] },
    store
  });
  saveReceipt("role-removal", interaction, action, message);
  action.committed = true;
  await audit("Qualification or unit role removed", `${action.data.memberLabel} | ${action.data.roleName} | Removed by <@${interaction.user.id}>`);
  return interaction.update({ content: `Role removed and recorded: ${action.data.memberLabel} no longer has **${action.data.roleName}**.`, embeds: [roleRemovalEmbed(action.data)], components: [] });
}

async function approveDepartmentRecord(interaction, action) {
  const roleMentions = [config.pabRoleId, action.data.ccRoleId].filter(Boolean);
  const { message } = await sendRecord({
    guild: interaction.guild,
    baseChannelId: config.personnelRecordsChannelId,
    forumChannelId: config.personnelJacketsForumChannelId,
    memberId: action.data.memberId,
    threadName: memberThreadName(`<@${action.data.memberId}>`),
    payload: { content: departmentRecordText(action.data), allowedMentions: { users: [action.data.memberId], roles: roleMentions } },
    store
  });
  saveReceipt("department-record", interaction, action, message, action.data.recordId);
  action.committed = true;
  await audit("PAB department record posted", `${action.data.recordId} | <@${action.data.memberId}> | Posted by <@${interaction.user.id}>`);
  return interaction.update({ content: `Department record ${action.data.recordId} posted and logged.`, components: [] });
}

async function approveCorrection(interaction, action) {
  const channel = await fetchChannel(action.data.channelId);
  const channelIssue = channelPermissionIssue(channel, interaction.guild.members.me, [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks]);
  if (channelIssue) throw new Error(channelIssue);
  const original = await channel.messages.fetch(action.data.messageId);
  if (!original) throw new Error("The original record could not be found.");
  const message = await channel.send({ embeds: [correctionEmbed(action.data)], allowedMentions: { parse: [] } });
  saveReceipt("correction", interaction, action, message);
  action.committed = true;
  await audit("PAB record correction posted", `${action.data.messageLink} | Corrected by <@${interaction.user.id}>`);
  return interaction.update({ content: "Correction posted. The original record was preserved and linked for auditability.", embeds: [correctionEmbed(action.data)], components: [] });
}

async function approvePromotionCheck(interaction, action) {
  const channel = await fetchChannel(config.pabApprovalsChannelId);
  const message = await channel.send({ embeds: [promotionCheckEmbed(action.data)], allowedMentions: { parse: [] } });
  saveReceipt("promotion-check", interaction, action, message);
  action.committed = true;
  await audit("Promotion eligibility check posted", `${action.data.memberLabel} | ${action.data.rank} → ${action.data.requestedRank} | Posted by <@${interaction.user.id}>`);
  return interaction.update({ content: "Promotion eligibility check posted to the private PAB review queue. No role changed.", embeds: [promotionCheckEmbed(action.data)], components: [] });
}

async function approvePersonnelStatus(interaction, action) {
  const { message } = await sendRecord({
    guild: interaction.guild,
    baseChannelId: config.personnelRecordsChannelId,
    forumChannelId: config.personnelJacketsForumChannelId,
    memberId: action.data.memberId,
    threadName: memberThreadName(action.data.memberLabel),
    payload: { embeds: [statusEmbed(action.data)], allowedMentions: { parse: [] } },
    store
  });
  saveReceipt("personnel-status", interaction, action, message);
  action.committed = true;
  await audit("Personnel status record posted", `${action.data.memberLabel} | ${action.data.status} | Posted by <@${interaction.user.id}>`);
  return interaction.update({ content: `Personnel status record posted: **${action.data.status}**. No roles or access changed.`, embeds: [statusEmbed(action.data)], components: [] });
}

async function approveInactivityReview(interaction, action) {
  const channel = await fetchChannel(config.inactivityReviewChannelId);
  const message = await channel.send({ embeds: [inactivityReviewEmbed(action.data)], allowedMentions: { parse: [] } });
  saveReceipt("inactivity-review", interaction, action, message);
  action.committed = true;
  await audit("PAB inactivity review posted", `${action.data.memberLabel} | Posted by <@${interaction.user.id}> | No role, access, or disciplinary action applied`);
  return interaction.update({ content: "Private PAB inactivity review posted and logged. No role, access, or disciplinary action was applied.", embeds: [inactivityReviewEmbed(action.data)], components: [] });
}

async function approveAnnouncement(interaction, action) {
  const channel = await fetchChannel(config.pabAnnouncementsChannelId);
  if (action.data.notifyRoleId) {
    const notifyRole = await interaction.guild.roles.fetch(action.data.notifyRoleId);
    if (!isNotifiableRole(notifyRole, interaction.guild.members.me)) throw new Error("The selected notification role is no longer mentionable or eligible.");
  }
  const content = action.data.notifyRoleId ? `<@&${action.data.notifyRoleId}>` : undefined;
  const message = await channel.send({ content, embeds: [announcementEmbed(action.data, action.data.title)], allowedMentions: { roles: action.data.notifyRoleId ? [action.data.notifyRoleId] : [] } });
  saveReceipt("announcement", interaction, action, message);
  action.committed = true;
  await audit("PAB announcement posted", `${action.data.title} | Posted by <@${interaction.user.id}>`);
  return interaction.update({ content: "PAB announcement posted and logged.", embeds: [announcementEmbed(action.data, action.data.title)], components: [] });
}

client.once(Events.ClientReady, async readyClient => {
  const issues = await startupReadinessIssues(readyClient);
  if (issues.length) {
    console.error("Ricky startup blocked by the production readiness gate:");
    for (const issue of issues) console.error(`- ${issue}`);
    console.error("No commands will be served. Fix the protected configuration/Discord settings, then restart Ricky.");
    readyClient.destroy();
    store.close();
    rms?.close();
    releaseProcessLock?.();
    process.exit(1);
  }
  console.log(`Ricky online as ${readyClient.user.tag}; durable data store ready. Activity tracking: ${config.activityChannelIds.size ? `${config.activityChannelIds.size} approved channel(s)` : "disabled"}. Startup readiness gate passed.`);
  await syncRmsMembers(await readyClient.guilds.fetch(config.guildId)).catch(error => logError("rms.member-sync", error, { guildId: config.guildId }));
  await postDailyNotices(readyClient).catch(error => console.error(`Daily notice pass failed: ${error instanceof Error ? error.message : "unknown error"}`));
  setInterval(() => sendPendingReminders().catch(error => console.error(`Reminder pass failed: ${error instanceof Error ? error.message : "unknown error"}`)), 60_000).unref?.();
  setInterval(() => postDailyNotices(readyClient).catch(error => console.error(`Daily notice pass failed: ${error instanceof Error ? error.message : "unknown error"}`)), 60 * 60_000).unref?.();
});
client.on(Events.Error, error => logError("discord-client", error, { guildId: config.guildId }));
client.on(Events.MessageCreate, message => {
  if (message.guildId !== config.guildId || !config.activityChannelIds.has(message.channelId) || message.author?.bot) return;
  try {
    store.recordActivity({
      memberId: message.author.id,
      guildId: message.guildId,
      source: "discord-message",
      sourceEventId: message.id,
      channelId: message.channelId,
      occurredAt: message.createdTimestamp
    });
  } catch (error) {
    console.error(`Activity event could not be recorded: ${error instanceof Error ? error.message : "unknown error"}`);
  }
});

client.on(Events.InteractionCreate, async interaction => {
  let claimedActionId = null;
  let claimedAction = null;
  try {
    // A token may be invited to more than one guild.  Ignore interactions
    // outside the configured guild so an old/stale deployment cannot answer
    // commands in another sandbox or race the active instance.
    if (interaction.guildId !== config.guildId) return;
    if (interaction.isChatInputCommand()) {
      if (SELF_SERVICE_COMMANDS.has(interaction.commandName)) {
        if (interaction.commandName === "my-birthday") {
          const month = interaction.options.getInteger("month");
          const day = interaction.options.getInteger("day");
          const candidate = new Date(Date.UTC(2000, month - 1, day));
          if (candidate.getUTCMonth() !== month - 1 || candidate.getUTCDate() !== day) return interaction.reply({ content: "That month/day combination is not valid.", ephemeral: true });
          store.setBirthday({ guildId: interaction.guild.id, memberId: interaction.user.id, month, day, optedIn: true });
          return interaction.reply({ content: `Opted in. Ricky will announce your birthday on **${String(month).padStart(2, "0")}/${String(day).padStart(2, "0")}** in the configured birthday channel. No birth year is stored.`, ephemeral: true });
        }
        store.clearBirthday(interaction.guild.id, interaction.user.id);
        return interaction.reply({ content: "Your opt-in birthday data was removed. Ricky will not announce it.", ephemeral: true });
      }
      if (ADMIN_COMMANDS.has(interaction.commandName)) {
        if (!isServerAdministrator(interaction.member)) return unauthorizedAdmin(interaction);
        if (interaction.commandName === "setup-status") return interaction.reply({ embeds: [setupStatusEmbed()], ephemeral: true });
        if (interaction.commandName === "pab-health") return runHealthCheck(interaction);
        if (interaction.commandName === "export-audit") return exportAudit(interaction);
        if (interaction.commandName === "roster-sync") return runRosterSync(interaction);
      }
      if (!PAB_COMMANDS.has(interaction.commandName)) return;
      if (!mayUsePab(interaction.member)) return unauthorized(interaction);
      if (await requiresConfiguration(interaction)) return;
      const selectedMembers = ["member", "trainer", "trainee"].map(name => interaction.options.getMember(name)).filter(Boolean);
      if (selectedMembers.some(member => member.user.bot)) return interaction.reply({ content: "PAB personnel workflows may only target human server members.", ephemeral: true });
      if (interaction.commandName === "training-log") return showTrainingModal(interaction);
      if (interaction.commandName === "promotion") return showPromotionModal(interaction);
      if (interaction.commandName === "award-role") return showRoleAwardModal(interaction);
      if (interaction.commandName === "remove-role") return showRoleRemovalModal(interaction);
      if (interaction.commandName === "department-record") return showDepartmentRecordModal(interaction);
      if (interaction.commandName === "correct-record") return showCorrectionModal(interaction);
      if (interaction.commandName === "promotion-check") return showPromotionCheckModal(interaction);
      if (interaction.commandName === "personnel-status") return showPersonnelStatusModal(interaction);
      if (interaction.commandName === "inactivity-review") return showInactivityReviewModal(interaction);
      if (interaction.commandName === "member-profile") return showMemberProfile(interaction);
      if (interaction.commandName === "personnel-history") return personnelHistory(interaction);
      if (interaction.commandName === "pab-announcement") return showAnnouncementModal(interaction);
      if (interaction.commandName === "pab-dashboard") return interaction.reply({ embeds: [dashboardEmbed()], ephemeral: true });
      if (interaction.commandName === "find-record") return findRecord(interaction);
    }
    if (interaction.isModalSubmit()) {
      if (!mayUsePab(interaction.member)) return unauthorized(interaction);
      // A modal submission has only a short Discord acknowledgement window.
      // Defer before member/channel fetches so mobile submissions do not fall
      // back to Discord's generic “Something went wrong” banner.
      await interaction.deferReply({ ephemeral: true });
      return handleModal(interaction);
    }
    if (interaction.isButton()) {
      if (!mayUsePab(interaction.member)) return unauthorized(interaction);
      const [decision, type, id] = interaction.customId.split(":");
      if (!["approve", "cancel", "renew"].includes(decision) || !id) return;
      if (decision === "renew") {
        const renewal = pending.renew(id, interaction.user.id, action => {
          if (type === "promotion") return action.createdBy === interaction.user.id || mayApprovePromotion(interaction.member) ? null : "Only the submitting PAB member or Command can renew this promotion request.";
          return action.createdBy === interaction.user.id ? null : "Only the PAB member who created this preview can renew it.";
        });
        if (renewal.error) return interaction.reply({ content: renewal.error, ephemeral: true });
        const expiresAt = Math.floor(renewal.action.expiresAt / 1000);
        rmsApprovalRenewal(interaction, id, renewal.action.expiresAt);
        return interaction.update({ content: `Preview renewed for ${ttlLabel()}. Review it before <t:${expiresAt}:F> (<t:${expiresAt}:R>).`, components: [approvalRow(id, type, approvalLabel(type))] });
      }
      if (decision === "approve" && type === "promotion") {
        const forwarded = pending.advance(id, interaction.user.id, action => {
          if (action.data.pabApprovedBy) return "AWAITING_COMMAND_APPROVAL";
          if (!mayUsePab(interaction.member)) return "A PAB member must complete the review before Command approval.";
          action.data.pabApprovedBy = interaction.user.id;
          action.data.pabApprovedAt = new Date().toISOString();
          return null;
        });
        if (!forwarded.error) {
          rmsApprovalDecision(interaction, id, "approved", "PAB review completed; forwarded to Command");
          if (rms) {
            try {
              rms.createApproval({ guildId: interaction.guild.id, sourceActionId: id, workflowType: "promotion", stage: "command", requestedBy: interaction.user.id, expiresAt: forwarded.action.expiresAt, notes: forwarded.action.data.memberLabel || null });
              rms.audit({ guildId: interaction.guild.id, actorDiscordId: interaction.user.id, action: "approval_requested", entityType: "approval", entityId: id, metadata: { workflowType: "promotion", stage: "command" } });
            } catch (error) {
              logError("rms.command-approval-request", error, { actionId: id });
            }
          }
          const expiresAt = Math.floor(forwarded.action.expiresAt / 1000);
          const roles = [config.commandRoleId].filter(Boolean);
          const embed = promotionEmbed(forwarded.action.data, "Command Approval Required — BCSO Promotion");
          if (!interaction.message || interaction.message.flags?.has?.(64)) {
            const approvalChannel = await fetchChannel(config.pabApprovalsChannelId);
            await approvalChannel.send({
              content: `<@&${config.commandRoleId}> PAB review is complete for ${forwarded.action.data.memberLabel}. Command must approve and apply the promotion. Expires <t:${expiresAt}:F> (<t:${expiresAt}:R>).`,
              allowedMentions: { roles },
              embeds: [embed],
              components: [approvalRow(id, "promotion", approvalLabel("promotion"))]
            });
          }
          return interaction.update({
            content: `<@&${config.commandRoleId}> PAB review is complete for ${forwarded.action.data.memberLabel}. Command must approve and apply the promotion. Expires <t:${expiresAt}:F> (<t:${expiresAt}:R>).`,
            allowedMentions: { roles },
            embeds: [embed],
            components: [approvalRow(id, "promotion", approvalLabel("promotion"))]
          });
        }
        if (forwarded.error !== "AWAITING_COMMAND_APPROVAL") return interaction.reply({ content: forwarded.error, ephemeral: true });
      }
      if (decision === "cancel") {
        const cancellation = pending.take(id, interaction.user.id, action => {
          if ((type === "training" || type === "role-award" || type === "role-removal" || type === "department-record" || type === "correction" || type === "promotion-check" || type === "personnel-status" || type === "inactivity-review" || type === "announcement") && action.createdBy !== interaction.user.id) return "Only the PAB member who created this preview can cancel it.";
          if (type === "promotion" && action.createdBy !== interaction.user.id && !mayApprovePromotion(interaction.member)) return "Only the submitting PAB member or Command can cancel this promotion request.";
          return null;
        });
        if (cancellation.error) return interaction.reply({ content: cancellation.error, ephemeral: true });
        claimedActionId = cancellation.action.id;
        rmsApprovalDecision(interaction, claimedActionId, "cancelled", "Cancelled from Discord approval control");
        const response = await interaction.update({ content: "Cancelled. Nothing was posted or changed.", embeds: [], components: [] });
        pending.complete(claimedActionId);
        claimedActionId = null;
        return response;
      }
      const result = pending.take(id, interaction.user.id, action => {
        if ((type === "training" || type === "role-award" || type === "role-removal" || type === "department-record" || type === "correction" || type === "promotion-check" || type === "personnel-status" || type === "inactivity-review" || type === "announcement") && !mayUsePab(interaction.member)) return "A PAB member must approve this request.";
        if (type === "promotion" && !action.data.pabApprovedBy) return "PAB review must be completed before Command can approve and apply this promotion.";
        if (type === "promotion" && !mayApprovePromotion(interaction.member)) return "A Command member must approve and apply a promotion.";
        return null;
      });
      if (result.error) return interaction.reply({ content: result.error, ephemeral: true });
      claimedActionId = result.action.id;
      claimedAction = result.action;
      const handlers = {
        training: approveTraining,
        promotion: approvePromotion,
        "role-award": approveRoleAward,
        "role-removal": approveRoleRemoval,
        "department-record": approveDepartmentRecord,
        correction: approveCorrection,
        "promotion-check": approvePromotionCheck,
        "personnel-status": approvePersonnelStatus,
        "inactivity-review": approveInactivityReview,
        announcement: approveAnnouncement
      };
      const handler = handlers[type];
      if (!handler) {
        pending.release(claimedActionId);
        claimedActionId = null;
        claimedAction = null;
        return;
      }
      const response = await handler(interaction, result.action);
      pending.complete(claimedActionId);
      claimedActionId = null;
      claimedAction = null;
      return response;
    }
  } catch (error) {
    if (claimedActionId) {
      if (claimedAction?.committed) pending.complete(claimedActionId);
      else pending.release(claimedActionId);
    }
    logError("workflow", error, {
      interactionId: interaction.id,
      interactionType: interaction.type,
      guildId: interaction.guildId,
      userId: interaction.user?.id,
      commandName: interaction.commandName || undefined,
      customId: interaction.customId || undefined
    });
    const message = discordPermissionError(error) || "I could not complete that action. Check `/pab-health`, configured channel IDs, and the bot's server permissions.";
    try {
      if (interaction.deferred) await interaction.editReply({ content: message, embeds: [], components: [] });
      else if (interaction.replied) await interaction.followUp({ content: message, ephemeral: true });
      else await interaction.reply({ content: message, ephemeral: true });
    } catch (responseError) {
      logError("workflow-error-response", responseError, { interactionId: interaction.id, guildId: interaction.guildId, userId: interaction.user?.id });
    }
  }
});

async function shutdown(signal) {
  console.log(`Ricky received ${signal}; closing Discord connection and local data store.`);
  client.destroy();
  store.close();
  rms?.close();
  releaseProcessLock?.();
}

process.on("unhandledRejection", (reason) => logError("unhandled-rejection", reason, { guildId: config.guildId }));
process.on("uncaughtException", async error => {
  logError("uncaught-exception", error, { guildId: config.guildId });
  await shutdown("uncaughtException");
  process.exit(1);
});
process.once("SIGINT", () => { shutdown("SIGINT").finally(() => process.exit(0)); });
process.once("SIGTERM", () => { shutdown("SIGTERM").finally(() => process.exit(0)); });

client.login(config.token).catch(error => {
  logError("discord-login", error, { guildId: config.guildId });
  store.close();
  rms?.close();
  releaseProcessLock?.();
  process.exitCode = 1;
});
