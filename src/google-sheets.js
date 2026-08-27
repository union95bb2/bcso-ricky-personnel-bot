import { createSign } from "node:crypto";
import { BCSO_RANK_MATRIX } from "./rank-matrix.js";

function base64Url(value) {
  return Buffer.from(value).toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function serviceAccount(value) {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value);
    if (!parsed.client_email || !parsed.private_key) throw new Error("service account JSON must include client_email and private_key");
    return parsed;
  } catch (error) {
    throw new Error(`GOOGLE_SHEETS_SERVICE_ACCOUNT_JSON is invalid: ${error instanceof Error ? error.message : "invalid JSON"}`);
  }
}

export class GoogleRosterSheet {
  #spreadsheetId;
  #range;
  #account;
  #enabled;
  #fetch;
  #token = null;

  constructor({ enabled = true, spreadsheetId, range = "Roster!A:Z", serviceAccountJson, fetchImpl = globalThis.fetch } = {}) {
    this.#enabled = Boolean(enabled);
    this.#spreadsheetId = spreadsheetId || "";
    this.#range = range;
    // A staged integration must not validate or touch credentials until an
    // administrator explicitly enables it. This keeps dormant configuration
    // from blocking startup and prevents accidental API use.
    this.#account = this.#enabled ? serviceAccount(serviceAccountJson) : null;
    this.#fetch = fetchImpl;
  }

  get configured() {
    return this.#enabled && Boolean(this.#spreadsheetId && this.#account);
  }

  status() {
    return {
      configured: this.configured,
      enabled: this.#enabled,
      spreadsheetId: this.#spreadsheetId,
      range: this.#range,
      serviceAccount: this.#account?.client_email || null
    };
  }

  async #accessToken() {
    if (this.#token && this.#token.expiresAt > Date.now() + 60_000) return this.#token.value;
    const now = Math.floor(Date.now() / 1000);
    const header = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
    const claim = base64Url(JSON.stringify({
      iss: this.#account.client_email,
      scope: "https://www.googleapis.com/auth/spreadsheets.readonly",
      aud: "https://oauth2.googleapis.com/token",
      iat: now,
      exp: now + 3600
    }));
    const signer = createSign("RSA-SHA256");
    signer.update(`${header}.${claim}`);
    const assertion = `${header}.${claim}.${signer.sign(this.#account.private_key, "base64url")}`;
    const response = await this.#fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion })
    });
    if (!response.ok) throw new Error(`Google OAuth token request failed (${response.status}).`);
    const payload = await response.json();
    if (!payload.access_token) throw new Error("Google OAuth token response did not include an access token.");
    this.#token = { value: payload.access_token, expiresAt: Date.now() + Number(payload.expires_in || 3600) * 1000 };
    return this.#token.value;
  }

  async rows() {
    if (!this.configured) throw new Error("Google Sheets is not configured. Set GOOGLE_SHEETS_SPREADSHEET_ID and GOOGLE_SHEETS_SERVICE_ACCOUNT_JSON.");
    const token = await this.#accessToken();
    const endpoint = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(this.#spreadsheetId)}/values/${encodeURIComponent(this.#range)}`;
    const response = await this.#fetch(endpoint, { headers: { authorization: `Bearer ${token}` } });
    if (!response.ok) throw new Error(`Google Sheets read failed (${response.status}). Share the sheet with the service-account email and verify the spreadsheet ID/range.`);
    const payload = await response.json();
    const values = Array.isArray(payload.values) ? payload.values : [];
    if (!values.length) return [];
    const headers = values[0].map(value => String(value || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "_"));
    return values.slice(1)
      .filter(row => row.some(value => String(value ?? "").trim()))
      .map(row => Object.fromEntries(headers.map((header, index) => [header, String(row[index] ?? "").trim()])));
  }
}

export function compareRosterRows(rows, members, rankRoleIds = {}) {
  const byId = new Map(members.map(member => [member.id, member]));
  const rankOrder = new Map(BCSO_RANK_MATRIX.map(({ key }, index) => [key, index]));
  const rankEntries = Object.entries(rankRoleIds).sort(([left], [right]) => (rankOrder.get(left) ?? -1) - (rankOrder.get(right) ?? -1));
  const rankByRole = new Map(rankEntries.map(([rank, id]) => [id, rank]));
  const seen = new Set();
  const missingDiscord = [];
  const mismatches = [];
  for (const row of rows) {
    const discordId = row.discord_id || row.user_id || row.member_id;
    if (!discordId) continue;
    seen.add(discordId);
    const member = byId.get(discordId);
    if (!member) {
      missingDiscord.push({ discordId, callsign: row.callsign || row.badge_number || "", displayName: row.display_name || row.name || "" });
      continue;
    }
    const expectedRank = row.rank || row.current_rank || row.role || "";
    const actualRank = [...member.roles.cache.values()]
      .map(role => rankByRole.get(role.id))
      .filter(Boolean)
      .sort((left, right) => (rankOrder.get(left) ?? -1) - (rankOrder.get(right) ?? -1))
      .at(-1) || "";
    if (expectedRank && expectedRank !== actualRank) mismatches.push({ discordId, displayName: member.displayName, expected: expectedRank, actual: actualRank || "none" });
  }
  const sheetOnlyIds = [...byId.keys()].filter(id => !seen.has(id) && !members.find(member => member.id === id)?.user.bot);
  return { totalRows: rows.length, missingDiscord, mismatches, sheetOnlyIds };
}
