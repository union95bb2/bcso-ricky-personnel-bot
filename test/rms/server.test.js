import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRmsServer } from "../../src/rms/server.js";
import { RmsStore } from "../../src/rms/store.js";

function responseMock() {
  return { status: null, headers: null, body: "", writeHead(status, headers) { this.status = status; this.headers = headers; }, end(body = "") { this.body += body; } };
}

function request(url, { method = "GET", body, cookie } = {}) {
  return { url, method, body, headers: { cookie: cookie ? `rms_session=${encodeURIComponent(cookie)}` : "" } };
}

test("RMS health endpoint is available without an account and static dashboard is served", async () => {
  const app = createRmsServer({
    config: { guildId: "g", clientId: "c", clientSecret: "s", botToken: "b", redirectUri: "http://localhost/auth/callback", sessionSecret: "secret", port: 0, bind: "127.0.0.1", dataPath: ":memory:", pabRoleId: "", commandRoleId: "", adminRoleIds: new Set() },
    store: new RmsStore(":memory:"),
    fetchImpl: async () => { throw new Error("network should not be called"); }
  });
  const health = responseMock();
  await app.handleRequest({ url: "/api/health", headers: {}, method: "GET" }, health);
  assert.equal(health.status, 200);
  assert.equal(JSON.parse(health.body).ok, true);
  assert.equal(JSON.parse(health.body).database, "ok");
  assert.equal(JSON.parse(health.body).version, "1.0.0");
  const page = responseMock();
  await app.handleRequest({ url: "/", headers: {}, method: "GET" }, page);
  assert.equal(page.status, 200);
  assert.match(String(page.body), /Ricky RMS/);
  assert.match(String(page.body), /rel="icon"/);
  assert.match(String(page.body), /rms-favicon-1/);
  assert.match(String(page.body), /retry-request/);
  assert.match(String(page.body), /check-eligibility/);
  assert.match(String(page.body), /expiring-records/);
  app.store.close();
});

test("RMS status endpoint is restricted to PAB and reports safe diagnostics", async () => {
  const store = new RmsStore(":memory:");
  const app = createRmsServer({
    config: { guildId: "g", clientId: "c", clientSecret: "s", botToken: "b", redirectUri: "http://localhost/auth/callback", sessionSecret: "secret", port: 0, bind: "127.0.0.1", dataPath: ":memory:", pabRoleId: "pab", commandRoleId: "command", adminRoleIds: new Set() },
    store,
    fetchImpl: async () => { throw new Error("network should not be called"); }
  });
  const member = store.upsertAccount({ guildId: "g", discordId: "member", accessLevel: "member" });
  const pab = store.upsertAccount({ guildId: "g", discordId: "pab-user", accessLevel: "pab" });
  const memberSession = "member-session";
  const pabSession = "pab-session";
  store.createSession(createHash("sha256").update(`secret:${memberSession}`).digest("hex"), member.id, Date.now() + 60_000);
  store.createSession(createHash("sha256").update(`secret:${pabSession}`).digest("hex"), pab.id, Date.now() + 60_000);
  const denied = responseMock();
  await app.handleRequest(request("/api/status", { cookie: memberSession }), denied);
  assert.equal(denied.status, 403);
  const allowed = responseMock();
  await app.handleRequest(request("/api/status", { cookie: pabSession }), allowed);
  assert.equal(allowed.status, 200);
  assert.deepEqual(JSON.parse(allowed.body), { ok: true, service: "Ricky RMS", version: "1.0.0", database: "ok", discordConfigured: true, oauthConfigured: true, checkedAt: JSON.parse(allowed.body).checkedAt });
  app.store.close();
});

