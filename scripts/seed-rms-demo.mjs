import "dotenv/config";
import { RmsStore } from "../src/rms/store.js";

if (process.env.RMS_DEMO_SEED !== "true") {
  throw new Error("Refusing to seed RMS data. Set RMS_DEMO_SEED=true explicitly; this script is for the sandbox only.");
}

const guildId = process.env.RMS_GUILD_ID || process.env.DISCORD_GUILD_ID;
const botToken = process.env.RMS_DISCORD_BOT_TOKEN || process.env.DISCORD_TOKEN;
const dataPath = process.env.RMS_DATA_PATH || "data/rms.sqlite";
if (!guildId || !botToken) throw new Error("RMS_GUILD_ID and a Discord bot token are required.");

async function discord(path) {
  const response = await fetch(`https://discord.com/api/v10${path}`, { headers: { authorization: `Bot ${botToken}` } });
  if (!response.ok) throw new Error(`Discord API returned ${response.status}`);
  return response.json();
}

function callsignFromLabel(value) {
  const match = String(value || "").match(/\bC-?\d{1,4}\b/i);
  return match ? match[0].replace(/^C(?=\d)/i, "C-").toUpperCase() : null;
}

function rankFromRoles(roles) {
  let rankMap = {};
  try { rankMap = JSON.parse(process.env.RANK_ROLE_IDS || "{}"); } catch { rankMap = {}; }
  const roleSet = new Set(roles || []);
  return Object.entries(rankMap).find(([, id]) => roleSet.has(String(id)))?.[0] || null;
}

const roster = (await discord(`/guilds/${guildId}/members?limit=1000`))
  .filter(member => !member.user?.bot)
  .map((member, index) => ({
    discordId: member.user.id,
    displayName: member.nick || member.user.global_name || member.user.username || member.user.id,
    callsign: callsignFromLabel(member.nick || "") || `C-${String(900 + index).padStart(3, "0")}`,
    rank: rankFromRoles(member.roles) || ["Deputy Sheriff Trainee", "Deputy", "Corporal", "Sergeant"][index % 4],
    joinedAt: member.joined_at ? Date.parse(member.joined_at) : null
  }));
if (!roster.length) throw new Error("The configured guild has no human members to use for the sandbox seed.");

const store = new RmsStore(dataPath);
const seededMembers = roster.map(person => {
  const existing = store.memberByDiscordId(guildId, person.discordId);
  return store.upsertMember({
    guildId,
    discordId: person.discordId,
    callsign: existing?.callsign || person.callsign,
    displayName: person.displayName,
    rank: existing?.rank || person.rank,
    status: existing?.status || "active",
    hireDate: existing?.hireDate || null,
    joinedAt: person.joinedAt || existing?.joinedAt || null,
    timeZone: existing?.timeZone || null,
    source: "simulated-seed"
  });
});

const simulated = "SIMULATED / TEST DATA — not an official personnel action";
const actor = "ricky-demo-seed";
const entries = [
  { type: "training", date: "2026-08-01", summary: "Basic academy classroom and policy block completed", notes: "Classroom block passed. Practical and ride-along remain scheduled.", detail: { division: "Academy", trainingDate: "2026-08-01", startTime: "4:00 PM", endTime: "6:00 PM", timeZone: "MST", trainingType: "Classroom", outcome: "Completed — continue to practical training", notes: simulated } },
  { type: "promotion", date: "2026-08-04", summary: "Promotion review: Deputy Sheriff Trainee to Deputy", notes: "Demo promotion approval workflow record.", detail: { fromRank: "Deputy Sheriff Trainee", toRank: "Deputy", promotionDate: "2026-08-04", reason: simulated, authorizationReference: "DEMO-PAB-001" } },
  { type: "qualification", date: "2026-08-06", summary: "Field Training Officer qualification recorded", notes: `Qualification example. ${simulated}` },
  { type: "inactivity", date: "2026-08-08", summary: "Thirty-day activity review opened", notes: `Activity review example; human follow-up required. ${simulated}` },
  { type: "award", date: "2026-08-10", summary: "Deputy of the Week recognition", notes: `Recognition example. ${simulated}` },
  { type: "department", date: "2026-08-12", summary: "Assigned to Search and Rescue division", notes: `Department assignment example. ${simulated}` },
  { type: "status", date: "2026-08-14", summary: "Personnel status confirmed active", notes: `Status-change example. ${simulated}` },
  { type: "note", date: "2026-08-16", summary: "PAB administrative note", notes: `General administrative note example. ${simulated}` }
];

let createdRecords = 0;
let existingRecords = 0;
const records = [];
for (const [index, entry] of entries.entries()) {
  const member = seededMembers[index % seededMembers.length];
  const sourceRecordId = `demo-seed-${entry.type}-${member.discordId}`;
  const existing = store.recordBySourceId(guildId, sourceRecordId);
  if (existing) { existingRecords += 1; records.push(existing); continue; }
  const record = store.createRecord({
    guildId,
    memberId: member.id,
    recordType: entry.type,
    status: "finalized",
    effectiveDate: entry.date,
    createdBy: actor,
    sourceRecordId,
    data: { summary: entry.summary, notes: entry.notes, simulated: true, banner: simulated }
  });
  if (entry.type === "training") store.addTrainingRecord({ recordId: record.id, trainerDiscordId: seededMembers[0].discordId, division: entry.detail.division, trainingDate: entry.detail.trainingDate, startTime: entry.detail.startTime, endTime: entry.detail.endTime, timeZone: entry.detail.timeZone, trainingType: entry.detail.trainingType, outcome: entry.detail.outcome, notes: entry.detail.notes });
  if (entry.type === "promotion") store.addPromotionRecord({ recordId: record.id, fromRank: entry.detail.fromRank, toRank: entry.detail.toRank, promotionDate: entry.detail.promotionDate, reason: entry.detail.reason, authorizationReference: entry.detail.authorizationReference });
  records.push(record);
  createdRecords += 1;
}

let createdApprovals = 0;
for (const [index, stage] of ["pab", "command"].entries()) {
  const sourceActionId = `demo-seed-approval-${stage}`;
  if (store.pendingApprovalBySourceId(guildId, sourceActionId)) continue;
  store.createApproval({ recordId: records[(index + 1) % records.length].id, sourceActionId, guildId, workflowType: "promotion", stage, requestedBy: actor, expiresAt: null, notes: simulated });
  createdApprovals += 1;
}

store.audit({ guildId, actorDiscordId: actor, action: "simulated_seed", entityType: "rms", entityId: guildId, metadata: { members: seededMembers.length, recordsCreated: createdRecords, approvalsCreated: createdApprovals, banner: simulated } });
console.log(JSON.stringify({ guildId, members: seededMembers.length, recordsCreated: createdRecords, recordsAlreadyPresent: existingRecords, approvalsCreated: createdApprovals, summary: store.memberStats(guildId), recordStats: store.recordStats(guildId) }));
store.close();
