import "dotenv/config";
import { createRmsServer, configFromEnv } from "../src/rms/server.js";

const config = configFromEnv();
const missing = [["guildId", "RMS_GUILD_ID or DISCORD_GUILD_ID"], ["clientId", "RMS_DISCORD_CLIENT_ID or DISCORD_CLIENT_ID"], ["clientSecret", "RMS_DISCORD_CLIENT_SECRET"], ["botToken", "RMS_DISCORD_BOT_TOKEN or DISCORD_TOKEN"], ["redirectUri", "RMS_DISCORD_REDIRECT_URI"], ["sessionSecret", "RMS_SESSION_SECRET"]].filter(([key]) => !config[key]).map(([, label]) => label);
if (missing.length) {
  console.error(`Ricky RMS startup blocked; set: ${missing.join(", ")}`);
  process.exit(1);
}
const app = createRmsServer({ config });
app.start();
console.log(`Ricky RMS listening on ${config.bind}:${config.port}; data store: ${config.dataPath}`);
const close = () => { app.close(); process.exit(0); };
process.on("SIGINT", close);
process.on("SIGTERM", close);
