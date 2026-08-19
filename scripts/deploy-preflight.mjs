import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import dotenv from "dotenv";

const envPath = resolve(process.env.DEPLOY_ENV_FILE || ".env");
if (!existsSync(envPath)) {
  console.error(`Deployment preflight failed: ${envPath} does not exist.`);
  process.exit(1);
}

const env = dotenv.parse(readFileSync(envPath, "utf8"));
// A protected credentials file may be paired with a separate, non-secret
// candidate configuration file during sandbox validation. Empty overlay
// values never replace a credential from the base file.
if (process.env.DEPLOY_CONFIG_ENV_FILE) {
  const configPath = resolve(process.env.DEPLOY_CONFIG_ENV_FILE);
  if (!existsSync(configPath)) {
    console.error(`Deployment preflight failed: ${configPath} does not exist.`);
    process.exit(1);
  }
  for (const [key, value] of Object.entries(dotenv.parse(readFileSync(configPath, "utf8")))) {
    if (value.trim()) env[key] = value;
  }
}
const issues = [];
try {
  if ((statSync(envPath).mode & 0o077) !== 0) issues.push(`${envPath} is readable by group/other users; chmod 600 is required`);
} catch {
  issues.push(`${envPath} could not be inspected for permissions`);
}
const required = [
  "DISCORD_TOKEN", "DISCORD_CLIENT_ID", "DISCORD_GUILD_ID", "PAB_ROLE_ID", "COMMAND_ROLE_ID",
  "TRAINING_RECORDS_CHANNEL_ID", "PERSONNEL_RECORDS_CHANNEL_ID", "PROMOTIONS_ANNOUNCEMENTS_CHANNEL_ID",
  "AUDIT_LOG_CHANNEL_ID", "PAB_APPROVALS_CHANNEL_ID", "QUALIFICATIONS_RECORDS_CHANNEL_ID",
  "PAB_ANNOUNCEMENTS_CHANNEL_ID", "INACTIVITY_REVIEW_CHANNEL_ID", "ACTIVITY_CHANNEL_IDS",
  "RANK_ROLE_IDS", "AWARDABLE_ROLE_IDS"
];
for (const key of required) if (!env[key]?.trim()) issues.push(`${key} is missing`);

const id = (key) => {
  if (env[key] && !/^\d{17,20}$/.test(env[key].trim())) issues.push(`${key} is not a valid Discord ID`);
};
for (const key of required.filter(key => key.endsWith("_ID") && key !== "ACTIVITY_CHANNEL_IDS")) id(key);
for (const key of ["ACTIVITY_CHANNEL_IDS", "AWARDABLE_ROLE_IDS"]) {
  if (!env[key]?.trim()) continue;
  for (const value of env[key].split(",").map(item => item.trim()).filter(Boolean)) {
    if (!/^\d{17,20}$/.test(value)) issues.push(`${key} contains an invalid Discord ID`);
  }
}
if (env.RANK_ROLE_IDS?.trim()) {
  try {
    const ranks = JSON.parse(env.RANK_ROLE_IDS);
    if (!ranks || Array.isArray(ranks) || typeof ranks !== "object" || !Object.keys(ranks).length) throw new Error();
    for (const [rank, value] of Object.entries(ranks)) if (!/^\d{17,20}$/.test(String(value))) issues.push(`RANK_ROLE_IDS.${rank} is not a valid Discord role ID`);
  } catch {
    issues.push("RANK_ROLE_IDS must be a non-empty JSON object of rank names to Discord role IDs");
  }
}

const running = spawnSync("docker", ["ps", "--filter", "name=^/bcso-personnel-bot$", "--format", "{{.Names}}\t{{.Status}}"], { encoding: "utf8" });
if (running.status === 0) {
  const containers = running.stdout.trim().split("\n").filter(Boolean);
  if (containers.length > 1) issues.push(`more than one bcso-personnel-bot container is running on this host (${containers.length})`);
  if (containers.length === 1 && process.env.ALLOW_RUNNING_CONTAINER !== "true") issues.push(`bcso-personnel-bot is already running on this host (${containers[0]}); stop it before cutover`);
} else if (process.env.REQUIRE_DOCKER_CHECK === "true") {
  issues.push("Docker could not be inspected while REQUIRE_DOCKER_CHECK=true");
}

if (process.env.DEPLOY_EXPECT_REMOTE_CHECK === "true" && !process.env.DEPLOY_SSH_HOST) {
  issues.push("DEPLOY_EXPECT_REMOTE_CHECK=true but DEPLOY_SSH_HOST is not set");
}
if (process.env.DEPLOY_SSH_HOST) {
  const remoteDirectory = process.env.DEPLOY_SSH_DIR || ".";
  const shellQuote = (value) => `'${String(value).replaceAll("'", "'\\''")}'`;
  const remote = spawnSync("ssh", [process.env.DEPLOY_SSH_HOST, "--", `cd ${shellQuote(remoteDirectory)} && docker ps --filter name=bcso-personnel-bot --format '{{.Names}}\\t{{.Status}}'`], { encoding: "utf8" });
  if (remote.status !== 0) issues.push(`remote instance check failed for ${process.env.DEPLOY_SSH_HOST}`);
  else {
    const containers = remote.stdout.trim().split("\n").filter(Boolean);
    if (containers.length > 1) issues.push(`more than one bcso-personnel-bot container is running on ${process.env.DEPLOY_SSH_HOST} (${containers.length})`);
    if (containers.length === 1 && process.env.ALLOW_RUNNING_CONTAINER !== "true") issues.push(`bcso-personnel-bot is already running on ${process.env.DEPLOY_SSH_HOST} (${containers[0]}); stop it before cutover`);
  }
}

if (issues.length) {
  console.error("BCSO Personnel Bot deployment preflight failed:");
  for (const issue of issues) console.error(`- ${issue}`);
  console.error("No deployment should proceed until every item is resolved.");
  process.exit(1);
}

console.log("BCSO Personnel Bot deployment preflight passed.");
console.log("Next: start exactly one instance, run /setup-status and /pab-health, then execute the sandbox command matrix before live cutover.");
