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
import { clean, memberLabel, mentionWithLabel, normalizeDate, normalizeDateRange, normalizeMultiline, rankRoleEntries, resolveTrainingTimeZone, splitTimeRange, todayInTimeZone } from "./format.js";
import { PendingActions } from "./pending-actions.js";
import { PabStore } from "./store.js";

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers] });
const store = new PabStore(config.dataPath);
const pending = new PendingActions(store);
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

function isNotifiableRole(role) {
  return role
    && role.id !== role.guild.id
    && !role.managed
    && !role.permissions.has(PermissionFlagsBits.Administrator);
}

function unauthorized(interaction) {
  return interaction.reply({ content: "Only PAB or Command members can use this workflow.", ephemeral: true });
}

function unauthorizedAdmin(interaction) {
  return interaction.reply({ content: "Only a server administrator can run live setup diagnostics or export the local PAB ledger.", ephemeral: true });
}

const workflowRequirements = {
  "training-log": ["pabRoleId", "commandRoleId", "trainingRecordsChannelId", "auditLogChannelId"],
  promotion: ["pabRoleId", "commandRoleId", "personnelRecordsChannelId", "promotionsAnnouncementsChannelId", "auditLogChannelId", "pabApprovalsChannelId", "rankRoleIds"],
  "award-role": ["pabRoleId", "commandRoleId", "qualificationsRecordsChannelId", "auditLogChannelId", "awardableRoleIds"],
  "remove-role": ["pabRoleId", "commandRoleId", "qualificationsRecordsChannelId", "auditLogChannelId", "awardableRoleIds"],
  "department-record": ["pabRoleId", "commandRoleId", "personnelRecordsChannelId", "auditLogChannelId"],
  "correct-record": ["pabRoleId", "commandRoleId", "auditLogChannelId"],
  "promotion-check": ["pabRoleId", "commandRoleId", "pabApprovalsChannelId", "auditLogChannelId"],
  "personnel-status": ["pabRoleId", "commandRoleId", "personnelRecordsChannelId", "auditLogChannelId"],
  "inactivity-review": ["pabRoleId", "commandRoleId", "inactivityReviewChannelId", "auditLogChannelId"],
  "pab-announcement": ["pabRoleId", "commandRoleId", "pabAnnouncementsChannelId", "auditLogChannelId"],
  "pab-dashboard": ["pabRoleId", "commandRoleId"],
  "find-record": ["pabRoleId", "commandRoleId"]
};

function requiresConfiguration(interaction) {
  const issues = configurationIssues(workflowRequirements[interaction.commandName] || []);
  if (!issues.length) return false;
  interaction.reply({ content: `This workflow is not ready yet: ${issues.map(issue => `\`${issue}\``).join(", ")}. A server administrator can run \`/setup-status\`.`, ephemeral: true });
  return true;
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
    new ButtonBuilder().setCustomId(`cancel:${type}:${id}`).setLabel("Cancel").setStyle(ButtonStyle.Secondary)
  );
}

function trainingEmbed(data, title = "BCSO Training Record") {
  return new EmbedBuilder()
    .setColor(BLUE)
    .setTitle(title)
    .addFields(
      { name: "Trainer", value: data.trainerLabel, inline: false },
      { name: "Trainee", value: data.traineeLabel, inline: false },
      { name: "Date", value: data.date, inline: true },
      { name: "Time", value: `${data.startTime} ${data.timeZoneLabel || config.timeZoneLabel} – ${data.endTime} ${data.timeZoneLabel || config.timeZoneLabel}`, inline: true },
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
    `**Record ID:** \`${data.recordId}\``,
    `**CC:** <@&${config.pabRoleId}>${data.ccRoleId ? ` <@&${data.ccRoleId}>` : ""}`
  ].join("\n");
}

function recordEmbed(title, color, fields, footer = "Ricky PAB") {
  return new EmbedBuilder().setColor(color).setTitle(title).addFields(fields).setFooter({ text: footer }).setTimestamp();
}

function promotionCheckEmbed(data, title = "BCSO Promotion Eligibility Check") {
  return recordEmbed(title, BLUE, [
    { name: "Member", value: data.memberLabel, inline: false },
    { name: "Rank under review", value: data.rank, inline: true },
    { name: "Requested rank", value: data.requestedRank, inline: true },
    { name: "Eligibility summary", value: data.eligibility, inline: false },
    { name: "Supporting reference", value: data.reference, inline: false },
    { name: "PAB recommendation", value: data.recommendation, inline: false }
    ], "Ricky PAB — This is not promotion approval");
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
    { name: "Activity summary", value: data.summary, inline: false },
    { name: "PAB follow-up", value: data.followUp, inline: false }
  ], "Private PAB review — no role, access, or disciplinary action is applied");
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

