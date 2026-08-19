import { createHash, randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { RmsStore } from "./store.js";

const root = resolve(fileURLToPath(new URL("../../", import.meta.url)));
const webRoot = join(root, "web", "rms");
const mime = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".png": "image/png", ".svg": "image/svg+xml" };

function csvSet(value) { return new Set(String(value || "").split(",").map(item => item.trim()).filter(Boolean)); }
function hash(value) { return createHash("sha256").update(value).digest("hex"); }
function token() { return randomBytes(32).toString("base64url"); }
function cookies(request) { return Object.fromEntries((request.headers.cookie || "").split(";").map(part => part.trim().split("=")).filter(pair => pair.length === 2).map(([key, ...rest]) => [key, decodeURIComponent(rest.join("="))])); }
function jsonResponse(response, status, payload, headers = {}) {
  const body = JSON.stringify(payload);
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers });
  response.end(body);
}
function textResponse(response, status, body, headers = {}) { response.writeHead(status, headers); response.end(body); }
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

  function authorized(request, response, required = "member") {
    const account = accountFor(request);
    if (!account) { jsonResponse(response, 401, { error: "Sign in with Discord to use the RMS." }); return null; }
    if (!levelAtLeast(account.accessLevel, required)) { jsonResponse(response, 403, { error: "Your RMS account does not have access to this area." }); return null; }
    return account;
  }

  async function route(request, response) {
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
    if (url.pathname === "/api/health") return jsonResponse(response, 200, { ok: true, service: "Ricky RMS", time: new Date().toISOString() });
    if (url.pathname === "/api/me") {
      const account = authorized(request, response);
      if (!account) return;
      store.audit({ guildId: account.guildId, actorDiscordId: account.discordId, action: "view", entityType: "account", entityId: account.id });
      const member = store.memberByDiscordId(account.guildId, account.discordId);
      return jsonResponse(response, 200, { account, member });
    }
    if (url.pathname === "/api/members") {
      const account = authorized(request, response, "pab");
      if (!account) return;
      const members = store.searchMembers(account.guildId, url.searchParams.get("q") || "", Math.min(Number(url.searchParams.get("limit") || 50), 100));
      store.audit({ guildId: account.guildId, actorDiscordId: account.discordId, action: "search", entityType: "member", metadata: { query: url.searchParams.get("q") || "", count: members.length } });
      return jsonResponse(response, 200, { members });
    }
    const memberMatch = url.pathname.match(/^\/api\/members\/([^/]+)$/);
    if (memberMatch) {
      const account = authorized(request, response);
      if (!account) return;
      const member = store.memberById(memberMatch[1]);
      if (!member || member.guildId !== account.guildId) return jsonResponse(response, 404, { error: "Member not found." });
      if (account.accessLevel === "member" && member.discordId !== account.discordId) return jsonResponse(response, 403, { error: "Members may only view their own RMS profile." });
      const timeline = store.memberTimeline(account.guildId, member.id);
      store.audit({ guildId: account.guildId, actorDiscordId: account.discordId, action: "view", entityType: "member", entityId: member.id });
      return jsonResponse(response, 200, { member, timeline });
    }
    if (url.pathname === "/api/approvals") {
      const account = authorized(request, response, "pab");
      if (!account) return;
      const approvals = store.pendingApprovals(account.guildId);
      store.audit({ guildId: account.guildId, actorDiscordId: account.discordId, action: "view", entityType: "approval_queue", metadata: { count: approvals.length } });
      return jsonResponse(response, 200, { approvals });
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
      try { return textResponse(response, 200, await readFile(file), { "content-type": mime[extname(file)] || "application/octet-stream", "cache-control": "no-cache" }); } catch { return textResponse(response, 404, "Not found"); }
    }
    return jsonResponse(response, 404, { error: "Not found" });
  }

  const server = createServer((request, response) => { route(request, response).catch(error => { console.error("RMS request failed", error); if (!response.headersSent) jsonResponse(response, 500, { error: "RMS request failed." }); }); });
  return { server, store, config, handleRequest: route, start: () => server.listen(config.port, config.bind), close: () => { server.close(); store.close(); } };
}

export { configFromEnv };
