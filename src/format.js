const MAX_FIELD_VALUE = 1024;

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
  const match = clean(value, 40).match(/^(\d{1,2}):(\d{2})\s*([AP]M)$/i);
  if (!match) return "";
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour < 1 || hour > 12 || minute > 59) return "";
  return `${hour}:${String(minute).padStart(2, "0")} ${match[3].toUpperCase()}`;
}

export function splitTimeRange(value, timeZoneLabel = "") {
  const [start, end] = clean(value, 80).split(/\s*-\s*/, 2);
  if (!start || !end) return ["", ""];
  const suffix = timeZoneLabel ? new RegExp(`\\s+${escapeRegExp(timeZoneLabel)}$`, "i") : null;
  const stripZone = part => clean(part, 40).replace(suffix, "").trim();
  return [normalizeClockTime(stripZone(start)), normalizeClockTime(stripZone(end))];
}
