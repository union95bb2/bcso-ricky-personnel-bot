import { createHash, randomBytes, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { RmsStore } from "./store.js";
import { BCSO_RANK_MATRIX } from "../rank-matrix.js";

const root = resolve(fileURLToPath(new URL("../../", import.meta.url)));
const webRoot = join(root, "web", "rms");
const mime = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".png": "image/png", ".svg": "image/svg+xml" };

function csvSet(value) { return new Set(String(value || "").split(",").map(item => item.trim()).filter(Boolean)); }
function roleMap(value) {
  try {
    const parsed = JSON.parse(value || "{}");
    return Object.fromEntries(Object.entries(parsed).map(([name, id]) => [name, String(id)]));
  } catch {
    return {};
  }
}
function hash(value) { return createHash("sha256").update(value).digest("hex"); }
function token() { return randomBytes(32).toString("base64url"); }
function cookies(request) { return Object.fromEntries((request.headers.cookie || "").split(";").map(part => part.trim().split("=")).filter(pair => pair.length === 2).map(([key, ...rest]) => [key, decodeURIComponent(rest.join("="))])); }
function jsonResponse(response, status, payload, headers = {}) {
  const body = JSON.stringify(payload);
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers });
  response.end(body);
}
function textResponse(response, status, body, headers = {}) { response.writeHead(status, headers); response.end(body); }
async function readJson(request) {
  if (request.body && typeof request.body === "object") return request.body;
  let raw = "";
  for await (const chunk of request) raw += chunk;
  if (!raw.trim()) return {};
  try { return JSON.parse(raw); } catch { throw new Error("Request body must be valid JSON."); }
}
function safeId(value) { return /^[a-f0-9-]{20,40}$/i.test(String(value || "")); }
function levelAtLeast(level, required) { return ["member", "pab", "command", "admin"].indexOf(level) >= ["member", "pab", "command", "admin"].indexOf(required); }
function configFromEnv(env = process.env) {
  const guildId = env.RMS_GUILD_ID || env.DISCORD_GUILD_ID || "";
  const clientId = env.RMS_DISCORD_CLIENT_ID || env.DISCORD_CLIENT_ID || "";
  return {
    guildId,
    clientId,
    clientSecret: env.RMS_DISCORD_CLIENT_SECRET || "",
    botToken: env.RMS_DISCORD_BOT_TOKEN || env.DISCORD_TOKEN || "",
    redirectUri: env.RMS_DISCORD_REDIRECT_URI || "",
    sessionSecret: env.RMS_SESSION_SECRET || "",
    port: Number(env.RMS_PORT || 8788),
    bind: env.RMS_BIND || "127.0.0.1",
    publicOrigin: env.RMS_PUBLIC_ORIGIN || "",
    dataPath: env.RMS_DATA_PATH || "data/rms.sqlite",
    pabRoleId: env.PAB_ROLE_ID || "",
    commandRoleId: env.COMMAND_ROLE_ID || "",
    adminRoleIds: csvSet(env.RMS_ADMIN_ROLE_IDS),
    rankRoleIds: roleMap(env.RANK_ROLE_IDS),
    devLogin: env.RMS_DEV_LOGIN === "true"
  };
}

