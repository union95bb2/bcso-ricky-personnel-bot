import dotenv from "dotenv";

dotenv.config({ path: ".env" });
const token = process.env.DISCORD_TOKEN;
if (!token) throw new Error("The protected .env must contain DISCORD_TOKEN before running the demo role audit.");
dotenv.config({ path: ".env.demo.example", override: true });
process.env.DISCORD_TOKEN = token;
await import("./role-style-audit.mjs");
