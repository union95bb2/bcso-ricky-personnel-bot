import dotenv from "dotenv";

// Use the protected token/client credentials, but validate the complete
// public demo-guild configuration. Never print either credential.
dotenv.config({ path: ".env" });
const token = process.env.DISCORD_TOKEN;
const clientId = process.env.DISCORD_CLIENT_ID;
if (!token || !clientId) throw new Error("The protected .env must contain DISCORD_TOKEN and DISCORD_CLIENT_ID before running the demo preflight.");

dotenv.config({ path: ".env.demo.example", override: true });
process.env.DISCORD_TOKEN = token;
process.env.DISCORD_CLIENT_ID = clientId;

await import("../src/preflight.js");
