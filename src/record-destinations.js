import { ChannelType } from "discord.js";
import { clean } from "./format.js";

function labelWithoutMention(label) {
  return String(label || "Member").replace(/<@!?\d+>\s*[—-]?\s*/, "").trim() || "Member";
}

export function memberThreadName(label, prefix = "Personnel") {
  return clean(`${prefix} | ${labelWithoutMention(label)}`, 100);
}

/**
 * Post a finalized record to a normal channel or, when configured, to the
 * member's durable Forum thread. The approval channel remains separate, so
 * only completed records appear in the record destination.
 */
export async function sendRecord({ guild, baseChannelId, forumChannelId = "", memberId, threadName, payload, store }) {
  const targetId = forumChannelId || baseChannelId;
  const target = await guild.channels.fetch(targetId);
  if (!target) throw new Error("The configured record destination could not be found.");
  if (target.type !== ChannelType.GuildForum || !forumChannelId) {
    return { message: await target.send(payload), threadId: null };
  }
  if (!memberId) throw new Error("A member is required for Forum record routing.");

  const known = store.recordThread(guild.id, target.id, memberId);
  let thread = known ? await guild.channels.fetch(known.threadId).catch(() => null) : null;
  if (!thread || thread.parentId !== target.id) {
    thread = await target.threads.create({ name: threadName, message: payload, reason: "Ricky finalized personnel record" });
    store.saveRecordThread({ guildId: guild.id, channelId: target.id, memberId, threadId: thread.id, threadName });
    const message = await thread.fetchStarterMessage().catch(() => null);
    return { message: message || { channelId: thread.id, id: thread.id, url: `https://discord.com/channels/${guild.id}/${thread.id}` }, threadId: thread.id };
  }
  if (thread.archived && thread.setArchived) await thread.setArchived(false, "Ricky appended a finalized personnel record");
  const message = await thread.send(payload);
  store.saveRecordThread({ guildId: guild.id, channelId: target.id, memberId, threadId: thread.id, threadName });
  return { message, threadId: thread.id };
}
