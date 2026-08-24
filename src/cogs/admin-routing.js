import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  PermissionFlagsBits,
  SlashCommandBuilder
} from "discord.js";
import { ACTIVITY_CONFIG_CHOICES, CHANNEL_CONFIG_CHOICES, CHANNEL_CONFIG_FIELDS } from "../runtime-config.js";

const BLUE = 0x1d4e89;

// A Ricky cog is a self-contained feature boundary: it owns its slash-command
// definitions and interaction handlers, while the existing bot lifecycle and
// stores remain shared. This keeps the JavaScript app modular without a rewrite.
export const commands = [
  new SlashCommandBuilder()
    .setName("config-channel")
    .setDescription("Preview and save one Ricky channel routing setting (server admin only).")
    .addStringOption(option => option.setName("setting").setDescription("Channel-backed setting to change.").setRequired(true).addChoices(...CHANNEL_CONFIG_CHOICES))
    .addChannelOption(option => option.setName("channel").setDescription("New destination channel.").setRequired(true).addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement, ChannelType.GuildForum)),
  new SlashCommandBuilder()
    .setName("config-activity")
    .setDescription("Preview and add/remove a Ricky activity-source channel (server admin only).")
    .addStringOption(option => option.setName("mode").setDescription("Add or remove this activity source.").setRequired(true).addChoices(...ACTIVITY_CONFIG_CHOICES))
    .addChannelOption(option => option.setName("channel").setDescription("Channel whose messages may be tracked for inactivity review.").setRequired(true).addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement))
];