function parseMessageLink(value) {
  const match = String(value || "").trim().match(/^https?:\/\/(?:canary\.|ptb\.)?discord(?:app)?\.com\/channels\/(\d+)\/(\d+)\/(\d+)\/?$/i);
  if (!match || match[1] !== config.guildId) return null;
  return { guildId: match[1], channelId: match[2], messageId: match[3], messageLink: match[0] };
}

async function fetchChannel(id) {
  const channel = await client.channels.fetch(id);
  if (!channel?.isTextBased()) throw new Error(`Configured channel ${id} is not a text-based channel.`);
  if (channel.guildId !== config.guildId) throw new Error(`Configured channel ${id} is not in the configured BCSO server.`);
  return channel;
}

async function audit(title, description) {
  const channel = await fetchChannel(config.auditLogChannelId);
  await channel.send({ embeds: [new EmbedBuilder().setColor(0x6b7280).setTitle(title).setDescription(clean(description, 4096)).setTimestamp()] });
}

function saveReceipt(type, interaction, action, message, recordId = null) {
  store.record({
    type,
    actorId: interaction.user.id,
    memberId: action.data.memberId || action.data.traineeId || null,
    recordId,
    message,
    data: action.data
  });
}

async function showTrainingModal(interaction) {
  const trainer = interaction.options.getMember("trainer");
  const trainee = interaction.options.getMember("trainee");
  if (!trainer || !trainee) return interaction.reply({ content: "Both members must be in this server.", ephemeral: true });
  const timezone = resolveTrainingTimeZone(interaction.options.getString("timezone"), { label: config.timeZoneLabel, timeZoneId: config.timeZoneId });
  const dateMode = interaction.options.getString("date") || "manual";
  const modal = new ModalBuilder().setCustomId(`training-modal:${trainer.id}:${trainee.id}:${timezone.value}`).setTitle(`BCSO training record — ${timezone.label}`);
  const dateInput = input("date", `Date (${DATE_FORMAT_HINT})`, TextInputStyle.Short, { placeholder: DATE_FORMAT_HINT, maxLength: 64 });
  if (dateMode === "today") dateInput.setValue(todayInTimeZone(timezone.timeZoneId));
  modal.addComponents(
    new ActionRowBuilder().addComponents(dateInput),
    new ActionRowBuilder().addComponents(input("time", `Start/end time (${timezone.label})`, TextInputStyle.Short, { placeholder: `4:00 PM - 5:00 PM ${timezone.label}`, maxLength: 80 })),
    new ActionRowBuilder().addComponents(input("training-type", "Training completed", TextInputStyle.Short, { placeholder: "Classroom, practical, and ride-along", maxLength: 200 })),
    new ActionRowBuilder().addComponents(input("outcome", "Outcome / recommendation", TextInputStyle.Paragraph, { placeholder: "Academy Complete — good to proceed to Deputy", maxLength: 800 })),
    new ActionRowBuilder().addComponents(input("notes", "Notes", TextInputStyle.Paragraph, { placeholder: "Performance, follow-up needs, and any important detail", maxLength: 1000 }))
  );
  return interaction.showModal(modal);
}