test("RMS PAB API supports personnel, records, and summary workflows", async () => {
  const store = new RmsStore(":memory:");
  const app = createRmsServer({ config: { guildId: "g", clientId: "c", clientSecret: "s", botToken: "b", redirectUri: "http://localhost/auth/callback", sessionSecret: "secret", port: 0, bind: "127.0.0.1", dataPath: ":memory:", pabRoleId: "pab", commandRoleId: "command", adminRoleIds: new Set() }, store, fetchImpl: async () => { throw new Error("network should not be called"); } });
  const account = store.upsertAccount({ guildId: "g", discordId: "actor", accessLevel: "pab" });
  const rawSession = "session-token";
  store.createSession(createHash("sha256").update(`secret:${rawSession}`).digest("hex"), account.id, Date.now() + 60_000);
  const cookie = rawSession;
  const addMember = responseMock();
  await app.handleRequest(request("/api/members", { method: "POST", cookie, body: { discordId: "u1", displayName: "Tyler M", callsign: "C-907", rank: "DST" } }), addMember);
  assert.equal(addMember.status, 201);
  const member = JSON.parse(addMember.body).member;
  const addRecord = responseMock();
  await app.handleRequest(request("/api/records", { method: "POST", cookie, body: { memberId: member.id, recordType: "training", effectiveDate: "2026-08-20", data: { summary: "Academy classroom" }, detail: { trainingType: "Classroom", trainerDiscordId: "actor" } } }), addRecord);
  assert.equal(addRecord.status, 201);
  const summary = responseMock();
  await app.handleRequest(request("/api/summary", { cookie }), summary);
  assert.equal(JSON.parse(summary.body).members.total, 1);
  assert.equal(JSON.parse(summary.body).records.training, 1);
  const records = responseMock();
  await app.handleRequest(request("/api/records", { cookie }), records);
  assert.equal(JSON.parse(records.body).records[0].member.callsign, "C-907");
  app.store.close();
});

test("RMS exposes PAB-only inactivity review and record search", async () => {
  const store = new RmsStore(":memory:");
  const app = createRmsServer({ config: { guildId: "g", clientId: "c", clientSecret: "s", botToken: "b", redirectUri: "http://localhost/auth/callback", sessionSecret: "secret", port: 0, bind: "127.0.0.1", dataPath: ":memory:", pabRoleId: "pab", commandRoleId: "command", adminRoleIds: new Set() }, store, fetchImpl: async () => { throw new Error("network should not be called"); } });
  const account = store.upsertAccount({ guildId: "g", discordId: "actor", accessLevel: "pab" });
  const inactive = store.upsertMember({ guildId: "g", discordId: "u1", callsign: "C-907", displayName: "Tyler M", status: "inactive" });
  store.createRecord({ guildId: "g", memberId: inactive.id, recordType: "training", effectiveDate: "2026-08-01", createdBy: "actor", data: { summary: "Last classroom" } });
  const rawSession = "session-token";
  store.createSession(createHash("sha256").update(`secret:${rawSession}`).digest("hex"), account.id, Date.now() + 60_000);
  const search = responseMock();
  await app.handleRequest(request("/api/records?q=classroom", { cookie: rawSession }), search);
  assert.equal(search.status, 200);
  assert.equal(JSON.parse(search.body).records.length, 1);
  const inactivity = responseMock();
  await app.handleRequest(request("/api/inactivity", { cookie: rawSession }), inactivity);
  assert.equal(inactivity.status, 200);
  assert.equal(JSON.parse(inactivity.body).reviews[0].member.callsign, "C-907");
  app.store.close();
});

test("RMS exposes advisory eligibility, expiring records, and approval renewal", async () => {
  const store = new RmsStore(":memory:");
  const app = createRmsServer({ config: { guildId: "g", clientId: "c", clientSecret: "s", botToken: "b", redirectUri: "http://localhost/auth/callback", sessionSecret: "secret", port: 0, bind: "127.0.0.1", dataPath: ":memory:", pabRoleId: "pab", commandRoleId: "command", adminRoleIds: new Set() }, store, fetchImpl: async () => { throw new Error("network should not be called"); } });
  const account = store.upsertAccount({ guildId: "g", discordId: "actor", accessLevel: "pab" });
  const member = store.upsertMember({ guildId: "g", discordId: "u1", callsign: "C-110", displayName: "W. Dorfman", rank: "Deputy" });
  const expiryDate = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10);
  store.createRecord({ guildId: "g", memberId: member.id, recordType: "training", effectiveDate: "2026-08-01", createdBy: "actor", data: { summary: "Academy complete" } });
  store.createRecord({ guildId: "g", memberId: member.id, recordType: "qualification", effectiveDate: "2026-08-01", expiresOn: expiryDate, createdBy: "actor", data: { summary: "Pursuit qualification" } });
  const approval = store.createApproval({ guildId: "g", workflowType: "qualification", stage: "pab", requestedBy: "actor", expiresAt: Date.now() + 60_000 });
  const rawSession = "session-token";
  store.createSession(createHash("sha256").update(`secret:${rawSession}`).digest("hex"), account.id, Date.now() + 60_000);
  const eligibility = responseMock();
  await app.handleRequest(request(`/api/members/${member.id}/eligibility?requestedRank=Corporal`, { cookie: rawSession }), eligibility);
  assert.equal(eligibility.status, 200);
  assert.equal(JSON.parse(eligibility.body).recommendation, "evidence-ready-for-human-review");
  const expiring = responseMock();
  await app.handleRequest(request("/api/records/expiring?days=30", { cookie: rawSession }), expiring);
  assert.equal(expiring.status, 200);
  assert.equal(JSON.parse(expiring.body).records[0].id, store.recordById(JSON.parse(expiring.body).records[0].id).id);
  const renewal = responseMock();
  await app.handleRequest(request(`/api/approvals/${approval.id}/renew`, { method: "POST", cookie: rawSession, body: {} }), renewal);
  assert.equal(renewal.status, 200);
  assert.ok(JSON.parse(renewal.body).approval.expiresAt > Date.now());
  app.store.close();
});

