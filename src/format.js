import { BCSO_RANK_MATRIX } from "./rank-matrix.js";

const MAX_FIELD_VALUE = 1024;

// Discord modals do not support select menus. These choices are therefore
// presented on /training-log before the modal opens, then carried through the
// modal custom ID so the posted record cannot silently change timezones.
export const TRAINING_TIME_ZONES = [
  { value: "MST", name: "MST — Mountain Time", label: "MST", timeZoneId: "Etc/GMT+7" },
  { value: "PST", name: "PST — Pacific Time", label: "PST", timeZoneId: "America/Los_Angeles" },
  { value: "CST", name: "CST — Central Time", label: "CST", timeZoneId: "America/Chicago" },
  { value: "EST", name: "EST — Eastern Time", label: "EST", timeZoneId: "America/New_York" },
  { value: "UTC", name: "UTC — Coordinated Universal Time", label: "UTC", timeZoneId: "UTC" }
];

// Discord allows up to 25 string choices. Hourly choices cover the normal
// training workflow; staff can leave these optional choices blank when a
// non-hour boundary (such as 4:30 PM) is needed and use the validated form.
export const TRAINING_TIME_CHOICES = Array.from({ length: 24 }, (_, hour) => {
  const period = hour < 12 ? "AM" : "PM";
  const displayHour = hour % 12 || 12;
  const value = `${displayHour}:00 ${period}`;
  return { name: value, value };
});

export const TRAINING_DIVISION_CHOICES = [
  { name: "BCSO / POST Academy", value: "BCSO / POST Academy" },
  { name: "FTO", value: "FTO" },
  { name: "SAR", value: "SAR" },
  { name: "SEB", value: "SEB" },
  { name: "TED", value: "TED" },
  { name: "DET", value: "DET" },
  { name: "Other / see notes", value: "Other" }
];

export function resolveTrainingTimeZone(value, fallback = {}) {
  return TRAINING_TIME_ZONES.find(zone => zone.value === value) || {
    value: fallback.label || "MST",
    name: fallback.label || "MST",
    label: fallback.label || "MST",
    timeZoneId: fallback.timeZoneId || "Etc/GMT+7"
  };
}

export function clean(value, max = MAX_FIELD_VALUE) {
  const result = String(value || "").trim().replace(/\r\n/g, "\n");
  return result.length > max ? `${result.slice(0, max - 1)}…` : result;
}

export function memberLabel(member) {
  return clean(member.displayName || member.user.globalName || member.user.username, 100);
}

export function mentionWithLabel(member) {
  return `<@${member.id}> — ${memberLabel(member)}`;
}

export function normalizeMultiline(value) {
  return clean(value).replace(/\n{3,}/g, "\n\n");
}

export function rankRoleEntries(rankRoleIds) {
  return Object.entries(rankRoleIds).map(([rank, id]) => ({ rank, id }));
}

/** Return only canonical rank entries, in BCSO progression order. */
export function canonicalRankRoleEntries(rankRoleIds) {
  return BCSO_RANK_MATRIX
    .map(({ key, aliases }) => ({ rank: key, id: rankRoleIds?.[key] || aliases.map(alias => rankRoleIds?.[alias]).find(Boolean) }))
    .filter(({ id }) => id);
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function todayInTimeZone(timeZone, now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(now);
  const values = Object.fromEntries(parts.filter(({ type }) => type !== "literal").map(({ type, value }) => [type, value]));
  return `${values.month}/${values.day}/${values.year}`;
}

export function dateInTimeZone(timeZone, timestamp) {
  return todayInTimeZone(timeZone, new Date(timestamp));
}

export function endOfDateTimestamp(value) {
  const normalized = normalizeDate(value);
  if (!normalized) return null;
  const [month, day, year] = normalized.split("/").map(Number);
  return Date.UTC(year, month - 1, day, 23, 59, 59, 999);
}

export function normalizeDate(value) {
  const match = clean(value, 64).match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (!match) return "";
  const [, monthText, dayText, yearText] = match;
  const month = Number(monthText);
  const day = Number(dayText);
  const year = Number(yearText);
  const candidate = new Date(Date.UTC(year, month - 1, day));
  if (candidate.getUTCFullYear() !== year || candidate.getUTCMonth() !== month - 1 || candidate.getUTCDate() !== day) return "";
  return `${String(month).padStart(2, "0")}/${String(day).padStart(2, "0")}/${yearText}`;
}

export function normalizeDateRange(value) {
  const parts = clean(value, 80).split(/\s+(?:-|–|—)\s+/);
  if (parts.length !== 2) return "";
  const start = normalizeDate(parts[0]);
  const end = normalizeDate(parts[1]);
  return start && end ? `${start} - ${end}` : "";
}

export function normalizeClockTime(value) {
  const match = clean(value, 40).replace(/\./g, "").match(/^(\d{1,2})(?::(\d{2}))?\s*([AP]M)$/i);
  if (!match) return "";
  const hour = Number(match[1]);
  const minute = Number(match[2] || "00");
  if (hour < 1 || hour > 12 || minute > 59) return "";
  return `${hour}:${String(minute).padStart(2, "0")} ${match[3].toUpperCase()}`;
}

export function splitTimeRange(value, timeZoneLabel = "") {
  const [start, end] = clean(value, 80).split(/\s*(?:[-–—]|\bto\b)\s*/i, 2);
  if (!start || !end) return ["", ""];
  const suffix = timeZoneLabel ? new RegExp(`\\s*\\(?${escapeRegExp(timeZoneLabel)}\\)?$`, "i") : null;
  const stripZone = part => clean(part, 40).replace(suffix, "").trim();
  return [normalizeClockTime(stripZone(start)), normalizeClockTime(stripZone(end))];
}

export function durationLabel(start, end) {
  const parse = value => {
    const match = normalizeClockTime(value).match(/^(\d+):(\d{2}) (AM|PM)$/);
    if (!match) return null;
    let hour = Number(match[1]) % 12;
    if (match[3] === "PM") hour += 12;
    return hour * 60 + Number(match[2]);
  };
  const startMinutes = parse(start);
  const endMinutes = parse(end);
  if (startMinutes === null || endMinutes === null) return "Not calculated";
  if (startMinutes === endMinutes) return "Not calculated";
  const minutes = (endMinutes - startMinutes + 1440) % 1440;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  if (!remainder) return `${hours} hour${hours === 1 ? "" : "s"}`;
  if (!hours) return `${remainder} minutes`;
  return `${hours}h ${remainder}m`;
}

export function parseDiscordMessageLink(value, guildId) {
  const match = String(value || "").trim().match(/^https?:\/\/(?:canary\.|ptb\.)?discord(?:app)?\.com\/channels\/(\d+)\/(\d+)\/(\d+)\/?$/i);
  if (!match || match[1] !== String(guildId)) return null;
  return { guildId: match[1], channelId: match[2], messageId: match[3], messageLink: match[0] };
}
