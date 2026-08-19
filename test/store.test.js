import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { PabStore } from "../src/store.js";

test("pending approvals are single-use and authorize before consumption", () => {
  const store = new PabStore(":memory:");
  const id = store.createPending({ type: "training", createdBy: "pab-1", data: { memberId: "member-1" } });
  const rejected = store.takePending(id, "other", action => action.createdBy === "other" ? null : "not creator");
  assert.equal(rejected.error, "not creator");
  const accepted = store.takePending(id, "pab-1", () => null);
  assert.equal(accepted.action.type, "training");
  assert.equal(store.takePending(id, "pab-1").error, "This preview is already being processed. Refresh the PAB queue in a moment.");
  store.releasePending(id);
  assert.equal(store.takePending(id, "pab-1").action.type, "training");
  store.completePending(id);
  assert.equal(store.takePending(id, "pab-1").error, "This preview expired. Run the command again.");
  store.close();
});

test("receipts can be searched by member and PAB record ID", () => {
  const store = new PabStore(":memory:");
  store.record({
    type: "department-record",
    actorId: "pab-1",
    memberId: "member-1",
    recordId: "PAB-ABCDE123",
    message: { channelId: "channel-1", id: "message-1", url: "https://discord.com/channels/guild/channel-1/message-1" },
    data: { callsign: "C-100" }
  });
  assert.equal(store.findRecords({ memberId: "member-1" }).length, 1);
  assert.equal(store.findRecords({ recordId: "PAB-ABCDE123" })[0].data.callsign, "C-100");
  assert.equal(store.summary().completed, 1);
  store.close();
});

test("pending approvals and receipts survive a database reopen", () => {
  const directory = mkdtempSync(join(tmpdir(), "bcso-pab-store-"));
  const path = join(directory, "pab.sqlite");
  try {
    const first = new PabStore(path);
    const pendingId = first.createPending({ type: "department-record", createdBy: "pab-1", data: { memberId: "member-1" } });
    first.record({ type: "training", actorId: "pab-1", memberId: "member-1", data: { outcome: "complete" } });
    first.close();

    const second = new PabStore(path);
    assert.equal(second.listPending().some(item => item.id === pendingId), true);
    assert.equal(second.findRecords({ memberId: "member-1" })[0].data.outcome, "complete");
    second.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("activity events are deduplicated and return the latest known event", () => {
  const store = new PabStore(":memory:");
  assert.equal(store.recordActivity({ memberId: "member-1", guildId: "guild-1", source: "discord-message", sourceEventId: "message-1", channelId: "channel-1", occurredAt: 100 }), true);
  assert.equal(store.recordActivity({ memberId: "member-1", guildId: "guild-1", source: "discord-message", sourceEventId: "message-1", channelId: "channel-1", occurredAt: 100 }), false);
  store.recordActivity({ memberId: "member-1", guildId: "guild-1", source: "discord-message", sourceEventId: "message-2", channelId: "channel-2", occurredAt: 200 });
  assert.equal(store.lastActivity("member-1", { guildId: "guild-1" }).sourceEventId, "message-2");
  assert.equal(store.lastActivity("member-1", { guildId: "guild-1", until: 150 }).sourceEventId, "message-1");
  store.close();
});

test("expired previews can be renewed by the authorized creator and reminders are one-shot", () => {
  const store = new PabStore(":memory:");
  const id = store.createPending({ type: "promotion", createdBy: "pab-1", data: { memberId: "member-1" } }, 60_000);
  assert.equal(store.listExpiringPending(60_000, Date.now()).length, 1);
  assert.equal(store.markPendingReminder(id), true);
  assert.equal(store.markPendingReminder(id), false);
  const renewed = store.renewPending(id, "pab-1", 60_000, action => action.createdBy === "pab-1" ? null : "not creator");
  assert.equal(renewed.action.id, id);
  assert.equal(store.listPending().some(item => item.id === id), true);
  store.close();
});

test("birthday opt-in stores month/day only and delivery markers are idempotent", () => {
  const store = new PabStore(":memory:");
  store.setBirthday({ guildId: "guild-1", memberId: "member-1", month: 8, day: 19 });
  assert.deepEqual(store.birthday("guild-1", "member-1"), { month: 8, day: 19, optedIn: true });
  assert.deepEqual(store.birthdaysOn("guild-1", 8, 19)[0].memberId, "member-1");
  assert.equal(store.markDelivered("birthday:guild-1:member-1:2026"), true);
  assert.equal(store.markDelivered("birthday:guild-1:member-1:2026"), false);
  store.clearBirthday("guild-1", "member-1");
  assert.equal(store.birthdaysOn("guild-1", 8, 19).length, 0);
  store.close();
});
