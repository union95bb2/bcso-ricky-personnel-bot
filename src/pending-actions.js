/** Durable, single-use approvals. Expired previews can be renewed once by an authorized creator. */
export class PendingActions {
  #store;
  #ttlMs;

  constructor(store, { ttlMinutes = 24 * 60 } = {}) {
    this.#store = store;
    this.#ttlMs = Math.max(60, Math.min(7 * 24 * 60, Number(ttlMinutes) || 24 * 60)) * 60 * 1000;
  }

  create(action) {
    return this.#store.createPending(action, this.#ttlMs);
  }

  take(id, actorId, canApprove = () => null) {
    return this.#store.takePending(id, actorId, canApprove);
  }

  complete(id) {
    this.#store.completePending(id);
  }

  release(id) {
    this.#store.releasePending(id);
  }

  expiring(withinMinutes) {
    return this.#store.listExpiringPending(Math.max(1, Number(withinMinutes) || 5) * 60 * 1000);
  }

  markReminder(id) {
    return this.#store.markPendingReminder(id);
  }

  renew(id, actorId, canRenew = () => null) {
    return this.#store.renewPending(id, actorId, this.#ttlMs, canRenew);
  }

  advance(id, actorId, mutate = () => null) {
    return this.#store.advancePending(id, actorId, mutate);
  }

  details(id) {
    return this.#store.pendingDetails(id);
  }
}
