import { chmodSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

const DEFAULT_PENDING_TTL = 24 * 60 * 60 * 1000;

/**
 * Durable PAB workflow state. Discord remains the published record; this local
 * database preserves pending approvals and a searchable receipt after posting.
 */
export class PabStore {
  #db;

  constructor(path) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.#db = new DatabaseSync(path);
    if (path !== ":memory:") chmodSync(path, 0o600);
    this.#db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA foreign_keys = ON;
      CREATE TABLE IF NOT EXISTS pending_actions (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        created_by TEXT NOT NULL,
        data_json TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        claimed_by TEXT,
        claimed_at INTEGER,
        reminder_sent_at INTEGER
      );
      CREATE TABLE IF NOT EXISTS records (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        actor_id TEXT NOT NULL,
        member_id TEXT,
        record_id TEXT,
        channel_id TEXT,
        message_id TEXT,
        message_url TEXT,
        created_at INTEGER NOT NULL,
        data_json TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS records_member_created_idx ON records(member_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS records_record_id_idx ON records(record_id);
      CREATE INDEX IF NOT EXISTS pending_expires_idx ON pending_actions(expires_at);
      CREATE TABLE IF NOT EXISTS member_profiles (
        guild_id TEXT NOT NULL,
        member_id TEXT NOT NULL,
        birthday_month INTEGER,
        birthday_day INTEGER,
        birthday_opted_in INTEGER NOT NULL DEFAULT 0,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (guild_id, member_id)
      );
      CREATE TABLE IF NOT EXISTS delivery_markers (
        marker TEXT PRIMARY KEY,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS activity_events (
        id TEXT PRIMARY KEY,
        member_id TEXT NOT NULL,
        guild_id TEXT NOT NULL,
        source TEXT NOT NULL,
        source_event_id TEXT,
        channel_id TEXT,
        occurred_at INTEGER NOT NULL,
        metadata_json TEXT NOT NULL DEFAULT '{}',
        UNIQUE(source, source_event_id)
      );
      CREATE INDEX IF NOT EXISTS activity_member_occurred_idx ON activity_events(member_id, occurred_at DESC);
    `);
    const pendingColumns = this.#db.prepare("PRAGMA table_info(pending_actions)").all().map(column => column.name);
    if (!pendingColumns.includes("status")) this.#db.exec("ALTER TABLE pending_actions ADD COLUMN status TEXT NOT NULL DEFAULT 'pending'");
    if (!pendingColumns.includes("claimed_by")) this.#db.exec("ALTER TABLE pending_actions ADD COLUMN claimed_by TEXT");
    if (!pendingColumns.includes("claimed_at")) this.#db.exec("ALTER TABLE pending_actions ADD COLUMN claimed_at INTEGER");
    if (!pendingColumns.includes("reminder_sent_at")) this.#db.exec("ALTER TABLE pending_actions ADD COLUMN reminder_sent_at INTEGER");
    this.purgeExpired();
  }

  close() {
    this.#db.close();
  }

  purgeExpired(now = Date.now()) {
    const marked = this.#db.prepare("UPDATE pending_actions SET status = 'expired' WHERE status = 'pending' AND expires_at < ?").run(now).changes;
    this.#db.prepare("DELETE FROM pending_actions WHERE status = 'expired' AND expires_at < ?").run(now - 24 * 60 * 60 * 1000);
    return marked;
  }

  createPending(action, expiresInMs = DEFAULT_PENDING_TTL) {
    const id = randomUUID();
    const now = Date.now();
    this.#db.prepare(`
      INSERT INTO pending_actions (id, type, created_by, data_json, created_at, expires_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, action.type, action.createdBy, JSON.stringify(action.data || {}), now, now + expiresInMs);
    return id;
  }

  takePending(id, actorId, canApprove = () => null) {
    const row = this.#db.prepare("SELECT * FROM pending_actions WHERE id = ?").get(id);
    if (!row || row.expires_at < Date.now() || row.status === "expired") {
      if (row && row.status === "pending") this.#db.prepare("UPDATE pending_actions SET status = 'expired' WHERE id = ?").run(id);
      return { error: "This preview expired. Run the command again." };
    }
    if (row.status !== "pending") return { error: "This preview is already being processed. Refresh the PAB queue in a moment." };
    const action = { id: row.id, type: row.type, createdBy: row.created_by, data: JSON.parse(row.data_json) };
    const error = canApprove(action, actorId);
    if (error) return { error };
    const claim = this.#db.prepare(`
      UPDATE pending_actions SET status = 'claimed', claimed_by = ?, claimed_at = ?
      WHERE id = ? AND status = 'pending'
    `).run(actorId, Date.now(), id);
    if (!claim.changes) return { error: "This preview is already being processed. Refresh the PAB queue in a moment." };
    return { action };
  }

  listPending(limit = 20) {
    this.purgeExpired();
    return this.#db.prepare(`
      SELECT id, type, created_by, data_json, created_at, expires_at
      FROM pending_actions WHERE status = 'pending' ORDER BY created_at DESC LIMIT ?
    `).all(limit).map(row => ({
      id: row.id,
      type: row.type,
      createdBy: row.created_by,
      data: JSON.parse(row.data_json),
      createdAt: row.created_at,
      expiresAt: row.expires_at
    }));
  }

  pendingDetails(id) {
    const row = this.#db.prepare("SELECT id, type, created_by, created_at, expires_at, status FROM pending_actions WHERE id = ?").get(id);
    return row ? { id: row.id, type: row.type, createdBy: row.created_by, createdAt: row.created_at, expiresAt: row.expires_at, status: row.status } : null;
  }

  listExpiringPending(withinMs, now = Date.now()) {
    this.purgeExpired(now);
    return this.#db.prepare(`
      SELECT id, type, created_by, data_json, created_at, expires_at
      FROM pending_actions
      WHERE status = 'pending' AND reminder_sent_at IS NULL AND expires_at > ? AND expires_at <= ?
      ORDER BY expires_at ASC
    `).all(now, now + withinMs).map(row => ({
      id: row.id,
      type: row.type,
      createdBy: row.created_by,
      data: JSON.parse(row.data_json),
      createdAt: row.created_at,
      expiresAt: row.expires_at
    }));
  }

  markPendingReminder(id, now = Date.now()) {
    return Boolean(this.#db.prepare("UPDATE pending_actions SET reminder_sent_at = ? WHERE id = ? AND status = 'pending' AND reminder_sent_at IS NULL").run(now, id).changes);
  }

  renewPending(id, actorId, expiresInMs = DEFAULT_PENDING_TTL, canRenew = () => null) {
    const row = this.#db.prepare("SELECT * FROM pending_actions WHERE id = ?").get(id);
    if (!row) return { error: "This preview is no longer available. Run the command again." };
    if (row.status === "claimed") return { error: "This preview is already being processed. Refresh the PAB queue in a moment." };
    const action = { id: row.id, type: row.type, createdBy: row.created_by, data: JSON.parse(row.data_json) };
    const error = canRenew(action, actorId);
    if (error) return { error };
    const now = Date.now();
    this.#db.prepare("UPDATE pending_actions SET status = 'pending', expires_at = ?, reminder_sent_at = NULL WHERE id = ? AND status IN ('pending', 'expired')").run(now + expiresInMs, id);
    return { action: { ...action, expiresAt: now + expiresInMs } };
  }

  advancePending(id, actorId, mutate = () => null) {
    const row = this.#db.prepare("SELECT * FROM pending_actions WHERE id = ?").get(id);
    if (!row || row.expires_at < Date.now() || row.status === "expired") {
      if (row && row.status === "pending") this.#db.prepare("UPDATE pending_actions SET status = 'expired' WHERE id = ?").run(id);
      return { error: "This preview expired. Run the command again." };
    }
    if (row.status !== "pending") return { error: "This preview is already being processed. Refresh the PAB queue in a moment." };
    const action = { id: row.id, type: row.type, createdBy: row.created_by, data: JSON.parse(row.data_json), expiresAt: row.expires_at };
    const error = mutate(action, actorId);
    if (error) return { error };
    const result = this.#db.prepare("UPDATE pending_actions SET data_json = ?, reminder_sent_at = NULL WHERE id = ? AND status = 'pending'").run(JSON.stringify(action.data), id);
    if (!result.changes) return { error: "This preview is already being processed. Refresh the PAB queue in a moment." };
    return { action };
  }

  completePending(id) {
    this.#db.prepare("DELETE FROM pending_actions WHERE id = ? AND status = 'claimed'").run(id);
  }

  releasePending(id) {
    this.#db.prepare("UPDATE pending_actions SET status = 'pending', claimed_by = NULL, claimed_at = NULL WHERE id = ? AND status = 'claimed'").run(id);
  }

  record({ type, actorId, memberId = null, recordId = null, message = null, data = {} }) {
    const id = randomUUID();
    this.#db.prepare(`
      INSERT INTO records (id, type, actor_id, member_id, record_id, channel_id, message_id, message_url, created_at, data_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, type, actorId, memberId, recordId, message?.channelId || null, message?.id || null, message?.url || null, Date.now(), JSON.stringify(data));
    return id;
  }

  findRecords({ memberId = null, recordId = null, limit = 10 } = {}) {
    let query = "SELECT * FROM records";
    const clauses = [];
    const values = [];
    if (memberId) { clauses.push("member_id = ?"); values.push(memberId); }
    if (recordId) { clauses.push("record_id = ?"); values.push(recordId); }
    if (clauses.length) query += ` WHERE ${clauses.join(" AND ")}`;
    query += " ORDER BY created_at DESC LIMIT ?";
    values.push(limit);
    return this.#db.prepare(query).all(...values).map(row => ({
      id: row.id, type: row.type, actorId: row.actor_id, memberId: row.member_id,
      recordId: row.record_id, channelId: row.channel_id, messageId: row.message_id,
      messageUrl: row.message_url, createdAt: row.created_at, data: JSON.parse(row.data_json)
    }));
  }

  latestPromotion(memberId) {
    const row = this.#db.prepare("SELECT id, record_id, created_at, data_json FROM records WHERE member_id = ? AND type = 'promotion' ORDER BY created_at DESC LIMIT 1").get(memberId);
    if (!row) return null;
    return { id: row.id, recordId: row.record_id, createdAt: row.created_at, data: JSON.parse(row.data_json) };
  }

  summary() {
    this.purgeExpired();
    const completed = this.#db.prepare("SELECT COUNT(*) AS count FROM records").get().count;
    const pending = this.#db.prepare("SELECT COUNT(*) AS count FROM pending_actions").get().count;
    const latest = this.#db.prepare("SELECT created_at FROM records ORDER BY created_at DESC LIMIT 1").get();
    return { completed, pending, latestAt: latest?.created_at || null };
  }

  exportRecords() {
    return this.findRecords({ limit: 10000 });
  }

  recordActivity({ memberId, guildId, source, sourceEventId = null, channelId = null, occurredAt = Date.now(), metadata = {} }) {
    if (!memberId || !guildId || !source) return false;
    const result = this.#db.prepare(`
      INSERT OR IGNORE INTO activity_events (id, member_id, guild_id, source, source_event_id, channel_id, occurred_at, metadata_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(randomUUID(), memberId, guildId, source, sourceEventId, channelId, occurredAt, JSON.stringify(metadata));
    return Boolean(result.changes);
  }

  lastActivity(memberId, { guildId = null, until = null } = {}) {
    const clauses = ["member_id = ?"];
    const values = [memberId];
    if (guildId) { clauses.push("guild_id = ?"); values.push(guildId); }
    if (until) { clauses.push("occurred_at <= ?"); values.push(until); }
    const row = this.#db.prepare(`
      SELECT member_id, guild_id, source, source_event_id, channel_id, occurred_at, metadata_json
      FROM activity_events WHERE ${clauses.join(" AND ")} ORDER BY occurred_at DESC LIMIT 1
    `).get(...values);
    if (!row) return null;
    return {
      memberId: row.member_id,
      guildId: row.guild_id,
      source: row.source,
      sourceEventId: row.source_event_id,
      channelId: row.channel_id,
      occurredAt: row.occurred_at,
      metadata: JSON.parse(row.metadata_json)
    };
  }

  setBirthday({ guildId, memberId, month, day, optedIn = true }) {
    this.#db.prepare(`
      INSERT INTO member_profiles (guild_id, member_id, birthday_month, birthday_day, birthday_opted_in, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(guild_id, member_id) DO UPDATE SET birthday_month = excluded.birthday_month, birthday_day = excluded.birthday_day, birthday_opted_in = excluded.birthday_opted_in, updated_at = excluded.updated_at
    `).run(guildId, memberId, month, day, optedIn ? 1 : 0, Date.now());
  }

  clearBirthday(guildId, memberId) {
    this.#db.prepare("UPDATE member_profiles SET birthday_month = NULL, birthday_day = NULL, birthday_opted_in = 0, updated_at = ? WHERE guild_id = ? AND member_id = ?").run(Date.now(), guildId, memberId);
  }

  birthday(guildId, memberId) {
    const row = this.#db.prepare("SELECT * FROM member_profiles WHERE guild_id = ? AND member_id = ?").get(guildId, memberId);
    return row ? { month: row.birthday_month, day: row.birthday_day, optedIn: Boolean(row.birthday_opted_in) } : null;
  }

  birthdaysOn(guildId, month, day) {
    return this.#db.prepare("SELECT member_id, birthday_month, birthday_day FROM member_profiles WHERE guild_id = ? AND birthday_month = ? AND birthday_day = ? AND birthday_opted_in = 1").all(guildId, month, day).map(row => ({ memberId: row.member_id, month: row.birthday_month, day: row.birthday_day }));
  }

  markDelivered(marker) {
    return Boolean(this.#db.prepare("INSERT OR IGNORE INTO delivery_markers (marker, created_at) VALUES (?, ?)").run(marker, Date.now()).changes);
  }

  hasDelivered(marker) {
    return Boolean(this.#db.prepare("SELECT marker FROM delivery_markers WHERE marker = ?").get(marker));
  }
}