async function showPromotionModal(interaction) {
  const member = interaction.options.getMember("member");
  if (!member) return interaction.reply({ content: "That member must be in this server.", ephemeral: true });
  if (!member.manageable) return interaction.reply({ content: "The bot cannot manage that member. Check the bot role hierarchy before preparing a promotion.", ephemeral: true });
  const choices = rankRoleEntries(config.rankRoleIds).map(({ rank }) => rank).join(", ") || "Configure RANK_ROLE_IDS first";
  const modal = new ModalBuilder().setCustomId(`promotion-modal:${member.id}`).setTitle("BCSO promotion record");
  modal.addComponents(
    new ActionRowBuilder().addComponents(input("effective-date", `Effective date (${DATE_FORMAT_HINT})`, TextInputStyle.Short, { placeholder: DATE_FORMAT_HINT, maxLength: 64 })),
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
  if (!member.manageable || !role.editable) return interaction.reply({ content: "The bot cannot manage that member or role. Run `/pab-health` and fix the role hierarchy first.", ephemeral: true });
  const modal = new ModalBuilder().setCustomId(`role-award-modal:${member.id}:${role.id}`).setTitle("BCSO role award record");
  modal.addComponents(
    new ActionRowBuilder().addComponents(input("effective-date", `Effective date (${DATE_FORMAT_HINT})`, TextInputStyle.Short, { placeholder: DATE_FORMAT_HINT, maxLength: 64 })),
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
  if (!member.manageable || !role.editable) return interaction.reply({ content: "The bot cannot manage that member or role. Run `/pab-health` and fix the role hierarchy first.", ephemeral: true });
  if (!member.roles.cache.has(role.id)) return interaction.reply({ content: "That member does not currently hold the selected role.", ephemeral: true });
  const modal = new ModalBuilder().setCustomId(`role-removal-modal:${member.id}:${role.id}`).setTitle("BCSO role removal record");
  modal.addComponents(
    new ActionRowBuilder().addComponents(input("effective-date", `Effective date (${DATE_FORMAT_HINT})`, TextInputStyle.Short, { placeholder: DATE_FORMAT_HINT, maxLength: 64 })),
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
  const draftId = pending.create({ type: "department-record-draft", createdBy: interaction.user.id, data: { memberId: member.id, callsign, addedRoleId: addedRole?.id || null, removedRoleId: removedRole?.id || null, ccRoleId: ccRole?.id || null } });
  const modal = new ModalBuilder().setCustomId(`department-record-modal:${draftId}`).setTitle("PAB department record");
  modal.addComponents(
    new ActionRowBuilder().addComponents(input("record-type", "Record type", TextInputStyle.Short, { placeholder: "Training completion, promotion, role update", maxLength: 100 })),
    new ActionRowBuilder().addComponents(input("note", "Approved note", TextInputStyle.Paragraph, { placeholder: "Clear factual summary for the department record", maxLength: 1000 }))
  );
  return interaction.showModal(modal);
}

async function showCorrectionModal(interaction) {
  const reference = parseMessageLink(interaction.options.getString("message-link"));
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
  modal.addComponents(
    new ActionRowBuilder().addComponents(input("effective-date", `Effective date (${DATE_FORMAT_HINT})`, TextInputStyle.Short, { placeholder: DATE_FORMAT_HINT, maxLength: 64 })),
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
    new ActionRowBuilder().addComponents(input("last-activity", `Last known activity (${DATE_FORMAT_HINT})`, TextInputStyle.Short, { placeholder: DATE_FORMAT_HINT, maxLength: 80 })),
    new ActionRowBuilder().addComponents(input("summary", "Activity summary", TextInputStyle.Paragraph, { placeholder: "Factual attendance or activity notes for PAB review", maxLength: 1000 })),
    new ActionRowBuilder().addComponents(input("follow-up", "PAB follow-up", TextInputStyle.Paragraph, { placeholder: "Contact member / confirm status / no follow-up needed", maxLength: 1000 }))
  );
  return interaction.showModal(modal);
}

async function showAnnouncementModal(interaction) {
  const notifyRole = interaction.options.getRole("notify-role");
  if (notifyRole && !isNotifiableRole(notifyRole)) return interaction.reply({ content: "Choose a normal BCSO notification role. @everyone, managed roles, and administrator roles cannot be pinged by this workflow.", ephemeral: true });
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
    { name: "Pending approvals", value: String(summary.pending), inline: true },
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
  const configuredChannels = [
    ["Training records", config.trainingRecordsChannelId], ["Personnel records", config.personnelRecordsChannelId],
    ["Promotion announcements", config.promotionsAnnouncementsChannelId], ["PAB audit log", config.auditLogChannelId],
    ["PAB approvals", config.pabApprovalsChannelId], ["Qualification records", config.qualificationsRecordsChannelId],
    ["PAB announcements", config.pabAnnouncementsChannelId], ["Inactivity review", config.inactivityReviewChannelId]
  ];
  const missing = missingConfiguration(Object.keys(configLabels));
  const channelChecks = [];
  for (const [label, id] of configuredChannels) {
    if (!id) { channelChecks.push(`• ${label}: not configured`); continue; }
    try {
      const channel = await fetchChannel(id);
      const permissions = channel.permissionsFor(interaction.guild.members.me);
      const usable = permissions?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks]);
      channelChecks.push(`${usable ? "✓" : "✗"} ${label}: ${usable ? "reachable" : "bot lacks channel permissions"}`);
    } catch {
      channelChecks.push(`✗ ${label}: invalid, inaccessible, or outside this server`);
    }
  }
  const roleChecks = [];
  const botMember = interaction.guild.members.me;
  const controllerRole = botMember?.roles.cache.find(role => !role.managed && role.name.toLowerCase().includes("ricky controller"));
  const roleTargets = [
    ["PAB", config.pabRoleId, false], ["Command", config.commandRoleId, false],
    ...rankRoleEntries(config.rankRoleIds).map(item => [`Rank: ${item.rank}`, item.id, true]),
    ...[...config.awardableRoleIds].map(id => ["Allow-listed role", id, true])
  ];
  for (const [label, id, requiresManagement] of roleTargets) {
    if (!id) { roleChecks.push(`• ${label}: not configured`); continue; }
    const role = await interaction.guild.roles.fetch(id).catch(() => null);
    if (!role) roleChecks.push(`✗ ${label}: role not found`);
    else if (requiresManagement && role.managed) roleChecks.push(`✗ ${label}: managed integration role`);
    else if (requiresManagement && botMember.roles.highest.comparePositionTo(role) <= 0) roleChecks.push(`✗ ${label}: move ${controllerRole ? `\`${controllerRole.name}\`` : "the bot's highest role"} above it`);
    else roleChecks.push(`✓ ${label}: ${requiresManagement ? "manageable" : "found"}`);
  }
  return interaction.reply({
    ephemeral: true,
    embeds: [recordEmbed("Ricky Live Health Check", missing.length ? 0xb45309 : GREEN, [
      { name: "Configuration", value: missing.length ? `Missing: ${missing.join(", ")}` : "All required IDs and allow-lists are present.", inline: false },
      { name: "Channels", value: clean(channelChecks.join("\n"), 1024), inline: false },
      { name: "Role hierarchy", value: clean(roleChecks.join("\n") || "No rank/award roles configured yet.", 1024), inline: false }
    ], "Read-only check — no settings, roles, or messages were changed")]
  });
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

async function handleModal(interaction) {
  const modalParts = interaction.customId.split(":");
  const kind = modalParts[0];
  if (kind === "training-modal") {
    const [, trainerId, traineeId, timezoneValue] = modalParts;
    const timezone = resolveTrainingTimeZone(timezoneValue, { label: config.timeZoneLabel, timeZoneId: config.timeZoneId });
    const [trainer, trainee] = await Promise.all([interaction.guild.members.fetch(trainerId), interaction.guild.members.fetch(traineeId)]);
    const [startTime, endTime] = splitTimeRange(interaction.fields.getTextInputValue("time"), timezone.label);
    if (!startTime || !endTime) return interaction.reply({ content: `Enter a time range such as \`4 PM - 5 PM\` or \`4:00 PM - 5:00 PM ${timezone.label}\`.`, ephemeral: true });
    const date = normalizeDate(interaction.fields.getTextInputValue("date"));
    if (!date) return interaction.reply({ content: `Enter the date as \`${DATE_FORMAT_HINT}\`, for example \`08/06/2026\`.`, ephemeral: true });
    const data = {
      trainerId,
      traineeId,
      trainerLabel: mentionWithLabel(trainer),
      traineeLabel: mentionWithLabel(trainee),
      date,
      startTime,
      endTime,
      timeZoneLabel: timezone.label,
      trainingType: clean(interaction.fields.getTextInputValue("training-type"), 200),
      outcome: normalizeMultiline(interaction.fields.getTextInputValue("outcome")),
      notes: normalizeMultiline(interaction.fields.getTextInputValue("notes")),
      signedBy: memberLabel(interaction.member),
      signerRank: rankNameForMember(interaction.member)
    };
    const id = pending.create({ type: "training", createdBy: interaction.user.id, data });
    return interaction.reply({ content: "Preview only — review the record, then approve to post it.", embeds: [trainingEmbed(data, "Preview — BCSO Training Record")], components: [approvalRow(id, "training")], ephemeral: true });
  }
  if (kind === "promotion-modal") {
    const member = await interaction.guild.members.fetch(modalParts[1]);
    const fromRank = clean(interaction.fields.getTextInputValue("from-rank"), 80);
    const toRank = clean(interaction.fields.getTextInputValue("to-rank"), 80);
    if (!config.rankRoleIds[fromRank] || !config.rankRoleIds[toRank]) return interaction.reply({ content: `Both ranks must exactly match configured ranks: ${Object.keys(config.rankRoleIds).join(", ") || "none"}.`, ephemeral: true });
    if (fromRank === toRank) return interaction.reply({ content: "The current and new rank cannot be the same.", ephemeral: true });
    const data = {
      memberId: member.id,
      memberLabel: mentionWithLabel(member),
      effectiveDate: normalizeDate(interaction.fields.getTextInputValue("effective-date")),
      fromRank,
      toRank,
      authorizedBy: clean(interaction.fields.getTextInputValue("authorized-by"), 200),
      reason: normalizeMultiline(interaction.fields.getTextInputValue("reason"))
    };
    if (!data.effectiveDate) return interaction.reply({ content: `Enter the effective date as \`${DATE_FORMAT_HINT}\`, for example \`08/06/2026\`.`, ephemeral: true });
    const id = pending.create({ type: "promotion", createdBy: interaction.user.id, data });
    const approvalChannel = await fetchChannel(config.pabApprovalsChannelId);
    await approvalChannel.send({
      content: `Command approval required for ${data.memberLabel}. Submitted by <@${interaction.user.id}>.`,
      allowedMentions: { users: [interaction.user.id, member.id] },
      embeds: [promotionEmbed(data, "Approval Required — BCSO Promotion")],
      components: [approvalRow(id, "promotion", "Command approve & apply")]
    });
    return interaction.reply({ content: "Promotion request sent to the private PAB approvals channel. No roles changed.", embeds: [promotionEmbed(data, "Submitted — BCSO Personnel Action")], ephemeral: true });
  }
  if (kind === "role-award-modal") {
    const [, memberId, roleId] = modalParts;
    const [member, role] = await Promise.all([interaction.guild.members.fetch(memberId), interaction.guild.roles.fetch(roleId)]);
    if (!role || !isApprovedAwardRole(role)) return interaction.reply({ content: "That role is no longer eligible for PAB awards.", ephemeral: true });
    const data = {
      memberId: member.id,
      memberLabel: mentionWithLabel(member),
      roleId: role.id,
      roleName: clean(role.name, 100),
      effectiveDate: normalizeDate(interaction.fields.getTextInputValue("effective-date")),
      authorizedBy: clean(interaction.fields.getTextInputValue("authorized-by"), 200),
      reason: normalizeMultiline(interaction.fields.getTextInputValue("reason"))
    };
    if (!data.effectiveDate) return interaction.reply({ content: `Enter the effective date as \`${DATE_FORMAT_HINT}\`, for example \`08/06/2026\`.`, ephemeral: true });
    const id = pending.create({ type: "role-award", createdBy: interaction.user.id, data });
    return interaction.reply({ content: "Preview only — review the award, then approve to apply the role and post it.", embeds: [roleAwardEmbed(data, "Preview — BCSO Role Award")], components: [approvalRow(id, "role-award")], ephemeral: true });
  }
  if (kind === "role-removal-modal") {
    const [, memberId, roleId] = modalParts;
    const [member, role] = await Promise.all([interaction.guild.members.fetch(memberId), interaction.guild.roles.fetch(roleId)]);
    if (!role || !isApprovedAwardRole(role)) return interaction.reply({ content: "That role is no longer eligible for PAB removal.", ephemeral: true });
    if (!member.roles.cache.has(role.id)) return interaction.reply({ content: "That member no longer holds the selected role.", ephemeral: true });
    const data = {
      memberId: member.id,
      memberLabel: mentionWithLabel(member),
      roleId: role.id,
      roleName: clean(role.name, 100),
      effectiveDate: normalizeDate(interaction.fields.getTextInputValue("effective-date")),
      authorizedBy: clean(interaction.fields.getTextInputValue("authorized-by"), 200),
      reason: normalizeMultiline(interaction.fields.getTextInputValue("reason"))
    };
    if (!data.effectiveDate) return interaction.reply({ content: `Enter the effective date as \`${DATE_FORMAT_HINT}\`, for example \`08/06/2026\`.`, ephemeral: true });
    const id = pending.create({ type: "role-removal", createdBy: interaction.user.id, data });
    return interaction.reply({ content: "Preview only — review the approved removal before it changes the role.", embeds: [roleRemovalEmbed(data, "Preview — BCSO Role Removal")], components: [approvalRow(id, "role-removal", "Approve & remove")], ephemeral: true });
  }
  if (kind === "department-record-modal") {
    const draft = pending.take(modalParts[1], interaction.user.id, action => action.type === "department-record-draft" ? null : "This form expired. Run the command again.");
    if (draft.error) return interaction.reply({ content: draft.error, ephemeral: true });
    const { memberId, callsign, addedRoleId, removedRoleId, ccRoleId } = draft.action.data;
    const member = await interaction.guild.members.fetch(memberId);
    const data = {
      memberId: member.id,
      callsign,
      addedRoleId,
      removedRoleId,
      ccRoleId,
      recordType: clean(interaction.fields.getTextInputValue("record-type"), 100),
      note: normalizeMultiline(interaction.fields.getTextInputValue("note")),
      recordId: `PAB-${randomUUID().slice(0, 8).toUpperCase()}`
    };
    const id = pending.create({ type: "department-record", createdBy: interaction.user.id, data });
    return interaction.reply({ content: "Preview only — approve to post the PAB department record.", embeds: [new EmbedBuilder().setColor(BLUE).setTitle("Preview — PAB Department Record").setDescription(departmentRecordText(data))], components: [approvalRow(id, "department-record")], ephemeral: true });
  }
  if (kind === "correction-modal") {
    const draft = pending.take(modalParts[1], interaction.user.id, action => action.type === "correction-draft" ? null : "This form expired. Run the command again.");
    if (draft.error) return interaction.reply({ content: draft.error, ephemeral: true });
    const data = { ...draft.action.data, correction: normalizeMultiline(interaction.fields.getTextInputValue("correction")), correctedBy: memberLabel(interaction.member) };
    const id = pending.create({ type: "correction", createdBy: interaction.user.id, data });
    return interaction.reply({ content: "Preview only — approval posts a new correction and preserves the original record.", embeds: [correctionEmbed(data, "Preview — BCSO PAB Record Correction")], components: [approvalRow(id, "correction")], ephemeral: true });
  }
  if (kind === "promotion-check-modal") {
    const draft = pending.take(modalParts[1], interaction.user.id, action => action.type === "promotion-check-draft" ? null : "This form expired. Run the command again.");
    if (draft.error) return interaction.reply({ content: draft.error, ephemeral: true });
    const member = await interaction.guild.members.fetch(draft.action.data.memberId);
    const data = {
      memberId: member.id,
      memberLabel: mentionWithLabel(member),
      rank: clean(interaction.fields.getTextInputValue("rank"), 80),
      requestedRank: clean(interaction.fields.getTextInputValue("requested-rank"), 80),
      eligibility: normalizeMultiline(interaction.fields.getTextInputValue("eligibility")),
      reference: normalizeMultiline(interaction.fields.getTextInputValue("reference")),
      recommendation: normalizeMultiline(interaction.fields.getTextInputValue("recommendation"))
    };
    const id = pending.create({ type: "promotion-check", createdBy: interaction.user.id, data });
    return interaction.reply({ content: "Preview only — this is a human PAB checklist, not promotion approval.", embeds: [promotionCheckEmbed(data, "Preview — BCSO Promotion Eligibility Check")], components: [approvalRow(id, "promotion-check", "Approve checklist")], ephemeral: true });
  }
  if (kind === "personnel-status-modal") {
    const draft = pending.take(modalParts[1], interaction.user.id, action => action.type === "personnel-status-draft" ? null : "This form expired. Run the command again.");
    if (draft.error) return interaction.reply({ content: draft.error, ephemeral: true });
    const member = await interaction.guild.members.fetch(draft.action.data.memberId);
    const data = {
      memberId: member.id,
      memberLabel: mentionWithLabel(member),
      status: draft.action.data.status,
      effectiveDate: normalizeDate(interaction.fields.getTextInputValue("effective-date")),
      authorizedBy: clean(interaction.fields.getTextInputValue("authorized-by"), 200),
      detail: normalizeMultiline(interaction.fields.getTextInputValue("detail"))
    };
    if (!data.effectiveDate) return interaction.reply({ content: `Enter the effective date as \`${DATE_FORMAT_HINT}\`, for example \`08/06/2026\`.`, ephemeral: true });
    const id = pending.create({ type: "personnel-status", createdBy: interaction.user.id, data });
    return interaction.reply({ content: "Preview only — approval posts this record only. It will not change roles or remove access.", embeds: [statusEmbed(data, "Preview — BCSO Personnel Status")], components: [approvalRow(id, "personnel-status")], ephemeral: true });
  }
  if (kind === "inactivity-review-modal") {
    const draft = pending.take(modalParts[1], interaction.user.id, action => action.type === "inactivity-review-draft" ? null : "This form expired. Run the command again.");
    if (draft.error) return interaction.reply({ content: draft.error, ephemeral: true });
    const member = await interaction.guild.members.fetch(draft.action.data.memberId);
    const data = {
      memberId: member.id,
      memberLabel: mentionWithLabel(member),
      reviewPeriod: normalizeDateRange(interaction.fields.getTextInputValue("review-period")),
      lastActivity: normalizeDate(interaction.fields.getTextInputValue("last-activity")),
      summary: normalizeMultiline(interaction.fields.getTextInputValue("summary")),
      followUp: normalizeMultiline(interaction.fields.getTextInputValue("follow-up"))
    };
    if (!data.reviewPeriod || !data.lastActivity) return interaction.reply({ content: `Enter the review period as \`${DATE_RANGE_FORMAT_HINT}\` and last activity as \`${DATE_FORMAT_HINT}\`.`, ephemeral: true });
    const id = pending.create({ type: "inactivity-review", createdBy: interaction.user.id, data });
    return interaction.reply({ content: "Preview only — approval posts a private PAB review. It does not change roles, access, or apply discipline.", embeds: [inactivityReviewEmbed(data, "Preview — BCSO PAB Inactivity Review")], components: [approvalRow(id, "inactivity-review", "Post private review")], ephemeral: true });
  }
  if (kind === "announcement-modal") {
    const draft = pending.take(modalParts[1], interaction.user.id, action => action.type === "announcement-draft" ? null : "This form expired. Run the command again.");
    if (draft.error) return interaction.reply({ content: draft.error, ephemeral: true });
    const data = {
      ...draft.action.data,
      title: clean(interaction.fields.getTextInputValue("title"), 200),
      message: normalizeMultiline(interaction.fields.getTextInputValue("message")),
      authorName: memberLabel(interaction.member)
    };
    const id = pending.create({ type: "announcement", createdBy: interaction.user.id, data });
    return interaction.reply({ content: "Preview only — review the announcement and its selected notification role.", embeds: [announcementEmbed(data, `Preview — ${data.title}`)], components: [approvalRow(id, "announcement", "Approve & announce")], ephemeral: true });
  }
}

