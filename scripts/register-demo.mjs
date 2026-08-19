import dotenv from "dotenv";

// Register only against the TEST ONLY guild while keeping the token and client
// ID in the protected .env. Never source .env.demo.example in a shell: its JSON
// role map is configuration data, not shell syntax.
dotenv.config({ path: ".env" });
const token = process.env.DISCORD_TOKEN;
const clientId = process.env.DISCORD_CLIENT_ID;
if (!token || !clientId) throw new Error("The protected .env must contain DISCORD_TOKEN and DISCORD_CLIENT_ID before registering the demo commands.");

dotenv.config({ path: ".env.demo.example", override: true });
process.env.DISCORD_TOKEN = token;
process.env.DISCORD_CLIENT_ID = clientId;

await import("../src/register-commands.js");
