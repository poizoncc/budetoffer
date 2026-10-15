const KEY = "chairs-companion-checkpoint-v1";
const PHASES = new Set(["leased", "authorized", "reconciling", "receipted"]);

export function createCheckpointStore(storage) {
  return {
    async load() {
      const value = (await storage.get(KEY))[KEY];
      if (!value) return null;
      if (!PHASES.has(value.phase) || typeof value.jobId !== "string" || typeof value.leaseToken !== "string" || typeof value.payloadHash !== "string") throw new Error("invalid_checkpoint_requires_user");
      return value;
    },
    async save(value) {
      if (!PHASES.has(value.phase)) throw new Error("invalid_checkpoint_phase");
      // No CV, answers or letter: payload must be fetched again after a restart.
      const checkpoint = { jobId: value.jobId, phase: value.phase, leaseToken: value.leaseToken, payloadHash: value.payloadHash, hhAccountKey: value.hhAccountKey, permitId: value.permitId, receipt: value.receipt, deviceId: value.deviceId, origin: value.origin };
      if (value.reconcileOriginal) {
        const original = value.reconcileOriginal;
        if (!['authorized', 'reconciling'].includes(original.phase) || typeof original.jobId !== 'string' || original.jobId === value.jobId || original.reconcileOriginal) throw new Error('invalid_reconciliation_checkpoint');
        checkpoint.reconcileOriginal = { jobId: original.jobId, phase: 'reconciling', leaseToken: original.leaseToken, payloadHash: original.payloadHash, hhAccountKey: original.hhAccountKey, permitId: original.permitId, deviceId: original.deviceId, origin: original.origin };
      }
      await storage.set({ [KEY]: checkpoint });
    },
    async clear() { await storage.remove(KEY); }
  };
}
