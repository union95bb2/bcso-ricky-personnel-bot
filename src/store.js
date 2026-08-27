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
      CREATE TABLE IF NOT EXISTS record_threads (
        guild_id TEXT NOT NULL,
        channel_id TEXT NOT NULL,
        member_id TEXT NOT NULL,
        thread_id TEXT NOT NULL,
        thread_name TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (guild_id, channel_id, member_id)
      );
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
      CREATE TABLE IF NOT EXISTS promotion_cases (
        id TEXT PRIMARY KEY,
        guild_id TEXT NOT NULL,
        member_id TEXT NOT NULL,
        created_by TEXT NOT NULL,
        status TEXT NOT NULL,
        ticket_channel_id TEXT,
        ticket_thread_id TEXT,
        ticket_message_id TEXT,
        candidate_removed_at INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        data_json TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS promotion_cases_status_idx ON promotion_cases(guild_id, status, updated_at DESC);
      CREATE TABLE IF NOT EXISTS promotion_case_events (
        id TEXT PRIMARY KEY,
        case_id TEXT NOT NULL,
        actor_id TEXT NOT NULL,
        event_type TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        data_json TEXT NOT NULL,
        FOREIGN KEY(case_id) REFERENCES promotion_cases(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS promotion_case_events_case_idx ON promotion_case_events(case_id, created_at ASC);
    `);
    const pendingColumns = this.#db.prepare("PRAGMA table_info(pending_actions)").all().map(column => column.name);
    if (!pendingColumns.includes("status")) this.#db.exec("ALTER TABLE pending_actions ADD COLUMN status TEXT NOT NULL DEFAULT 'pending'");
    if (!pendingColumns.includes("claimed_by")) this.#db.exec("ALTER TABLE pending_actions ADD COLUMN claimed_by TEXT");
    if (!pendingColumns.includes("claimed_at")) this.#db.exec("ALTER TABLE pending_actions ADD COLUMN claimed_at INTEGER");
    if (!pendingColumns.includes("reminder_sent_at")) this.#db.exec("ALTER TABLE pending_actions ADD COLUMN reminder_sent_at INTEGER");
    // A process restart means no handler is still working on a claimed action.
    // Return those actions to the queue before expiry cleanup so a transient
    // crash cannot leave a dead approval card permanently stuck.
    this.recoverClaimed();
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

  recoverClaimed() {
    return this.#db.prepare("UPDATE pending_actions SET status = 'pending', claimed_by = NULL, claimed_at = NULL WHERE status = 'claimed'").run().changes;
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

  recordThread(guildId, channelId, memberId) {
    const row = this.#db.prepare("SELECT guild_id, channel_id, member_id, thread_id, thread_name, created_at, updated_at FROM record_threads WHERE guild_id = ? AND channel_id = ? AND member_id = ?").get(guildId, channelId, memberId);
    return row ? { guildId: row.guild_id, channelId: row.channel_id, memberId: row.member_id, threadId: row.thread_id, threadName: row.thread_name, createdAt: row.created_at, updatedAt: row.updated_at } : null;
  }

  saveRecordThread({ guildId, channelId, memberId, threadId, threadName }) {
    const now = Date.now();
    this.#db.prepare(`
      INSERT INTO record_threads (guild_id, channel_id, member_id, thread_id, thread_name, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(guild_id, channel_id, member_id) DO UPDATE SET thread_id = excluded.thread_id, thread_name = excluded.thread_name, updated_at = excluded.updated_at
    `).run(guildId, channelId, memberId, threadId, threadName, now, now);
  }

  createPromotionCase({ guildId, memberId, createdBy, data }) {
    const id = `PC-${randomUUID().slice(0, 8).toUpperCase()}`;
    const now = Date.now();
    this.#db.prepare(`
      INSERT INTO promotion_cases (id, guild_id, member_id, created_by, status, created_at, updated_at, data_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, guildId, memberId, createdBy, data.status || 'pending-verification', now, now, JSON.stringify(data));
    this.addPromotionCaseEvent(id, { actorId: createdBy, eventType: 'case-created', data: { memberId, memberLabel: data.memberLabel, fromRank: data.fromRank, toRank: data.toRank } });
    return id;
  }

  promotionCase(id) {
    const row = this.#db.prepare('SELECT * FROM promotion_cases WHERE id = ?').get(id);
    if (!row) return null;
    const events = this.#db.prepare('SELECT id, actor_id, event_type, created_at, data_json FROM promotion_case_events WHERE case_id = ? ORDER BY created_at ASC').all(id).map(event => ({
      id: event.id,
      actorId: event.actor_id,
      eventType: event.event_type,
      createdAt: event.created_at,
      data: JSON.parse(event.data_json)
    }));
    return {
      id: row.id,
      guildId: row.guild_id,
      memberId: row.member_id,
      createdBy: row.created_by,
      status: row.status,
      ticketChannelId: row.ticket_channel_id,
      ticketThreadId: row.ticket_thread_id,
      ticketMessageId: row.ticket_message_id,
      candidateRemovedAt: row.candidate_removed_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      data: { ...JSON.parse(row.data_json), events }
    };
  }

  updatePromotionCase(id, mutate) {
    const current = this.promotionCase(id);
    if (!current) return null;
    const next = mutate(structuredClone(current.data)) || current.data;
    const now = Date.now();
    this.#db.prepare(`
      UPDATE promotion_cases
      SET status = ?, ticket_channel_id = ?, ticket_thread_id = ?, ticket_message_id = ?, candidate_removed_at = ?, updated_at = ?, data_json = ?
      WHERE id = ?
    `).run(next.status || current.status, next.ticketChannelId || current.ticketChannelId || null, next.ticketThreadId || current.ticketThreadId || null, next.ticketMessageId || current.ticketMessageId || null, next.candidateRemovedAt || current.candidateRemovedAt || null, now, JSON.stringify(next), id);
    return this.promotionCase(id);
  }

  addPromotionCaseEvent(caseId, { actorId, eventType, data = {}, createdAt = Date.now() }) {
    const eventId = randomUUID();
    this.#db.prepare(`
      INSERT INTO promotion_case_events (id, case_id, actor_id, event_type, created_at, data_json)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(eventId, caseId, actorId, eventType, createdAt, JSON.stringify(data));
    return eventId;
  }

  listPromotionCases({ guildId, status = null, limit = 20 } = {}) {
    const clauses = ['guild_id = ?'];
    const values = [guildId];
    if (status) { clauses.push('status = ?'); values.push(status); }
    values.push(limit);
    return this.#db.prepare(`SELECT id FROM promotion_cases WHERE ${clauses.join(' AND ')} ORDER BY updated_at DESC LIMIT ?`).all(...values).map(row => this.promotionCase(row.id));
  }

  summary() {
    this.purgeExpired();
    const completed = this.#db.prepare("SELECT COUNT(*) AS count FROM records").get().count;
    // The dashboard's queue count must match listPending(). Claimed actions
    // are already being processed and expired actions are closed; neither is
    // an open approval waiting for staff.
    const pending = this.#db.prepare("SELECT COUNT(*) AS count FROM pending_actions WHERE status = 'pending'").get().count;
    const promotionCases = this.#db.prepare("SELECT COUNT(*) AS count FROM promotion_cases WHERE status NOT IN ('oots-review', 'cancelled')").get().count;
    const latest = this.#db.prepare("SELECT created_at FROM records ORDER BY created_at DESC LIMIT 1").get();
    return { completed, pending, promotionCases, latestAt: latest?.created_at || null };
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
