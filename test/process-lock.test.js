import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { acquireProcessLock } from "../src/process-lock.js";

test("process lock rejects a second live instance and releases cleanly", () => {
  const directory = mkdtempSync(join(tmpdir(), "ricky-lock-"));
  const lockPath = join(directory, "ricky.lock");
  try {
    const release = acquireProcessLock(lockPath);
    assert.throws(() => acquireProcessLock(lockPath), /another Ricky process is already using/);
    release();
    const releaseAgain = acquireProcessLock(lockPath);
    releaseAgain();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