async function approveTraining(interaction, action) {
  const channel = await fetchChannel(config.trainingRecordsChannelId);
  const message = await channel.send({ content: `<@${action.data.trainerId}> <@${action.data.traineeId}>`, allowedMentions: { users: [action.data.trainerId, action.data.traineeId] }, embeds: [trainingEmbed(action.data)] });
  saveReceipt("training", interaction, action, message);
  action.committed = true;
  await audit("Training record posted", `${action.data.traineeLabel} | Trainer: ${action.data.trainerLabel} | Posted by <@${interaction.user.id}>`);
  return interaction.update({ content: "Training record posted and logged.", embeds: [trainingEmbed(action.data)], components: [] });
}

async function approvePromotion(interaction, action) {
  if (!mayApprovePromotion(interaction.member)) return interaction.reply({ content: "A Command member must approve and apply a promotion.", ephemeral: true });
  const member = await interaction.guild.members.fetch(action.data.memberId);
  if (!member.manageable) throw new Error("The bot can no longer manage the target member.");
  const configuredRanks = rankRoleEntries(config.rankRoleIds);
  const currentRankRoles = configuredRanks.filter(({ id }) => member.roles.cache.has(id)).map(({ id }) => id);
  const targetRoleId = config.rankRoleIds[action.data.toRank];
  const roleTargets = await Promise.all([...new Set([...currentRankRoles, targetRoleId])].map(id => interaction.guild.roles.fetch(id)));
  if (roleTargets.some(role => !role?.editable)) throw new Error("The bot can no longer manage one or more configured rank roles.");
  if (!member.roles.cache.has(config.rankRoleIds[action.data.fromRank])) throw new Error(`${member.user.tag} does not currently have the configured ${action.data.fromRank} role.`);
  const rolesToRemove = currentRankRoles.filter(id => id !== targetRoleId);
  if (rolesToRemove.length) await member.roles.remove(rolesToRemove, `BCSO promotion to ${action.data.toRank} approved by ${interaction.user.tag}`);
  if (!member.roles.cache.has(targetRoleId)) await member.roles.add(targetRoleId, `BCSO promotion approved by ${interaction.user.tag}`);
  const [recordChannel, announcementChannel] = await Promise.all([fetchChannel(config.personnelRecordsChannelId), fetchChannel(config.promotionsAnnouncementsChannelId)]);
  const recordMessage = await recordChannel.send({ content: `<@${member.id}>`, allowedMentions: { users: [member.id] }, embeds: [promotionEmbed(action.data)] });
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
  if (!member.manageable || !role.editable) throw new Error("The bot can no longer manage that member or role.");
  if (!member.roles.cache.has(action.data.roleId)) await member.roles.add(action.data.roleId, `BCSO role award approved by ${interaction.user.tag}`);
  const channel = await fetchChannel(config.qualificationsRecordsChannelId);
  const message = await channel.send({ content: `<@${member.id}>`, allowedMentions: { users: [member.id] }, embeds: [roleAwardEmbed(action.data)] });
  saveReceipt("role-award", interaction, action, message);
  action.committed = true;
  await audit("Qualification or unit role awarded", `${action.data.memberLabel} | ${action.data.roleName} | Awarded by <@${interaction.user.id}>`);
  return interaction.update({ content: `Role applied and recorded: ${action.data.memberLabel} received **${action.data.roleName}**.`, embeds: [roleAwardEmbed(action.data)], components: [] });
}