test("RMS Discord roster sync imports human members and maps rank roles", async () => {
  const store = new RmsStore(":memory:");
  const app = createRmsServer({
    config: { guildId: "g", clientId: "c", clientSecret: "s", botToken: "b", redirectUri: "http://localhost/auth/callback", sessionSecret: "secret", port: 0, bind: "127.0.0.1", dataPath: ":memory:", pabRoleId: "pab", commandRoleId: "command", adminRoleIds: new Set(), rankRoleIds: { "Deputy Sheriff Trainee": "rank-dst" } },
    store,
    fetchImpl: async url => ({ ok: true, json: async () => url.includes("/members?") ? [
      { user: { id: "u1", username: "tyler", global_name: "Tyler M", bot: false }, nick: "C-907 | Tyler M", roles: ["rank-dst"], joined_at: "2026-08-01T00:00:00.000Z" },
      { user: { id: "bot", username: "ricky", bot: true }, nick: "Ricky", roles: [], joined_at: "2026-08-01T00:00:00.000Z" }
    ] : [] })
  });
  const account = store.upsertAccount({ guildId: "g", discordId: "actor", accessLevel: "pab" });
  store.upsertMember({ guildId: "g", discordId: "u1", displayName: "Tyler M", callsign: "C-907", rank: "Deputy", status: "inactive" });
  const rawSession = "session-token";
  store.createSession(createHash("sha256").update(`secret:${rawSession}`).digest("hex"), account.id, Date.now() + 60_000);
  const response = responseMock();
  await app.handleRequest(request("/api/sync", { method: "POST", cookie: rawSession, body: {} }), response);
  assert.equal(response.status, 200);
  assert.equal(JSON.parse(response.body).count, 1);
  const member = store.memberByDiscordId("g", "u1");
  assert.equal(member.callsign, "C-907");
  assert.equal(member.rank, "Deputy Sheriff Trainee");
  assert.equal(member.status, "inactive");
  assert.equal(store.auditTrail("g", 10)[0].action, "roster_sync");
  app.store.close();
});

test("RMS account access refreshes from current Discord roles on page load", async () => {
  const store = new RmsStore(":memory:");
  const app = createRmsServer({
    config: { guildId: "g", clientId: "c", clientSecret: "s", botToken: "b", redirectUri: "http://localhost/auth/callback", sessionSecret: "secret", port: 0, bind: "127.0.0.1", dataPath: ":memory:", pabRoleId: "pab", commandRoleId: "command", adminRoleIds: new Set(), rankRoleIds: {} },
    store,
    fetchImpl: async () => ({ ok: true, json: async () => ({ user: { id: "actor" }, roles: ["pab"] }) })
  });
  const account = store.upsertAccount({ guildId: "g", discordId: "actor", accessLevel: "member" });
  const rawSession = "session-token";
  store.createSession(createHash("sha256").update(`secret:${rawSession}`).digest("hex"), account.id, Date.now() + 60_000);
  const response = responseMock();
  await app.handleRequest(request("/api/me", { cookie: rawSession }), response);
  assert.equal(response.status, 200);
  assert.equal(JSON.parse(response.body).account.accessLevel, "pab");
  app.store.close();
});
