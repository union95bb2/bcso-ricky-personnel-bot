import { closeSync, existsSync, openSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";

/**
 * Prevents two Ricky processes on the same host/data volume from sharing a
 * token and publishing duplicate records. Cross-host duplicates are covered
 * by the deployment preflight and cutover checklist.
 */
export function acquireProcessLock(lockPath) {
  const writeLock = () => {
    const descriptor = openSync(lockPath, "wx", 0o600);
    try {
      writeFileSync(descriptor, `${process.pid}\n`, "utf8");
    } finally {
      closeSync(descriptor);
    }
  };

  try {
    writeLock();
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
    const existingPid = Number.parseInt(readFileSync(lockPath, "utf8").trim(), 10);
    let alive = false;
    if (Number.isInteger(existingPid) && existingPid > 0) {
      try {
        process.kill(existingPid, 0);
        alive = true;
      } catch (probeError) {
        alive = probeError?.code !== "ESRCH";
      }
    }
    if (alive) throw new Error(`another Ricky process is already using ${lockPath} (pid ${existingPid})`);
    unlinkSync(lockPath);
    writeLock();
  }

  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (!existsSync(lockPath)) return;
    try {
      const ownerPid = Number.parseInt(readFileSync(lockPath, "utf8").trim(), 10);
      if (ownerPid === process.pid) unlinkSync(lockPath);
    } catch {
      // Shutdown must remain best-effort; the next start will recover a stale lock.
    }
  };
}
