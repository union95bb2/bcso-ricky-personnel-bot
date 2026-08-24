import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

// These are the channel-backed settings that can safely be changed by a
// server administrator from Discord. Role IDs and credentials remain
// protected environment configuration and are never writable by a command.
export const CHANNEL_CONFIG_FIELDS = Object.freeze({
  trainingRecordsChannelId: { label: "Training records", env: "TRAINING_RECORDS_CHANNEL_ID", forum: false },
  trainingRecordsForumChannelId: { label: "Training records forum", env: "TRAINING_RECORDS_FORUM_CHANNEL_ID", forum: true },
  personnelRecordsChannelId: { label: "Personnel records", env: "PERSONNEL_RECORDS_CHANNEL_ID", forum: false },
  personnelJacketsForumChannelId: { label: "Personnel jackets forum", env: "PERSONNEL_JACKETS_FORUM_CHANNEL_ID", forum: true },
  promotionsAnnouncementsChannelId: { label: "Promotion announcements", env: "PROMOTIONS_ANNOUNCEMENTS_CHANNEL_ID", forum: false },
  auditLogChannelId: { label: "PAB audit log", env: "AUDIT_LOG_CHANNEL_ID", forum: false },
  pabApprovalsChannelId: { label: "PAB approvals", env: "PAB_APPROVALS_CHANNEL_ID", forum: false },
  qualificationsRecordsChannelId: { label: "Qualification records", env: "QUALIFICATIONS_RECORDS_CHANNEL_ID", forum: false },
  pabAnnouncementsChannelId: { label: "PAB announcements", env: "PAB_ANNOUNCEMENTS_CHANNEL_ID", forum: false },
  inactivityReviewChannelId: { label: "Inactivity review", env: "INACTIVITY_REVIEW_CHANNEL_ID", forum: false },
  birthdayChannelId: { label: "Birthday announcements", env: "BIRTHDAY_CHANNEL_ID", forum: false },
  serviceMilestonesChannelId: { label: "Service milestones", env: "SERVICE_MILESTONES_CHANNEL_ID", forum: false },
  departureLogChannelId: { label: "Departure log", env: "DEPARTURE_LOG_CHANNEL_ID", forum: false }
});

export const CHANNEL_CONFIG_CHOICES = Object.entries(CHANNEL_CONFIG_FIELDS)
  .map(([value, field]) => ({ name: field.label, value }));

export const ACTIVITY_CONFIG_CHOICES = [
  { name: "Add activity source", value: "add" },
  { name: "Remove activity source", value: "remove" }
];

export function isDiscordId(value) {
  return /^\d{17,20}$/.test(String(value || "").trim());
}

export function readRuntimeOverrides(path) {
  if (!existsSync(path)) return {};
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch (error) {
    console.error(`Ricky runtime configuration could not be read: ${error instanceof Error ? error.message : "invalid JSON"}`);
    return {};
  }
}

export function writeRuntimeOverrides(path, overrides) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temporaryPath = `${path}.tmp`;
  writeFileSync(temporaryPath, `${JSON.stringify(overrides, null, 2)}\n`, { mode: 0o600 });
  chmodSync(temporaryPath, 0o600);
  renameSync(temporaryPath, path);
  chmodSync(path, 0o600);
}