export function createRmsServer({ config = configFromEnv(), store = new RmsStore(config.dataPath), fetchImpl = globalThis.fetch } = {}) {
  const oauthStates = new Map();

  function requireConfig() {
    const missing = ["guildId", "clientId", "clientSecret", "botToken", "redirectUri", "sessionSecret"].filter(key => !config[key]);
    return missing;
  }

  function setSession(response, account) {
    const raw = token();
    store.createSession(hash(`${config.sessionSecret}:${raw}`), account.id, Date.now() + 7 * 24 * 60 * 60 * 1000);
    response.setHeader("set-cookie", `rms_session=${encodeURIComponent(raw)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${7 * 24 * 60 * 60}`);
  }

  function accountFor(request) {
    const raw = cookies(request).rms_session;
    if (!raw) return null;
    return store.sessionAccount(hash(`${config.sessionSecret}:${raw}`));
  }

  async function discordFetch(path, options = {}) {
    const response = await fetchImpl(`https://discord.com/api/v10${path}`, { ...options, headers: { authorization: `Bot ${config.botToken}`, ...(options.headers || {}) } });
    if (!response.ok) throw new Error(`Discord API returned ${response.status}`);
    return response.json();
  }

  async function exchangeCode(code) {
    const response = await fetchImpl("https://discord.com/api/v10/oauth2/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: config.clientId, client_secret: config.clientSecret, grant_type: "authorization_code", code, redirect_uri: config.redirectUri })
    });
    if (!response.ok) throw new Error(`Discord OAuth token exchange returned ${response.status}`);
    return response.json();
  }

  async function oauthUser(accessToken) {
    const response = await fetchImpl("https://discord.com/api/v10/users/@me", { headers: { authorization: `Bearer ${accessToken}` } });
    if (!response.ok) throw new Error(`Discord identity lookup returned ${response.status}`);
    return response.json();
  }

  function accessForGuildMember(guildMember) {
    const roles = new Set(guildMember.roles || []);
    if ([...config.adminRoleIds].some(id => roles.has(id))) return "admin";
    if (config.commandRoleId && roles.has(config.commandRoleId)) return "command";
    if (config.pabRoleId && roles.has(config.pabRoleId)) return "pab";
    return "member";
  }

  function callsignFromLabel(value) {
    const match = String(value || "").match(/\bC-?\d{1,4}\b/i);
    return match ? match[0].replace(/^C(?=\d)/i, "C-").toUpperCase() : null;
  }

  function rankFromRoles(roles) {
    const roleSet = new Set(roles || []);
    return BCSO_RANK_MATRIX
      .map(({ key, displayName, aliases }) => ({ displayName, id: config.rankRoleIds?.[key] || aliases.map(alias => config.rankRoleIds?.[alias]).find(Boolean) }))
      .filter(({ id }) => id && roleSet.has(id))
      .at(-1)?.displayName || null;
  }

  async function syncRoster(account) {
    const members = await discordFetch(`/guilds/${config.guildId}/members?limit=1000`);
    let count = 0;
    for (const guildMember of members) {
      if (guildMember.user?.bot) continue;
      const user = guildMember.user || {};
      const displayName = guildMember.nick || user.global_name || user.username || user.id;
      const existing = store.memberByDiscordId(account.guildId, user.id);
      store.upsertMember({
        guildId: account.guildId,
        discordId: user.id,
        callsign: callsignFromLabel(guildMember.nick || displayName) || existing?.callsign || null,
        displayName,
        rank: rankFromRoles(guildMember.roles) || existing?.rank || null,
        status: existing?.status || "active",
        hireDate: existing?.hireDate || null,
        joinedAt: guildMember.joined_at ? Date.parse(guildMember.joined_at) : existing?.joinedAt || null,
        timeZone: existing?.timeZone || null,
        source: "discord-sync"
      });
      count += 1;
    }
    const auditId = store.audit({ guildId: account.guildId, actorDiscordId: account.discordId, action: "roster_sync", entityType: "guild", entityId: account.guildId, metadata: { count, source: "discord" } });
    return { count, auditId };
  }

  function authorized(request, response, required = "member") {
    const account = accountFor(request);
    if (!account) { jsonResponse(response, 401, { error: "Sign in with Discord to use the RMS." }); return null; }
    if (!levelAtLeast(account.accessLevel, required)) { jsonResponse(response, 403, { error: "Your RMS account does not have access to this area." }); return null; }
    return account;
  }

  async function refreshAccountAccess(account) {
    try {
      const guildMember = await discordFetch(`/guilds/${config.guildId}/members/${account.discordId}`);
      const accessLevel = accessForGuildMember(guildMember);
      if (accessLevel !== account.accessLevel) return store.upsertAccount({ guildId: account.guildId, discordId: account.discordId, accessLevel });
    } catch {
      // Keep the last known access level if Discord is temporarily unavailable.
    }
    return account;
  }

  async function route(request, response) {
    const requestId = request.headers["x-request-id"] || randomUUID();
    if (typeof response.setHeader === "function") response.setHeader("x-request-id", requestId);
    const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);
    if (url.pathname === "/auth/login") {
      const missing = requireConfig();
      if (missing.length) return jsonResponse(response, 503, { error: `RMS OAuth is not configured: ${missing.join(", ")}` });
      const state = token();
      oauthStates.set(state, Date.now() + 10 * 60 * 1000);
      const params = new URLSearchParams({ client_id: config.clientId, response_type: "code", redirect_uri: config.redirectUri, scope: "identify", state });
      return textResponse(response, 302, "", { location: `https://discord.com/oauth2/authorize?${params}` });
    }
    if (url.pathname === "/auth/callback") {
      const stateExpiry = oauthStates.get(url.searchParams.get("state"));
      oauthStates.delete(url.searchParams.get("state"));
      if (!stateExpiry || stateExpiry < Date.now()) return textResponse(response, 400, "RMS sign-in expired. Start again.");
      try {
        const oauth = await exchangeCode(url.searchParams.get("code"));
        const user = await oauthUser(oauth.access_token);
        const guildMember = await discordFetch(`/guilds/${config.guildId}/members/${user.id}`);
        const accessLevel = accessForGuildMember(guildMember);
        const account = store.upsertAccount({ guildId: config.guildId, discordId: user.id, accessLevel });
        store.touchAccount(account.id);
        store.audit({ guildId: config.guildId, actorDiscordId: user.id, action: "login", entityType: "account", entityId: account.id, metadata: { accessLevel } });
        setSession(response, account);
        return textResponse(response, 302, "", { location: "/" });
      } catch (error) {
        return textResponse(response, 403, `RMS sign-in failed: ${error instanceof Error ? error.message : "Discord membership could not be verified"}`);
      }
    }
    if (url.pathname === "/auth/logout") {
      response.setHeader("set-cookie", "rms_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0");
      return textResponse(response, 302, "", { location: "/" });
    }
    if (url.pathname === "/api/health") {
      try {
        store.health();
        return jsonResponse(response, 200, { ok: true, service: "Ricky RMS", version: "1.0.0", database: "ok", time: new Date().toISOString() });
      } catch (error) {
        console.error(`[${requestId}] RMS health check failed`, error);
        return jsonResponse(response, 503, { ok: false, service: "Ricky RMS", database: "unavailable", error: "RMS database is unavailable.", requestId });
      }
    }
    if (url.pathname === "/api/status") {
      const account = authorized(request, response, "pab");
      if (!account) return;
      try {
        store.health();
        return jsonResponse(response, 200, {
          ok: true,
          service: "Ricky RMS",
          version: "1.0.0",
          database: "ok",
          discordConfigured: Boolean(config.guildId && config.botToken),
          oauthConfigured: requireConfig().length === 0,
          checkedAt: new Date().toISOString()
        });
      } catch (error) {
        console.error(`[${requestId}] RMS status check failed`, error);
        return jsonResponse(response, 503, { ok: false, database: "unavailable", error: "RMS database is unavailable.", requestId });
      }
    }
    if (url.pathname === "/api/sync" && request.method === "POST") {
      const account = authorized(request, response, "pab");
      if (!account) return;
      try { return jsonResponse(response, 200, await syncRoster(account)); } catch (error) { return jsonResponse(response, 502, { error: `Discord roster sync failed: ${error instanceof Error ? error.message : "unknown error"}` }); }
    }
    if (url.pathname === "/api/summary") {
      const account = authorized(request, response, "pab");
      if (!account) return;
      const approvals = store.pendingApprovals(account.guildId);
      return jsonResponse(response, 200, { members: store.memberStats(account.guildId), records: store.recordStats(account.guildId), pendingApprovals: approvals.length, expiringQualifications: store.expiringRecords(account.guildId, { days: 30, limit: 12 }), recentRecords: store.records(account.guildId, { limit: 12 }), generatedAt: Date.now() });
    }
    if (url.pathname === "/api/me") {
      let account = authorized(request, response);
      if (!account) return;
      account = await refreshAccountAccess(account);
      store.audit({ guildId: account.guildId, actorDiscordId: account.discordId, action: "view", entityType: "account", entityId: account.id });
      const member = store.memberByDiscordId(account.guildId, account.discordId);
      return jsonResponse(response, 200, { account, member });
    }
    if (url.pathname === "/api/members" && request.method === "POST") {
      const account = authorized(request, response, "pab");
      if (!account) return;
      const body = await readJson(request);
      if (!body.discordId || !body.displayName) return jsonResponse(response, 400, { error: "discordId and displayName are required." });
      const member = store.upsertMember({ guildId: account.guildId, discordId: String(body.discordId).trim(), callsign: body.callsign || null, displayName: String(body.displayName).trim(), rank: body.rank || null, status: body.status || "active", hireDate: body.hireDate || null, timeZone: body.timeZone || null, source: body.source || "rms" });
      store.audit({ guildId: account.guildId, actorDiscordId: account.discordId, action: "create_or_update", entityType: "member", entityId: member.id, metadata: { source: member.source } });
      return jsonResponse(response, 201, { member });
    }
    if (url.pathname === "/api/members") {
      const account = authorized(request, response, "pab");
      if (!account) return;
      const members = store.searchMembers(account.guildId, url.searchParams.get("q") || "", Math.min(Number(url.searchParams.get("limit") || 50), 100));
      store.audit({ guildId: account.guildId, actorDiscordId: account.discordId, action: "search", entityType: "member", metadata: { query: url.searchParams.get("q") || "", count: members.length } });
      return jsonResponse(response, 200, { members });
    }
    if (url.pathname === "/api/records" && request.method === "GET") {
      const account = authorized(request, response, "pab");
      if (!account) return;
      const records = store.records(account.guildId, { memberId: url.searchParams.get("memberId") || null, recordType: url.searchParams.get("type") || null, status: url.searchParams.get("status") || null, query: url.searchParams.get("q") || "", limit: Number(url.searchParams.get("limit") || 100) });
      store.audit({ guildId: account.guildId, actorDiscordId: account.discordId, action: "search", entityType: "records", metadata: { count: records.length, query: url.searchParams.get("q") || "" } });
      return jsonResponse(response, 200, { records });
    }
    if (url.pathname === "/api/records/expiring") {
      const account = authorized(request, response, "pab");
      if (!account) return;
      const records = store.expiringRecords(account.guildId, { days: Number(url.searchParams.get("days") || 30), limit: Number(url.searchParams.get("limit") || 100) });
      store.audit({ guildId: account.guildId, actorDiscordId: account.discordId, action: "search", entityType: "expiring_records", metadata: { count: records.length } });
      return jsonResponse(response, 200, { records });
    }
    if (url.pathname === "/api/records" && request.method === "POST") {
      const account = authorized(request, response, "pab");
      if (!account) return;
      const body = await readJson(request);
      const member = store.memberById(body.memberId);
      const allowedTypes = new Set(["training", "promotion", "inactivity", "qualification", "award", "department", "status", "note"]);
      if (!member || member.guildId !== account.guildId) return jsonResponse(response, 400, { error: "A valid RMS member is required." });
      if (!allowedTypes.has(body.recordType)) return jsonResponse(response, 400, { error: `recordType must be one of: ${[...allowedTypes].join(", ")}.` });
      const record = store.createRecord({ guildId: account.guildId, memberId: member.id, recordType: body.recordType, status: body.status || "finalized", effectiveDate: body.effectiveDate || new Date().toISOString().slice(0, 10), expiresOn: body.expiresOn || null, createdBy: account.discordId, sourceRecordId: body.sourceRecordId || null, data: body.data && typeof body.data === "object" ? body.data : {} });
      const detail = body.detail && typeof body.detail === "object" ? body.detail : {};
      if (body.recordType === "training") store.addTrainingRecord({ recordId: record.id, trainerDiscordId: detail.trainerDiscordId || account.discordId, division: detail.division || null, trainingDate: detail.trainingDate || record.effectiveDate, startTime: detail.startTime || null, endTime: detail.endTime || null, timeZone: detail.timeZone || null, trainingType: detail.trainingType || null, outcome: detail.outcome || null, notes: detail.notes || null });
      if (body.recordType === "promotion") store.addPromotionRecord({ recordId: record.id, fromRank: detail.fromRank || "unknown", toRank: detail.toRank || "unknown", promotionDate: detail.promotionDate || record.effectiveDate, reason: detail.reason || null, authorizationReference: detail.authorizationReference || null });
      store.audit({ guildId: account.guildId, actorDiscordId: account.discordId, action: "create", entityType: "record", entityId: record.id, metadata: { recordType: body.recordType, memberId: member.id } });
      return jsonResponse(response, 201, { record: store.recordById(record.id) });
    }
    if (url.pathname === "/api/inactivity") {
      const account = authorized(request, response, "pab");
      if (!account) return;
      const reviews = store.inactivityQueue(account.guildId, Math.min(Number(url.searchParams.get("limit") || 100), 500));
      store.audit({ guildId: account.guildId, actorDiscordId: account.discordId, action: "search", entityType: "inactivity_review", metadata: { count: reviews.length } });
      return jsonResponse(response, 200, { reviews });
    }
    const memberMatch = url.pathname.match(/^\/api\/members\/([^/]+)$/);
    if (memberMatch) {
      const account = authorized(request, response);
      if (!account) return;
      const member = store.memberById(memberMatch[1]);
      if (!member || member.guildId !== account.guildId) return jsonResponse(response, 404, { error: "Member not found." });
      if (request.method === "PATCH") {
        if (!levelAtLeast(account.accessLevel, "pab")) return jsonResponse(response, 403, { error: "PAB access is required to edit personnel." });
        const body = await readJson(request);
        const updated = store.updateMember(member.id, body);
        store.audit({ guildId: account.guildId, actorDiscordId: account.discordId, action: "update", entityType: "member", entityId: member.id, metadata: { fields: Object.keys(body) } });
        return jsonResponse(response, 200, { member: updated });
      }
      if (account.accessLevel === "member" && member.discordId !== account.discordId) return jsonResponse(response, 403, { error: "Members may only view their own RMS profile." });
      const timeline = store.memberTimeline(account.guildId, member.id);
      store.audit({ guildId: account.guildId, actorDiscordId: account.discordId, action: "view", entityType: "member", entityId: member.id });
      return jsonResponse(response, 200, { member, timeline });
    }
    const eligibilityMatch = url.pathname.match(/^\/api\/members\/([^/]+)\/eligibility$/);
    if (eligibilityMatch && request.method === "GET") {
      const account = authorized(request, response, "pab");
      if (!account) return;
      const result = store.memberEligibility(account.guildId, eligibilityMatch[1], url.searchParams.get("requestedRank") || null);
      if (!result) return jsonResponse(response, 404, { error: "Member not found." });
      store.audit({ guildId: account.guildId, actorDiscordId: account.discordId, action: "eligibility_check", entityType: "member", entityId: eligibilityMatch[1], metadata: { requestedRank: result.requestedRank, recommendation: result.recommendation } });
      return jsonResponse(response, 200, result);
    }
    if (url.pathname === "/api/approvals") {
      const account = authorized(request, response, "pab");
      if (!account) return;
      const approvals = store.pendingApprovals(account.guildId);
      store.audit({ guildId: account.guildId, actorDiscordId: account.discordId, action: "view", entityType: "approval_queue", metadata: { count: approvals.length } });
      return jsonResponse(response, 200, { approvals });
    }
    const approvalRenewal = url.pathname.match(/^\/api\/approvals\/([^/]+)\/renew$/);
    if (approvalRenewal && request.method === "POST") {
      const existing = store.approvalById(approvalRenewal[1]);
      if (!existing) return jsonResponse(response, 404, { error: "Approval not found." });
      const account = authorized(request, response, existing.stage === "command" ? "command" : "pab");
      if (!account) return;
      const approval = store.renewApproval(existing.id, Date.now() + 24 * 60 * 60 * 1000);
      if (!approval) return jsonResponse(response, 409, { error: "Approval is no longer pending." });
      store.audit({ guildId: account.guildId, actorDiscordId: account.discordId, action: "renew", entityType: "approval", entityId: approval.id, metadata: { stage: approval.stage, expiresAt: approval.expiresAt } });
      return jsonResponse(response, 200, { approval });
    }
    const approvalDecision = url.pathname.match(/^\/api\/approvals\/([^/]+)\/decision$/);
    if (approvalDecision && request.method === "POST") {
      const existing = store.approvalById(approvalDecision[1]);
      if (!existing) return jsonResponse(response, 404, { error: "Approval not found." });
      const account = authorized(request, response, existing.stage === "command" ? "command" : "pab");
      if (!account) return;
      const body = await readJson(request);
      if (!["approved", "rejected", "withdrawn"].includes(body.status)) return jsonResponse(response, 400, { error: "Decision must be approved, rejected, or withdrawn." });
      const approval = store.decideApproval(existing.id, { status: body.status, decidedBy: account.discordId, notes: body.notes || null });
      if (!approval) return jsonResponse(response, 409, { error: "Approval is no longer pending." });
      store.audit({ guildId: account.guildId, actorDiscordId: account.discordId, action: body.status, entityType: "approval", entityId: approval.id, metadata: { workflowType: approval.workflowType, stage: approval.stage } });
      return jsonResponse(response, 200, { approval });
    }
    if (url.pathname === "/api/audit") {
      const account = authorized(request, response, "command");
      if (!account) return;
      return jsonResponse(response, 200, { events: store.auditTrail(account.guildId, 200) });
    }
    if (request.method === "GET") {
      const requested = url.pathname === "/" ? "index.html" : url.pathname.replace(/^\//, "");
      const file = resolve(webRoot, normalize(requested));
      if (!file.startsWith(webRoot)) return textResponse(response, 404, "Not found");
      try { return textResponse(response, 200, await readFile(file), { "content-type": mime[extname(file)] || "application/octet-stream", "cache-control": "no-store, max-age=0" }); } catch { return textResponse(response, 404, "Not found"); }
    }
    return jsonResponse(response, 404, { error: "Not found" });
  }

  const server = createServer((request, response) => {
    route(request, response).catch(error => {
      const requestId = (typeof response.getHeader === "function" && response.getHeader("x-request-id")) || randomUUID();
      console.error(`[${requestId}] RMS request failed`, error);
      if (!response.headersSent) jsonResponse(response, 500, { error: "RMS request failed.", requestId }, { "x-request-id": requestId });
    });
  });
  return { server, store, config, handleRequest: route, start: () => server.listen(config.port, config.bind), close: () => { server.close(); store.close(); } };
}

export { configFromEnv };
