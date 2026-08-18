import "dotenv/config";
import { resolve } from "node:path";

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function optional(name) {
  return process.env[name]?.trim() || "";
}

function parseRoleMap(value) {
  try {
    const parsed = JSON.parse(value || "{}");
    if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") throw new Error();
    return Object.fromEntries(Object.entries(parsed).map(([rank, id]) => [rank, String(id)]));
  } catch {
    throw new Error("RANK_ROLE_IDS must be a JSON object of rank names to Discord role IDs.");
  }
}

function parseIdList(value) {
  return new Set((value || "").split(",").map(id => id.trim()).filter(Boolean));
}

export const config = {
  token: required("DISCORD_TOKEN"),
  clientId: required("DISCORD_CLIENT_ID"),
  guildId: required("DISCORD_GUILD_ID"),
  pabRoleId: optional("PAB_ROLE_ID"),
  commandRoleId: optional("COMMAND_ROLE_ID"),
  trainingRecordsChannelId: optional("TRAINING_RECORDS_CHANNEL_ID"),
  personnelRecordsChannelId: optional("PERSONNEL_RECORDS_CHANNEL_ID"),
  promotionsAnnouncementsChannelId: optional("PROMOTIONS_ANNOUNCEMENTS_CHANNEL_ID"),
  auditLogChannelId: optional("AUDIT_LOG_CHANNEL_ID"),
  pabApprovalsChannelId: optional("PAB_APPROVALS_CHANNEL_ID"),
  qualificationsRecordsChannelId: optional("QUALIFICATIONS_RECORDS_CHANNEL_ID"),
  pabAnnouncementsChannelId: optional("PAB_ANNOUNCEMENTS_CHANNEL_ID"),
  inactivityReviewChannelId: optional("INACTIVITY_REVIEW_CHANNEL_ID"),
  rankRoleIds: parseRoleMap(process.env.RANK_ROLE_IDS),
  awardableRoleIds: parseIdList(process.env.AWARDABLE_ROLE_IDS),
  timeZoneLabel: process.env.TIME_ZONE_LABEL?.trim() || "MST",
  timeZoneId: process.env.TIME_ZONE_ID?.trim() || "Etc/GMT+7",
  brandEmoji: process.env.BCSO_BRAND_EMOJI?.trim() || "",
  dataPath: resolve(process.env.PAB_DATA_PATH?.trim() || "data/pab.sqlite")
};

export const configLabels = {
  pabRoleId: "PAB_ROLE_ID",
  commandRoleId: "COMMAND_ROLE_ID",
  trainingRecordsChannelId: "TRAINING_RECORDS_CHANNEL_ID",
  personnelRecordsChannelId: "PERSONNEL_RECORDS_CHANNEL_ID",
  promotionsAnnouncementsChannelId: "PROMOTIONS_ANNOUNCEMENTS_CHANNEL_ID",
  auditLogChannelId: "AUDIT_LOG_CHANNEL_ID",
  pabApprovalsChannelId: "PAB_APPROVALS_CHANNEL_ID",
  qualificationsRecordsChannelId: "QUALIFICATIONS_RECORDS_CHANNEL_ID",
  pabAnnouncementsChannelId: "PAB_ANNOUNCEMENTS_CHANNEL_ID",
  inactivityReviewChannelId: "INACTIVITY_REVIEW_CHANNEL_ID",
  rankRoleIds: "RANK_ROLE_IDS",
  awardableRoleIds: "AWARDABLE_ROLE_IDS"
};

export function missingConfiguration(keys) {
  return keys.filter(key => {
    const value = config[key];
    if (value instanceof Set) return value.size === 0;
    if (key === "rankRoleIds") return Object.keys(value).length === 0;
    return !value;
  }).map(key => configLabels[key] || key);
}

export function configurationIssues(keys) {
  const issues = [];
  for (const key of keys) {
    const value = config[key];
    const label = configLabels[key] || key;
    if ((value instanceof Set && value.size === 0) || (key === "rankRoleIds" && Object.keys(value).length === 0) || (!(value instanceof Set) && key !== "rankRoleIds" && !value)) {
      issues.push(`${label} is missing`);
      continue;
    }
    if (key === "rankRoleIds") {
      for (const [rank, id] of Object.entries(value)) if (!/^\d{17,20}$/.test(id)) issues.push(`${label}.${rank} is not a valid Discord role ID`);
      continue;
    }
    if (key === "awardableRoleIds") {
      for (const id of value) if (!/^\d{17,20}$/.test(id)) issues.push(`${label} contains an invalid Discord role ID`);
      continue;
    }
    if (key.endsWith("RoleId") || key.endsWith("ChannelId")) {
      if (!/^\d{17,20}$/.test(value)) issues.push(`${label} is not a valid Discord ID`);
    }
  }
  return issues;
}
