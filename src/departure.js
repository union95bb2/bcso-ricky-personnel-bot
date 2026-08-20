import { EmbedBuilder } from "discord.js";

const DEPARTURE_ORANGE = 0xb45309;

function safe(value, fallback = "Not recorded", limit = 1024) {
  const text = String(value ?? "").trim();
  return text ? text.slice(0, limit) : fallback;
}

export function departureEmbed({ memberLabel, userTag, roleLabels = [], lastActivity = null, event = "left or was removed", timestamp = Date.now() }) {
  const roles = roleLabels.length ? roleLabels.slice(0, 20).join(", ") : "No non-managed roles recorded at departure";
  const activity = lastActivity
    ? `<t:${Math.floor(lastActivity.occurredAt / 1000)}:F> · ${safe(lastActivity.source, "unknown source", 200)}`
    : "No Ricky activity was recorded before departure";

  return new EmbedBuilder()
    .setColor(DEPARTURE_ORANGE)
    .setTitle("BCSO Departure Notice")
    .addFields(
      { name: "Member", value: safe(memberLabel), inline: false },
      { name: "Discord account", value: safe(userTag), inline: true },
      { name: "Event", value: safe(event, "left or was removed", 200), inline: true },
      { name: "Last known Ricky activity", value: activity, inline: false },
      { name: "Roles at departure", value: safe(roles), inline: false },
      { name: "Required follow-up", value: "PAB/Command may review roster and RMS status. Ricky does not make a disciplinary, personnel, or role decision.", inline: false }
    )
    .setFooter({ text: "Administrative notice — human review required" })
    .setTimestamp(timestamp);
}

export function departureNoticeContent({ pabRoleId, memberLabel }) {
  const mention = pabRoleId ? `<@&${pabRoleId}> ` : "";
  return `${mention}**Departure notice:** ${safe(memberLabel, "A member")} is no longer in the BCSO Discord. Review the roster/RMS record as appropriate.`;
}
