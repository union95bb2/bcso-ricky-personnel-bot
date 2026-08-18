/** Durable, single-use approvals. Expired previews are purged on access/startup. */
export class PendingActions {
  #store;

  constructor(store) {
    this.#store = store;
  }

  create(action) {
    return this.#store.createPending(action);
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
}
