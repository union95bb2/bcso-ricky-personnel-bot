import dotenv from "dotenv";

// Keep credentials in the protected .env, but overlay the public demo guild
// configuration. dotenv parses the JSON rank map without shell-quoting loss.
dotenv.config({ path: ".env" });
const token = process.env.DISCORD_TOKEN;
const clientId = process.env.DISCORD_CLIENT_ID;
if (!token || !clientId) throw new Error("The protected .env must contain DISCORD_TOKEN and DISCORD_CLIENT_ID before starting the demo.");

dotenv.config({ path: ".env.demo.example", override: true });
process.env.DISCORD_TOKEN = token;
process.env.DISCORD_CLIENT_ID = clientId;

await import("../src/index.js");