async function approveRoleRemoval(interaction, action) {
  const member = await interaction.guild.members.fetch(action.data.memberId);
  const role = await interaction.guild.roles.fetch(action.data.roleId);
  if (!role || !isApprovedAwardRole(role)) throw new Error("The selected role is no longer eligible for PAB removal.");
  if (!member.manageable || !role.editable) throw new Error("The bot can no longer manage that member or role.");
  if (!member.roles.cache.has(action.data.roleId)) throw new Error("The member no longer holds the selected role.");
  await member.roles.remove(action.data.roleId, `BCSO role removal approved by ${interaction.user.tag}`);
  const channel = await fetchChannel(config.qualificationsRecordsChannelId);
  const message = await channel.send({ content: `<@${member.id}>`, allowedMentions: { users: [member.id] }, embeds: [roleRemovalEmbed(action.data)] });
  saveReceipt("role-removal", interaction, action, message);
  action.committed = true;
  await audit("Qualification or unit role removed", `${action.data.memberLabel} | ${action.data.roleName} | Removed by <@${interaction.user.id}>`);
  return interaction.update({ content: `Role removed and recorded: ${action.data.memberLabel} no longer has **${action.data.roleName}**.`, embeds: [roleRemovalEmbed(action.data)], components: [] });
}

async function approveDepartmentRecord(interaction, action) {
  const channel = await fetchChannel(config.personnelRecordsChannelId);
  const roleMentions = [config.pabRoleId, action.data.ccRoleId].filter(Boolean);
  const message = await channel.send({ content: departmentRecordText(action.data), allowedMentions: { users: [action.data.memberId], roles: roleMentions } });
  saveReceipt("department-record", interaction, action, message, action.data.recordId);
  action.committed = true;
  await audit("PAB department record posted", `${action.data.recordId} | <@${action.data.memberId}> | Posted by <@${interaction.user.id}>`);
  return interaction.update({ content: `Department record ${action.data.recordId} posted and logged.`, components: [] });
}