export function createAdminRoutingCog({ config, pending, audit, rms, logError, expiryText, isServerAdministrator, channelPermissionIssue, persistChannelConfig, persistActivityChannelConfig }) {
  function configApprovalRow(id, type) {
    return new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`approve:${type}:${id}`).setLabel("Confirm & save").setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`cancel:${type}:${id}`).setLabel("Cancel").setStyle(ButtonStyle.Secondary)
    );
  }

  function configChangeEmbed(data, value) {
    const isActivity = data.type === "config-activity";
    const nextValue = Array.isArray(value) ? (value.length ? value.map(id => `<#${id}>`).join(", ") : "None") : `<#${value}>`;
    return new EmbedBuilder()
      .setColor(BLUE)
      .setTitle(isActivity ? "Ricky activity-source configuration" : "Ricky channel routing configuration")
      .addFields(
        { name: "Setting", value: data.settingLabel || "Activity source", inline: true },
        { name: "Requested by", value: `<@${data.createdBy}>`, inline: true },
        { name: "New value", value: nextValue, inline: false },
        { name: "Persistence", value: "Saved to `data/runtime-config.json` after administrator confirmation. Protected role IDs, tokens, and allow-lists are never changed by this workflow.", inline: false }
      )
      .setFooter({ text: "Ricky Bot • administrator confirmation required" })
      .setTimestamp();
  }

  function channelConfigurationIssue(channel, field, botMember) {
    if (!channel || channel.guildId !== config.guildId) return "Choose a channel from the configured BCSO server.";
    if (field.forum && channel.type !== ChannelType.GuildForum) return "This setting requires a forum channel.";
    if (!field.forum && channel.type === ChannelType.GuildForum) return "This setting requires a standard text or announcement channel, not a forum.";
    const required = field.forum
      ? [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks, PermissionFlagsBits.CreatePublicThreads]
      : [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks, PermissionFlagsBits.ReadMessageHistory];
    return channelPermissionIssue(channel, botMember, required);
  }

  async function previewChannelConfig(interaction) {
    await interaction.deferReply({ ephemeral: true });
    const setting = interaction.options.getString("setting");
    const channel = interaction.options.getChannel("channel");
    const field = CHANNEL_CONFIG_FIELDS[setting];
    if (!field) return interaction.editReply({ content: "That routing setting is not supported. Choose one of the listed channel settings." });
    const botMember = interaction.guild.members.me || await interaction.guild.members.fetchMe();
    const issue = channelConfigurationIssue(channel, field, botMember);
    if (issue) return interaction.editReply({ content: `${issue} Ricky did not save anything. Run \`/pab-health\` after correcting the channel permissions.` });
    const id = pending.create({
      type: "config-channel",
      createdBy: interaction.user.id,
      data: {
        type: "config-channel",
        setting,
        settingLabel: field.label,
        channelId: channel.id,
        channelName: channel.name,
        oldChannelId: config[setting] || null,
        forum: field.forum,
        createdBy: interaction.user.id
      }
    });
    const oldValue = config[setting] ? `<#${config[setting]}>` : "Not configured";
    const embed = configChangeEmbed({ type: "config-channel", settingLabel: field.label, createdBy: interaction.user.id }, channel.id)
      .addFields({ name: "Current value", value: oldValue, inline: false });
    return interaction.editReply({
      content: `Preview only — save Ricky's **${field.label}** destination as <#${channel.id}>? ${expiryText(id)}`,
      embeds: [embed],
      components: [configApprovalRow(id, "config-channel")],
      allowedMentions: { parse: [] }
    });
  }

  async function previewActivityConfig(interaction) {
    await interaction.deferReply({ ephemeral: true });
    const mode = interaction.options.getString("mode");
    const channel = interaction.options.getChannel("channel");
    if (!["add", "remove"].includes(mode)) return interaction.editReply({ content: "Choose Add activity source or Remove activity source." });
    if (!channel || channel.guildId !== config.guildId || ![ChannelType.GuildText, ChannelType.GuildAnnouncement].includes(channel.type)) {
      return interaction.editReply({ content: "Choose a standard text or announcement channel from the configured BCSO server." });
    }
    const botMember = interaction.guild.members.me || await interaction.guild.members.fetchMe();
    const issue = channelPermissionIssue(channel, botMember, [PermissionFlagsBits.ViewChannel]);
    if (issue) return interaction.editReply({ content: `${issue} Ricky did not save anything. Run \`/pab-health\` after correcting the channel permissions.` });
    const alreadyConfigured = config.activityChannelIds.has(channel.id);
    if (mode === "add" && alreadyConfigured) return interaction.editReply({ content: `<#${channel.id}> is already an approved activity source. Nothing changed.` });
    if (mode === "remove" && !alreadyConfigured) return interaction.editReply({ content: `<#${channel.id}> is not currently an approved activity source. Nothing changed.` });
    const id = pending.create({
      type: "config-activity",
      createdBy: interaction.user.id,
      data: {
        type: "config-activity",
        mode,
        channelId: channel.id,
        channelName: channel.name,
        settingLabel: `${mode === "add" ? "Add" : "Remove"} activity source`,
        oldChannelIds: [...config.activityChannelIds],
        createdBy: interaction.user.id
      }
    });
    const projected = mode === "add" ? [...new Set([...config.activityChannelIds, channel.id])] : [...config.activityChannelIds].filter(idValue => idValue !== channel.id);
    const embed = configChangeEmbed({ type: "config-activity", settingLabel: `${mode === "add" ? "Add" : "Remove"} activity source`, createdBy: interaction.user.id }, projected);
    return interaction.editReply({
      content: `Preview only — ${mode === "add" ? "add" : "remove"} <#${channel.id}> ${mode === "add" ? "as an approved activity source" : "from approved activity sources"}? ${expiryText(id)}`,
      embeds: [embed],
      components: [configApprovalRow(id, "config-activity")],
      allowedMentions: { parse: [] }
    });
  }

  async function approveConfiguration(interaction, action) {
    if (!isServerAdministrator(interaction.member)) return interaction.reply({ content: "Only a server administrator can save Ricky routing changes.", ephemeral: true });
    const data = action.data;
    const value = action.type === "config-channel"
      ? persistChannelConfig(data.setting, data.channelId)
      : persistActivityChannelConfig(data.mode, data.channelId);
    action.committed = true;
    try {
      await audit("Ricky routing configuration changed", action.type === "config-channel"
        ? `${data.settingLabel}: ${data.oldChannelId ? `<#${data.oldChannelId}>` : "Not configured"} → <#${data.channelId}> | Changed by <@${interaction.user.id}>`
        : `${data.settingLabel}: <#${data.channelId}> | Changed by <@${interaction.user.id}>`);
    } catch (error) {
      logError("config-audit", error, { actionId: action.id, setting: data.setting || "activityChannelIds" });
    }
    if (rms) {
      try {
        rms.audit({ guildId: interaction.guild.id, actorDiscordId: interaction.user.id, action: "configuration_changed", entityType: "configuration", entityId: data.setting || "activityChannelIds", metadata: { channelId: data.channelId, mode: data.mode || "set" } });
      } catch (error) {
        logError("rms.config-audit", error, { actionId: action.id });
      }
    }
    const next = action.type === "config-channel" ? `<#${value}>` : (value.length ? value.map(id => `<#${id}>`).join(", ") : "None");
    return interaction.update({ content: `Saved. Ricky will use ${next}. Run \`/pab-health\` to verify the live routing and permissions.`, embeds: [configChangeEmbed(data, value)], components: [], allowedMentions: { parse: [] } });
  }

  return Object.freeze({
    commands,
    isConfigurationType: type => type === "config-channel" || type === "config-activity",
    previewChannelConfig,
    previewActivityConfig,
    approveConfiguration
  });
}
