import "dotenv/config";
import { PabStore } from "../src/store.js";
import { RmsStore } from "../src/rms/store.js";

const guildId = process.env.RMS_GUILD_ID || process.env.DISCORD_GUILD_ID;
const sourcePath = process.env.PAB_DATA_PATH || "data/pab.sqlite";
const targetPath = process.env.RMS_DATA_PATH || "data/rms.sqlite";
if (!guildId) { console.error("Set RMS_GUILD_ID or DISCORD_GUILD_ID before importing."); process.exit(1); }

function labelParts(value, fallbackId) {
  const text = String(value || fallbackId || "Unknown member");
  const callsign = text.match(/\bC-?\d{1,4}\b/i)?.[0].replace(/^C(\d)/i, "C-$1").toUpperCase() || null;
  const displayName = text.replace(/<@!?\d+>/g, "").replace(/[—|]/g, " ").replace(/\s+/g, " ").trim() || fallbackId;
  return { callsign, displayName };
}

const source = new PabStore(sourcePath);
const target = new RmsStore(targetPath);
const records = source.exportRecords();
let imported = 0;
for (const item of records) {
  if (!item.memberId) continue;
  if (target.recordBySourceId(guildId, item.id)) continue;
  const data = item.data || {};
  const label = data.memberLabel || data.traineeLabel || data.member || item.memberId;
  const identity = labelParts(label, item.memberId);
  const member = target.upsertMember({ guildId, discordId: item.memberId, callsign: data.callsign || identity.callsign, displayName: identity.displayName, rank: data.toRank || data.rank || data.signerRank || null, source: "pab-ledger-import" });
  const record = target.createRecord({ guildId, memberId: member.id, recordType: item.type, status: "finalized", effectiveDate: data.effectiveDate || data.date || null, createdBy: item.actorId || "pab-ledger", sourceChannelId: item.channelId, sourceMessageId: item.messageId, sourceRecordId: item.id, data });
  if (item.type === "training") target.addTrainingRecord({ recordId: record.id, trainerDiscordId: data.trainerId || "unknown", division: data.division || null, trainingDate: data.date || "unknown", startTime: data.startTime || null, endTime: data.endTime || null, timeZone: data.timeZoneLabel || null, trainingType: data.trainingType || null, outcome: data.outcome || null, notes: data.notes || null });
  if (item.type === "promotion") target.addPromotionRecord({ recordId: record.id, fromRank: data.fromRank || "unknown", toRank: data.toRank || "unknown", promotionDate: data.effectiveDate || "unknown", reason: data.reason || null, authorizationReference: data.authorizedBy || null });
  target.audit({ guildId, actorDiscordId: "system", action: "import_record", entityType: "record", entityId: record.id, metadata: { sourceRecordId: item.id, sourceType: item.type } });
  imported += 1;
}
const importId = target.importRun({ guildId, sourceName: "PAB SQLite ledger", sourceReference: sourcePath, rowCount: imported, importedBy: "system", metadata: { sourceRecordCount: records.length } });
target.audit({ guildId, actorDiscordId: "system", action: "import_complete", entityType: "import", entityId: importId, metadata: { imported, sourceRecordCount: records.length } });
source.close();
target.close();
console.log(`RMS import complete: ${imported} record(s) imported from ${sourcePath} into ${targetPath}.`);
