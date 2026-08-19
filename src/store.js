import { chmodSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

const FIFTEEN_MINUTES = 15 * 60 * 1000;

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
        claimed_at INTEGER
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
    this.purgeExpired();
  }

  close() {
    this.#db.close();
  }

  purgeExpired(now = Date.now()) {
    return this.#db.prepare("DELETE FROM pending_actions WHERE expires_at < ?").run(now).changes;
  }

  createPending(action, expiresInMs = FIFTEEN_MINUTES) {
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
    if (!row || row.expires_at < Date.now()) {
      if (row) this.#db.prepare("DELETE FROM pending_actions WHERE id = ?").run(id);
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
}
