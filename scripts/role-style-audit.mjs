import "dotenv/config";
import { REST, Routes } from "discord.js";
import manifest from "./role-style-manifest.json" with { type: "json" };

const guildId = process.env.DISCORD_GUILD_ID;
const token = process.env.DISCORD_TOKEN;
if (!guildId || !token) throw new Error("DISCORD_GUILD_ID and DISCORD_TOKEN are required.");

const rest = new REST({ version: "10" }).setToken(token);
let roles;
try {
  roles = await rest.get(Routes.guildRoles(guildId));
} catch (error) {
  const code = error?.code || error?.rawError?.code;
  if (code === 10004) {
    console.error(JSON.stringify({ guildId, status: "unavailable", reason: "The configured bot token cannot see this guild. Sign in with a server-admin account or invite Ricky before retrying." }, null, 2));
    process.exitCode = 2;
  } else throw error;
}
if (!roles) process.exit();
const byName = new Map(roles.map(role => [role.name, role]));
const expected = manifest.roles;
const findings = expected.map(item => {
  const actual = byName.get(item.name);
  if (!actual) return { ...item, status: "missing" };
  const actualColor = `#${Number(actual.color || 0).toString(16).padStart(6, "0").toUpperCase()}`;
  return {
    name: item.name,
    expectedColor: item.color,
    actualColor,
    position: actual.position,
    status: actualColor === item.color ? "ok" : "color-mismatch"
  };
});
const ordered = findings.filter(item => Number.isFinite(item.position));
const orderMismatches = ordered.slice(0, -1).flatMap((item, index) => {
  const next = ordered[index + 1];
  return item.position <= next.position ? [{ above: item.name, abovePosition: item.position, below: next.name, belowPosition: next.position }] : [];
});

const summary = {
  guildId,
  source: manifest.source,
  checked: findings.length,
  missing: findings.filter(item => item.status === "missing").length,
  colorMismatches: findings.filter(item => item.status === "color-mismatch").length,
  grayRoles: findings.filter(item => item.actualColor === "#000000").length,
  orderMismatches: orderMismatches.length
};
console.log(JSON.stringify({ summary, orderMismatches, findings }, null, 2));
if (process.argv.includes("--apply")) {
  console.error("Refusing to apply role changes from the audit script. Review the diff and use a separately approved migration.");
  process.exitCode = 2;
}