async function approveCorrection(interaction, action) {
  const channel = await fetchChannel(action.data.channelId);
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
  const channel = await fetchChannel(config.personnelRecordsChannelId);
  const message = await channel.send({ embeds: [statusEmbed(action.data)], allowedMentions: { parse: [] } });
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
  const content = action.data.notifyRoleId ? `<@&${action.data.notifyRoleId}>` : undefined;
  const message = await channel.send({ content, embeds: [announcementEmbed(action.data, action.data.title)], allowedMentions: { roles: action.data.notifyRoleId ? [action.data.notifyRoleId] : [] } });
  saveReceipt("announcement", interaction, action, message);
  action.committed = true;
  await audit("PAB announcement posted", `${action.data.title} | Posted by <@${interaction.user.id}>`);
  return interaction.update({ content: "PAB announcement posted and logged.", embeds: [announcementEmbed(action.data, action.data.title)], components: [] });
}

client.once(Events.ClientReady, readyClient => console.log(`Ricky online as ${readyClient.user.tag}; durable data store ready.`));
client.on(Events.Error, error => console.error(`Discord client error: ${error instanceof Error ? error.message : "unknown error"}`));

client.on(Events.InteractionCreate, async interaction => {
  let claimedActionId = null;
  let claimedAction = null;
  try {
    if (interaction.isChatInputCommand()) {
      if (["setup-status", "pab-health", "export-audit"].includes(interaction.commandName)) {
        if (!isServerAdministrator(interaction.member)) return unauthorizedAdmin(interaction);
        if (interaction.commandName === "setup-status") return interaction.reply({ embeds: [setupStatusEmbed()], ephemeral: true });
        if (interaction.commandName === "pab-health") return runHealthCheck(interaction);
        if (interaction.commandName === "export-audit") return exportAudit(interaction);
      }
      if (!mayUsePab(interaction.member)) return unauthorized(interaction);
      if (requiresConfiguration(interaction)) return;
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
      if (interaction.commandName === "pab-announcement") return showAnnouncementModal(interaction);
      if (interaction.commandName === "pab-dashboard") return interaction.reply({ embeds: [dashboardEmbed()], ephemeral: true });
      if (interaction.commandName === "find-record") return findRecord(interaction);
    }
    if (interaction.isModalSubmit()) {
      if (!mayUsePab(interaction.member)) return unauthorized(interaction);
      return handleModal(interaction);
    }
    if (interaction.isButton()) {
      if (!mayUsePab(interaction.member)) return unauthorized(interaction);
      const [decision, type, id] = interaction.customId.split(":");
      if (!["approve", "cancel"].includes(decision) || !id) return;
      if (decision === "cancel") {
        const cancellation = pending.take(id, interaction.user.id, action => {
          if ((type === "training" || type === "role-award" || type === "role-removal" || type === "department-record" || type === "correction" || type === "promotion-check" || type === "personnel-status" || type === "inactivity-review" || type === "announcement") && action.createdBy !== interaction.user.id) return "Only the PAB member who created this preview can cancel it.";
          if (type === "promotion" && action.createdBy !== interaction.user.id && !mayApprovePromotion(interaction.member)) return "Only the submitting PAB member or Command can cancel this promotion request.";
          return null;
        });
        if (cancellation.error) return interaction.reply({ content: cancellation.error, ephemeral: true });
        claimedActionId = cancellation.action.id;
        const response = await interaction.update({ content: "Cancelled. Nothing was posted or changed.", embeds: [], components: [] });
        pending.complete(claimedActionId);
        claimedActionId = null;
        return response;
      }
      const result = pending.take(id, interaction.user.id, action => {
        if ((type === "training" || type === "role-award" || type === "role-removal" || type === "department-record" || type === "correction" || type === "promotion-check" || type === "personnel-status" || type === "inactivity-review" || type === "announcement") && action.createdBy !== interaction.user.id) return "Only the PAB member who created this preview can approve it.";
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
    console.error(`Workflow error: ${error instanceof Error ? error.message : "unknown error"}`);
    const message = "I could not complete that action. Check the bot role hierarchy, configured channel IDs, and server permissions.";
    if (interaction.deferred || interaction.replied) await interaction.followUp({ content: message, ephemeral: true });
    else await interaction.reply({ content: message, ephemeral: true });
  }
});

async function shutdown(signal) {
  console.log(`Ricky received ${signal}; closing Discord connection and local data store.`);
  client.destroy();
  store.close();
}

process.once("SIGINT", () => { shutdown("SIGINT").finally(() => process.exit(0)); });
process.once("SIGTERM", () => { shutdown("SIGTERM").finally(() => process.exit(0)); });

client.login(config.token).catch(error => {
  console.error(`Ricky could not log in: ${error instanceof Error ? error.message : "unknown error"}`);
  store.close();
  process.exitCode = 1;
});
