import { chmodSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

const now = () => Date.now();
const json = value => JSON.stringify(value ?? {});
const parse = value => {
  try { return JSON.parse(value || "{}"); } catch { return {}; }
};

/**
 * Structured RMS storage. Discord IDs are external identifiers; RMS IDs are
 * durable internal identifiers so imported records remain stable if a server
 * changes presentation, channels, or role names.
 */
export class RmsStore {
  #db;

  constructor(path) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.#db = new DatabaseSync(path);
    if (path !== ":memory:") chmodSync(path, 0o600);
    this.#db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA foreign_keys = ON;
      CREATE TABLE IF NOT EXISTS rms_members (
        id TEXT PRIMARY KEY,
        guild_id TEXT NOT NULL,
        discord_id TEXT NOT NULL,
        callsign TEXT,
        display_name TEXT NOT NULL,
        rank TEXT,
        status TEXT NOT NULL DEFAULT 'active',
        hire_date TEXT,
        joined_at INTEGER,
        time_zone TEXT,
        source TEXT NOT NULL DEFAULT 'discord',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        UNIQUE(guild_id, discord_id)
      );
      CREATE INDEX IF NOT EXISTS rms_members_search_idx ON rms_members(guild_id, callsign, display_name);
      CREATE TABLE IF NOT EXISTS rms_records (
        id TEXT PRIMARY KEY,
        guild_id TEXT NOT NULL,
        member_id TEXT NOT NULL REFERENCES rms_members(id),
        record_type TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'finalized',
        effective_date TEXT,
        created_by TEXT NOT NULL,
        source_channel_id TEXT,
        source_message_id TEXT,
        source_record_id TEXT,
        data_json TEXT NOT NULL DEFAULT '{}',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS rms_records_member_idx ON rms_records(member_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS rms_records_type_idx ON rms_records(guild_id, record_type, created_at DESC);
      CREATE TABLE IF NOT EXISTS rms_training_records (
        record_id TEXT PRIMARY KEY REFERENCES rms_records(id) ON DELETE CASCADE,
        trainer_discord_id TEXT NOT NULL,
        division TEXT,
        training_date TEXT NOT NULL,
        start_time TEXT,
        end_time TEXT,
        time_zone TEXT,
        training_type TEXT,
        outcome TEXT,
        notes TEXT
      );
      CREATE TABLE IF NOT EXISTS rms_promotion_records (
        record_id TEXT PRIMARY KEY REFERENCES rms_records(id) ON DELETE CASCADE,
        from_rank TEXT NOT NULL,
        to_rank TEXT NOT NULL,
        promotion_date TEXT NOT NULL,
        reason TEXT,
        authorization_reference TEXT
      );
      CREATE TABLE IF NOT EXISTS rms_approvals (
        id TEXT PRIMARY KEY,
        record_id TEXT REFERENCES rms_records(id) ON DELETE CASCADE,
        source_action_id TEXT,
        guild_id TEXT NOT NULL,
        workflow_type TEXT NOT NULL,
        stage TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        requested_by TEXT NOT NULL,
        decided_by TEXT,
        requested_at INTEGER NOT NULL,
        expires_at INTEGER,
        decided_at INTEGER,
        notes TEXT
      );
      CREATE INDEX IF NOT EXISTS rms_approvals_queue_idx ON rms_approvals(guild_id, status, requested_at DESC);
      CREATE TABLE IF NOT EXISTS rms_accounts (
        id TEXT PRIMARY KEY,
        guild_id TEXT NOT NULL,
        discord_id TEXT NOT NULL,
        access_level TEXT NOT NULL DEFAULT 'member',
        last_login_at INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        UNIQUE(guild_id, discord_id)
      );
      CREATE TABLE IF NOT EXISTS rms_sessions (
        token_hash TEXT PRIMARY KEY,
        account_id TEXT NOT NULL REFERENCES rms_accounts(id) ON DELETE CASCADE,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS rms_sessions_expiry_idx ON rms_sessions(expires_at);
      CREATE TABLE IF NOT EXISTS rms_audit_events (
        id TEXT PRIMARY KEY,
        guild_id TEXT NOT NULL,
        actor_discord_id TEXT,
        action TEXT NOT NULL,
        entity_type TEXT NOT NULL,
        entity_id TEXT,
        metadata_json TEXT NOT NULL DEFAULT '{}',
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS rms_audit_time_idx ON rms_audit_events(guild_id, created_at DESC);
      CREATE TABLE IF NOT EXISTS rms_imports (
        id TEXT PRIMARY KEY,
        guild_id TEXT NOT NULL,
        source_name TEXT NOT NULL,
        source_reference TEXT,
        row_count INTEGER NOT NULL DEFAULT 0,
        imported_by TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        metadata_json TEXT NOT NULL DEFAULT '{}'
      );
    `);
    const recordColumns = this.#db.prepare("PRAGMA table_info(rms_records)").all().map(column => column.name);
    if (!recordColumns.includes("source_record_id")) this.#db.exec("ALTER TABLE rms_records ADD COLUMN source_record_id TEXT");
    this.#db.exec("CREATE UNIQUE INDEX IF NOT EXISTS rms_records_source_idx ON rms_records(guild_id, source_record_id) WHERE source_record_id IS NOT NULL");
    const approvalColumns = this.#db.prepare("PRAGMA table_info(rms_approvals)").all().map(column => column.name);
    if (!approvalColumns.includes("source_action_id")) this.#db.exec("ALTER TABLE rms_approvals ADD COLUMN source_action_id TEXT");
    this.#db.exec("CREATE INDEX IF NOT EXISTS rms_approvals_source_idx ON rms_approvals(guild_id, source_action_id, requested_at DESC)");
  }

  close() { this.#db.close(); }

  /**
   * Lightweight database probe used by the public health endpoint. Keep this
   * deliberately free of record counts or member data: health is safe to
   * expose through the reverse proxy and should only answer whether SQLite is
   * available.
   */
  health() {
    this.#db.prepare("SELECT 1 AS ok").get();
    return { ok: true };
  }

  upsertMember({ guildId, discordId, callsign = null, displayName, rank = null, status = "active", hireDate = null, joinedAt = null, timeZone = null, source = "discord" }) {
    const timestamp = now();
    const existing = this.#db.prepare("SELECT id FROM rms_members WHERE guild_id = ? AND discord_id = ?").get(guildId, discordId);
    const id = existing?.id || randomUUID();
    this.#db.prepare(`
      INSERT INTO rms_members (id, guild_id, discord_id, callsign, display_name, rank, status, hire_date, joined_at, time_zone, source, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(guild_id, discord_id) DO UPDATE SET callsign = excluded.callsign, display_name = excluded.display_name,
        rank = excluded.rank, status = excluded.status, hire_date = excluded.hire_date, joined_at = excluded.joined_at,
        time_zone = excluded.time_zone, source = excluded.source, updated_at = excluded.updated_at
    `).run(id, guildId, discordId, callsign, displayName, rank, status, hireDate, joinedAt, timeZone, source, timestamp, timestamp);
    return this.memberById(id);
  }

  memberById(id) {
    const row = this.#db.prepare("SELECT * FROM rms_members WHERE id = ?").get(id);
    return row ? this.#member(row) : null;
  }

  memberByDiscordId(guildId, discordId) {
    const row = this.#db.prepare("SELECT * FROM rms_members WHERE guild_id = ? AND discord_id = ?").get(guildId, discordId);
    return row ? this.#member(row) : null;
  }

  searchMembers(guildId, query = "", limit = 50) {
    const term = `%${String(query).trim().replace(/[%_]/g, "\\$&")} %`.replace(/ %$/, "%");
    const rows = query.trim()
      ? this.#db.prepare(`SELECT * FROM rms_members WHERE guild_id = ? AND (callsign LIKE ? ESCAPE '\\' OR display_name LIKE ? ESCAPE '\\' OR discord_id = ?) ORDER BY display_name LIMIT ?`).all(guildId, term, term, query.trim(), limit)
      : this.#db.prepare("SELECT * FROM rms_members WHERE guild_id = ? ORDER BY display_name LIMIT ?").all(guildId, limit);
    return rows.map(row => this.#member(row));
  }

  memberStats(guildId) {
    const row = this.#db.prepare(`
      SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) AS active,
        SUM(CASE WHEN status = 'inactive' THEN 1 ELSE 0 END) AS inactive,
        SUM(CASE WHEN status = 'leave' THEN 1 ELSE 0 END) AS leave_count,
        SUM(CASE WHEN status = 'separated' THEN 1 ELSE 0 END) AS separated
      FROM rms_members WHERE guild_id = ?
    `).get(guildId);
    return { total: Number(row.total || 0), active: Number(row.active || 0), inactive: Number(row.inactive || 0), leave: Number(row.leave_count || 0), separated: Number(row.separated || 0) };
  }

  recordStats(guildId) {
    const row = this.#db.prepare(`
      SELECT COUNT(*) AS total,
        SUM(CASE WHEN record_type = 'training' THEN 1 ELSE 0 END) AS training,
        SUM(CASE WHEN record_type = 'promotion' THEN 1 ELSE 0 END) AS promotion,
        SUM(CASE WHEN record_type = 'inactivity' THEN 1 ELSE 0 END) AS inactivity,
        SUM(CASE WHEN status = 'finalized' THEN 1 ELSE 0 END) AS finalized
      FROM rms_records WHERE guild_id = ?
    `).get(guildId);
    return { total: Number(row.total || 0), training: Number(row.training || 0), promotion: Number(row.promotion || 0), inactivity: Number(row.inactivity || 0), finalized: Number(row.finalized || 0) };
  }

  records(guildId, { memberId = null, recordType = null, status = null, query = "", limit = 100 } = {}) {
    const clauses = ["r.guild_id = ?"];
    const values = [guildId];
    if (memberId) { clauses.push("r.member_id = ?"); values.push(memberId); }
    if (recordType) { clauses.push("r.record_type = ?"); values.push(recordType); }
    if (status) { clauses.push("r.status = ?"); values.push(status); }
    if (String(query).trim()) {
      const term = `%${String(query).trim().replace(/[%_]/g, "\\$&")} %`.replace(/ %$/, "%");
      clauses.push("(m.callsign LIKE ? ESCAPE '\\' OR m.display_name LIKE ? ESCAPE '\\' OR r.record_type LIKE ? ESCAPE '\\' OR r.data_json LIKE ? ESCAPE '\\')");
      values.push(term, term, term, term);
    }
    values.push(Math.min(Math.max(Number(limit) || 100, 1), 500));
    const rows = this.#db.prepare(`
      SELECT r.id, r.guild_id, r.member_id, r.record_type, r.status, r.effective_date,
        r.created_by, r.source_record_id, r.data_json, r.created_at, r.updated_at,
        m.discord_id, m.callsign, m.display_name, m.rank, m.status AS member_status
      FROM rms_records r JOIN rms_members m ON m.id = r.member_id
      WHERE ${clauses.join(" AND ")}
      ORDER BY COALESCE(r.effective_date, '0000-00-00') DESC, r.created_at DESC LIMIT ?
    `).all(...values);
    return rows.map(row => ({ id: row.id, guildId: row.guild_id, memberId: row.member_id, recordType: row.record_type, status: row.status, effectiveDate: row.effective_date, createdBy: row.created_by, sourceRecordId: row.source_record_id, data: parse(row.data_json), detail: this.recordById(row.id)?.detail || null, createdAt: row.created_at, updatedAt: row.updated_at, member: { discordId: row.discord_id, callsign: row.callsign, displayName: row.display_name, rank: row.rank, status: row.member_status } }));
  }

  updateMember(id, { callsign, displayName, rank, status, hireDate, timeZone } = {}) {
    const existing = this.#db.prepare("SELECT * FROM rms_members WHERE id = ?").get(id);
    if (!existing) return null;
    const timestamp = now();
    this.#db.prepare(`UPDATE rms_members SET callsign = ?, display_name = ?, rank = ?, status = ?, hire_date = ?, time_zone = ?, updated_at = ? WHERE id = ?`)
      .run(callsign ?? existing.callsign, displayName ?? existing.display_name, rank ?? existing.rank, status ?? existing.status, hireDate ?? existing.hire_date, timeZone ?? existing.time_zone, timestamp, id);
    return this.memberById(id);
  }

  createRecord({ guildId, memberId, recordType, status = "finalized", effectiveDate = null, createdBy, sourceChannelId = null, sourceMessageId = null, sourceRecordId = null, data = {} }) {
    const id = randomUUID();
    const timestamp = now();
    this.#db.prepare(`INSERT INTO rms_records (id, guild_id, member_id, record_type, status, effective_date, created_by, source_channel_id, source_message_id, source_record_id, data_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, guildId, memberId, recordType, status, effectiveDate, createdBy, sourceChannelId, sourceMessageId, sourceRecordId, json(data), timestamp, timestamp);
    return this.recordById(id);
  }

  addTrainingRecord({ recordId, trainerDiscordId, division, trainingDate, startTime = null, endTime = null, timeZone = null, trainingType = null, outcome = null, notes = null }) {
    this.#db.prepare(`INSERT INTO rms_training_records (record_id, trainer_discord_id, division, training_date, start_time, end_time, time_zone, training_type, outcome, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(recordId, trainerDiscordId, division, trainingDate, startTime, endTime, timeZone, trainingType, outcome, notes);
    return this.recordById(recordId);
  }

  addPromotionRecord({ recordId, fromRank, toRank, promotionDate, reason = null, authorizationReference = null }) {
    this.#db.prepare(`INSERT INTO rms_promotion_records (record_id, from_rank, to_rank, promotion_date, reason, authorization_reference) VALUES (?, ?, ?, ?, ?, ?)`)
      .run(recordId, fromRank, toRank, promotionDate, reason, authorizationReference);
    return this.recordById(recordId);
  }

  recordById(id) {
    const row = this.#db.prepare("SELECT r.*, m.discord_id, m.callsign, m.display_name, m.rank, m.status AS member_status FROM rms_records r JOIN rms_members m ON m.id = r.member_id WHERE r.id = ?").get(id);
    if (!row) return null;
    const detail = row.record_type === "training"
      ? this.#db.prepare("SELECT * FROM rms_training_records WHERE record_id = ?").get(id)
      : row.record_type === "promotion"
        ? this.#db.prepare("SELECT * FROM rms_promotion_records WHERE record_id = ?").get(id)
        : null;
    return { id: row.id, guildId: row.guild_id, memberId: row.member_id, member: { discordId: row.discord_id, callsign: row.callsign, displayName: row.display_name, rank: row.rank, status: row.member_status }, recordType: row.record_type, status: row.status, effectiveDate: row.effective_date, createdBy: row.created_by, sourceChannelId: row.source_channel_id, sourceMessageId: row.source_message_id, sourceRecordId: row.source_record_id, data: parse(row.data_json), detail, createdAt: row.created_at, updatedAt: row.updated_at };
  }

  recordBySourceId(guildId, sourceRecordId) {
    const row = this.#db.prepare("SELECT id FROM rms_records WHERE guild_id = ? AND source_record_id = ?").get(guildId, sourceRecordId);
    return row ? this.recordById(row.id) : null;
  }

  memberTimeline(guildId, memberId, limit = 100) {
    return this.records(guildId, { memberId, limit }).map(item => ({ ...item, member: { discordId: item.member.discordId, callsign: item.member.callsign, displayName: item.member.displayName }, detail: this.recordById(item.id)?.detail || null }));
  }

  inactivityQueue(guildId, limit = 100) {
    const members = this.#db.prepare("SELECT * FROM rms_members WHERE guild_id = ? AND status = 'inactive' ORDER BY display_name LIMIT ?").all(guildId, Math.min(Math.max(Number(limit) || 100, 1), 500));
    return members.map(row => {
      const member = this.#member(row);
      const latest = this.records(guildId, { memberId: member.id, limit: 1 })[0] || null;
      const latestReview = this.records(guildId, { memberId: member.id, recordType: "inactivity", limit: 1 })[0] || null;
      return {
        member,
        lastActivity: latest ? { date: latest.effectiveDate, type: latest.recordType, summary: latest.data?.summary || latest.detail?.outcome || null } : null,
        lastReviewDate: latestReview?.effectiveDate || null
      };
    });
  }

  createApproval({ recordId = null, sourceActionId = null, guildId, workflowType, stage, requestedBy, expiresAt = null, notes = null }) {
    const id = randomUUID();
    this.#db.prepare("INSERT INTO rms_approvals (id, record_id, source_action_id, guild_id, workflow_type, stage, status, requested_by, requested_at, expires_at, notes) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?)").run(id, recordId, sourceActionId, guildId, workflowType, stage, requestedBy, now(), expiresAt, notes);
    return this.approvalById(id);
  }

  approvalById(id) {
    const row = this.#db.prepare("SELECT * FROM rms_approvals WHERE id = ?").get(id);
    return row ? this.#approval(row) : null;
  }

  pendingApprovals(guildId, limit = 100) {
    this.expireApprovals(guildId);
    return this.#db.prepare("SELECT * FROM rms_approvals WHERE guild_id = ? AND status = 'pending' ORDER BY requested_at ASC LIMIT ?").all(guildId, limit).map(row => this.#approval(row));
  }

  expireApprovals(guildId, at = now()) {
    return this.#db.prepare("UPDATE rms_approvals SET status = 'expired', decided_at = ?, notes = COALESCE(notes, 'Approval window expired') WHERE guild_id = ? AND status = 'pending' AND expires_at IS NOT NULL AND expires_at < ?").run(at, guildId, at).changes;
  }

  pendingApprovalBySourceId(guildId, sourceActionId) {
    const row = this.#db.prepare("SELECT * FROM rms_approvals WHERE guild_id = ? AND source_action_id = ? AND status = 'pending' ORDER BY requested_at DESC LIMIT 1").get(guildId, sourceActionId);
    return row ? this.#approval(row) : null;
  }

  decideApprovalsForSource(guildId, sourceActionId, { status, decidedBy, notes = null }) {
    const timestamp = now();
    const result = this.#db.prepare("UPDATE rms_approvals SET status = ?, decided_by = ?, decided_at = ?, notes = COALESCE(?, notes) WHERE guild_id = ? AND source_action_id = ? AND status = 'pending'").run(status, decidedBy, timestamp, notes, guildId, sourceActionId);
    return result.changes;
  }

  renewApprovalsForSource(guildId, sourceActionId, expiresAt) {
    return this.#db.prepare("UPDATE rms_approvals SET expires_at = ?, notes = NULL WHERE guild_id = ? AND source_action_id = ? AND status = 'pending'").run(expiresAt, guildId, sourceActionId).changes;
  }

  decideApproval(id, { status, decidedBy, notes = null }) {
    const timestamp = now();
    const result = this.#db.prepare("UPDATE rms_approvals SET status = ?, decided_by = ?, decided_at = ?, notes = COALESCE(?, notes) WHERE id = ? AND status = 'pending'").run(status, decidedBy, timestamp, notes, id);
    return result.changes ? this.approvalById(id) : null;
  }

  updateRecordStatus(id, status) {
    const result = this.#db.prepare("UPDATE rms_records SET status = ?, updated_at = ? WHERE id = ?").run(status, now(), id);
    return result.changes ? this.recordById(id) : null;
  }

  upsertAccount({ guildId, discordId, accessLevel = "member" }) {
    const timestamp = now();
    const existing = this.#db.prepare("SELECT id FROM rms_accounts WHERE guild_id = ? AND discord_id = ?").get(guildId, discordId);
    const id = existing?.id || randomUUID();
    this.#db.prepare(`INSERT INTO rms_accounts (id, guild_id, discord_id, access_level, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(guild_id, discord_id) DO UPDATE SET access_level = excluded.access_level, updated_at = excluded.updated_at`).run(id, guildId, discordId, accessLevel, timestamp, timestamp);
    return this.accountById(id);
  }

  accountById(id) {
    const row = this.#db.prepare("SELECT * FROM rms_accounts WHERE id = ?").get(id);
    return row ? { id: row.id, guildId: row.guild_id, discordId: row.discord_id, accessLevel: row.access_level, lastLoginAt: row.last_login_at, createdAt: row.created_at, updatedAt: row.updated_at } : null;
  }

  createSession(tokenHash, accountId, expiresAt) {
    this.#db.prepare("DELETE FROM rms_sessions WHERE expires_at < ?").run(now());
    this.#db.prepare("INSERT INTO rms_sessions (token_hash, account_id, created_at, expires_at) VALUES (?, ?, ?, ?)").run(tokenHash, accountId, now(), expiresAt);
  }

  sessionAccount(tokenHash) {
    const row = this.#db.prepare("SELECT a.* FROM rms_sessions s JOIN rms_accounts a ON a.id = s.account_id WHERE s.token_hash = ? AND s.expires_at > ?").get(tokenHash, now());
    return row ? { id: row.id, guildId: row.guild_id, discordId: row.discord_id, accessLevel: row.access_level, lastLoginAt: row.last_login_at } : null;
  }

  touchAccount(id) { this.#db.prepare("UPDATE rms_accounts SET last_login_at = ?, updated_at = ? WHERE id = ?").run(now(), now(), id); }

  audit({ guildId, actorDiscordId = null, action, entityType, entityId = null, metadata = {} }) {
    const id = randomUUID();
    this.#db.prepare("INSERT INTO rms_audit_events (id, guild_id, actor_discord_id, action, entity_type, entity_id, metadata_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(id, guildId, actorDiscordId, action, entityType, entityId, json(metadata), now());
    return id;
  }

  auditTrail(guildId, limit = 100) {
    return this.#db.prepare("SELECT * FROM rms_audit_events WHERE guild_id = ? ORDER BY created_at DESC LIMIT ?").all(guildId, limit).map(row => ({ id: row.id, actorDiscordId: row.actor_discord_id, action: row.action, entityType: row.entity_type, entityId: row.entity_id, metadata: parse(row.metadata_json), createdAt: row.created_at }));
  }

  importRun({ guildId, sourceName, sourceReference = null, rowCount, importedBy, metadata = {} }) {
    const id = randomUUID();
    this.#db.prepare("INSERT INTO rms_imports (id, guild_id, source_name, source_reference, row_count, imported_by, created_at, metadata_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(id, guildId, sourceName, sourceReference, rowCount, importedBy, now(), json(metadata));
    return id;
  }

  #member(row) {
    return { id: row.id, guildId: row.guild_id, discordId: row.discord_id, callsign: row.callsign, displayName: row.display_name, rank: row.rank, status: row.status, hireDate: row.hire_date, joinedAt: row.joined_at, timeZone: row.time_zone, source: row.source, createdAt: row.created_at, updatedAt: row.updated_at };
  }

  #approval(row) {
    return { id: row.id, recordId: row.record_id, sourceActionId: row.source_action_id, guildId: row.guild_id, workflowType: row.workflow_type, stage: row.stage, status: row.status, requestedBy: row.requested_by, decidedBy: row.decided_by, requestedAt: row.requested_at, expiresAt: row.expires_at, decidedAt: row.decided_at, notes: row.notes };
  }
}
