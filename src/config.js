import "dotenv/config";
import { resolve } from "node:path";
import { REQUIRED_RANK_KEYS } from "./rank-matrix.js";
import { CHANNEL_CONFIG_FIELDS, isDiscordId, readRuntimeOverrides, writeRuntimeOverrides } from "./runtime-config.js";

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
  trainingRecordsForumChannelId: optional("TRAINING_RECORDS_FORUM_CHANNEL_ID"),
  personnelRecordsChannelId: optional("PERSONNEL_RECORDS_CHANNEL_ID"),
  personnelJacketsForumChannelId: optional("PERSONNEL_JACKETS_FORUM_CHANNEL_ID"),
  promotionsAnnouncementsChannelId: optional("PROMOTIONS_ANNOUNCEMENTS_CHANNEL_ID"),
  auditLogChannelId: optional("AUDIT_LOG_CHANNEL_ID"),
  departureLogChannelId: optional("DEPARTURE_LOG_CHANNEL_ID"),
  pabApprovalsChannelId: optional("PAB_APPROVALS_CHANNEL_ID"),
  qualificationsRecordsChannelId: optional("QUALIFICATIONS_RECORDS_CHANNEL_ID"),
  pabAnnouncementsChannelId: optional("PAB_ANNOUNCEMENTS_CHANNEL_ID"),
  inactivityReviewChannelId: optional("INACTIVITY_REVIEW_CHANNEL_ID"),
  birthdayChannelId: optional("BIRTHDAY_CHANNEL_ID"),
  serviceMilestonesChannelId: optional("SERVICE_MILESTONES_CHANNEL_ID"),
  activityChannelIds: parseIdList(process.env.ACTIVITY_CHANNEL_IDS),
  rankRoleIds: parseRoleMap(process.env.RANK_ROLE_IDS),
  awardableRoleIds: parseIdList(process.env.AWARDABLE_ROLE_IDS),
  timeZoneLabel: process.env.TIME_ZONE_LABEL?.trim() || "MST",
  timeZoneId: process.env.TIME_ZONE_ID?.trim() || "Etc/GMT+7",
  pendingActionTtlMinutes: boundedNumber(process.env.PENDING_ACTION_TTL_MINUTES, 24 * 60, 60, 7 * 24 * 60),
  pendingReminderMinutes: boundedNumber(process.env.PENDING_REMINDER_MINUTES, 60, 5, 12 * 60),
  googleSheetsEnabled: process.env.GOOGLE_SHEETS_ENABLED?.trim().toLowerCase() === "true",
  googleSheetsSpreadsheetId: optional("GOOGLE_SHEETS_SPREADSHEET_ID"),
  googleSheetsRange: process.env.GOOGLE_SHEETS_RANGE?.trim() || "Roster!A:Z",
  googleSheetsServiceAccountJson: optional("GOOGLE_SHEETS_SERVICE_ACCOUNT_JSON"),
  googlePromotionTestsEnabled: process.env.GOOGLE_PROMOTION_TESTS_ENABLED?.trim().toLowerCase() === "true",
  googlePromotionTestsSpreadsheetId: optional("GOOGLE_PROMOTION_TESTS_SPREADSHEET_ID"),
  googlePromotionTestsRange: process.env.GOOGLE_PROMOTION_TESTS_RANGE?.trim() || "'BCSO Promotion Evaluation Roster'!A:Z",
  rmsEnabled: process.env.RMS_ENABLED?.trim().toLowerCase() === "true",
  rmsDataPath: resolve(process.env.RMS_DATA_PATH?.trim() || "data/rms.sqlite"),
  runtimeConfigPath: resolve(process.env.RUNTIME_CONFIG_PATH?.trim() || "data/runtime-config.json"),
  brandEmoji: process.env.BCSO_BRAND_EMOJI?.trim() || "",
  dataPath: resolve(process.env.PAB_DATA_PATH?.trim() || "data/pab.sqlite")
};

const runtimeOverrides = readRuntimeOverrides(config.runtimeConfigPath);
for (const key of Object.keys(CHANNEL_CONFIG_FIELDS)) {
  if (isDiscordId(runtimeOverrides[key])) config[key] = String(runtimeOverrides[key]).trim();
}
if (Array.isArray(runtimeOverrides.activityChannelIds)) {
  config.activityChannelIds = new Set(runtimeOverrides.activityChannelIds.filter(isDiscordId).map(value => String(value).trim()));
}

function updateRuntimeOverrides(mutator) {
  const overrides = readRuntimeOverrides(config.runtimeConfigPath);
  mutator(overrides);
  writeRuntimeOverrides(config.runtimeConfigPath, overrides);
}

export function persistChannelConfig(key, channelId) {
  if (!CHANNEL_CONFIG_FIELDS[key]) throw new Error(`Unsupported channel configuration key: ${key}`);
  if (!isDiscordId(channelId)) throw new Error("The selected channel does not have a valid Discord ID.");
  const value = String(channelId).trim();
  updateRuntimeOverrides(overrides => { overrides[key] = value; });
  config[key] = value;
  return value;
}

export function persistActivityChannelConfig(mode, channelId) {
  if (!isDiscordId(channelId)) throw new Error("The selected channel does not have a valid Discord ID.");
  const value = String(channelId).trim();
  const next = new Set(config.activityChannelIds);
  if (mode === "add") next.add(value);
  else if (mode === "remove") next.delete(value);
  else throw new Error("Activity channel mode must be add or remove.");
  const values = [...next];
  updateRuntimeOverrides(overrides => { overrides.activityChannelIds = values; });
  config.activityChannelIds = new Set(values);
  return values;
}

function boundedNumber(value, fallback, minimum, maximum) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(maximum, Math.max(minimum, Math.floor(parsed)));
}

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
  activityChannelIds: "ACTIVITY_CHANNEL_IDS",
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
      for (const rank of REQUIRED_RANK_KEYS) if (!value[rank]) issues.push(`${label}.${rank} is missing from the BCSO rank matrix`);
      continue;
    }
    if (key === "awardableRoleIds") {
      for (const id of value) if (!/^\d{17,20}$/.test(id)) issues.push(`${label} contains an invalid Discord role ID`);
      continue;
    }
    if (key === "activityChannelIds") {
      for (const id of value) if (!/^\d{17,20}$/.test(id)) issues.push(`${label} contains an invalid Discord channel ID`);
      continue;
    }
    if (key.endsWith("RoleId") || key.endsWith("ChannelId")) {
      if (!/^\d{17,20}$/.test(value)) issues.push(`${label} is not a valid Discord ID`);
    }
  }
  return issues;
}
