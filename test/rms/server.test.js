import test from "node:test";
import assert from "node:assert/strict";
import { createRmsServer } from "../../src/rms/server.js";
import { RmsStore } from "../../src/rms/store.js";

function responseMock() {
  return { status: null, headers: null, body: "", writeHead(status, headers) { this.status = status; this.headers = headers; }, end(body = "") { this.body += body; } };
}

test("RMS health endpoint is available without an account and static dashboard is served", async () => {
  const app = createRmsServer({
    config: { guildId: "g", clientId: "c", clientSecret: "s", botToken: "b", redirectUri: "http://localhost/auth/callback", sessionSecret: "secret", port: 0, bind: "127.0.0.1", dataPath: ":memory:", pabRoleId: "", commandRoleId: "", adminRoleIds: new Set() },
    store: new RmsStore(":memory:"),
    fetchImpl: async () => { throw new Error("network should not be called"); }
  });
  const health = responseMock();
  await app.handleRequest({ url: "/api/health", headers: {}, method: "GET" }, health);
  assert.equal(health.status, 200);
  assert.equal(JSON.parse(health.body).ok, true);
  const page = responseMock();
  await app.handleRequest({ url: "/", headers: {}, method: "GET" }, page);
  assert.equal(page.status, 200);
  assert.match(String(page.body), /Ricky RMS/);
  app.store.close();
});
