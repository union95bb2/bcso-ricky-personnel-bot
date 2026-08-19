import test from "node:test";
import assert from "node:assert/strict";
import { RmsStore } from "../../src/rms/store.js";

test("RMS stores a structured member timeline and typed records", () => {
  const store = new RmsStore(":memory:");
  const member = store.upsertMember({ guildId: "g", discordId: "u", callsign: "C-110", displayName: "W. Dorfman", rank: "Corporal" });
  const record = store.createRecord({ guildId: "g", memberId: member.id, recordType: "training", effectiveDate: "08/19/2026", createdBy: "u", data: { signedBy: "C-110" } });
  store.addTrainingRecord({ recordId: record.id, trainerDiscordId: "u2", division: "POST Academy", trainingDate: "08/19/2026", startTime: "4:00 PM", endTime: "5:00 PM", timeZone: "MST", trainingType: "Classroom", outcome: "Complete", notes: "Good performance" });
  const result = store.recordById(record.id);
  assert.equal(result.member.callsign, "C-110");
  assert.equal(result.detail.training_type, "Classroom");
  assert.equal(store.memberTimeline("g", member.id).length, 1);
  store.close();
});

test("RMS approval queue and audit trail are durable domain records", () => {
  const store = new RmsStore(":memory:");
  const approval = store.createApproval({ guildId: "g", workflowType: "promotion", stage: "pab", requestedBy: "u", expiresAt: Date.now() + 86_400_000 });
  assert.equal(store.pendingApprovals("g").length, 1);
  assert.equal(store.decideApproval(approval.id, { status: "approved", decidedBy: "pab-user" }).status, "approved");
  store.audit({ guildId: "g", actorDiscordId: "pab-user", action: "approve", entityType: "approval", entityId: approval.id });
  assert.equal(store.auditTrail("g")[0].action, "approve");
  store.close();
});

test("RMS approval queue expires stale requests and supports renewal", () => {
  const store = new RmsStore(":memory:");
  const approval = store.createApproval({ guildId: "g", sourceActionId: "action-1", workflowType: "training", stage: "pab", requestedBy: "u", expiresAt: 100 });
  assert.equal(store.pendingApprovals("g").length, 0);
  assert.equal(store.approvalById(approval.id).status, "expired");
  const renewed = store.createApproval({ guildId: "g", sourceActionId: "action-2", workflowType: "training", stage: "pab", requestedBy: "u", expiresAt: Date.now() + 1000 });
  assert.equal(store.renewApprovalsForSource("g", "action-2", Date.now() + 86_400_000), 1);
  assert.equal(store.pendingApprovalBySourceId("g", "action-2").id, renewed.id);
  store.close();
});
