import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readRuntimeOverrides, writeRuntimeOverrides } from "../src/runtime-config.js";

test("runtime channel overrides persist as a private JSON file", async () => {
  const directory = await mkdtemp(join(tmpdir(), "ricky-runtime-"));
  const path = join(directory, "runtime-config.json");
  const overrides = {
    auditLogChannelId: "123456789012345678",
    activityChannelIds: ["234567890123456789"]
  };
  writeRuntimeOverrides(path, overrides);
  assert.deepEqual(readRuntimeOverrides(path), overrides);
  assert.match(await readFile(path, "utf8"), /auditLogChannelId/);
});
