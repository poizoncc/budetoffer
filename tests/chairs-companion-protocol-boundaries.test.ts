import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createCheckpointStore } from '../apps/chrome-companion/background/checkpoint-store.ts';
import { createCompanionTransport } from '../apps/chrome-companion/background/transport.ts';
import { isCheckpointValue, isCompanionJob } from '../apps/chrome-companion/shared/companion-protocol.ts';
import type { StorageArea } from '../apps/chrome-companion/shared/companion-protocol.ts';

const identity = { jobId: 'synthetic-job', leaseToken: 'l'.repeat(43), payloadHash: 'a'.repeat(64), hhAccountKey: 'hh-applicant-101' };
const job = { ...identity, protocolVersion: 1, kind: 'read_profile', expiresAt: new Date(Date.now() + 60_000).toISOString(), payload: { kind: 'read_profile', includeResumeIds: ['synthetic-resume'], includeProfileText: false } };

function backing(initial: unknown): StorageArea {
  const values: Record<string, unknown> = { 'chairs-companion-checkpoint-v1': initial };
  return { get: async key => ({ [key]: values[key] }), set: async value => { Object.assign(values, value); }, remove: async keys => { for (const key of typeof keys === 'string' ? [keys] : keys) delete values[key]; } };
}

test('malformed leased JSON is rejected before it can become worker authority', async () => {
  for (const value of [null, [], { ...job, payload: { kind: 'apply_vacancy' } }, { ...job, origin: 123 }, { ...job, deviceId: {} }, { ...job, reconcileOriginal: { phase: 'authorized' } }]) {
    const transport = createCompanionTransport({ origin: 'http://127.0.0.1:6970', token: async () => 'synthetic-access-token', fetchImpl: async () => Response.json({ job: value }) });
    if (value === null) assert.equal(await transport.lease(), null);
    else await assert.rejects(transport.lease(), /invalid_companion_job/);
  }
  assert.equal(isCompanionJob(job), true);
});

test('old accountless outboxes stay readable without claiming account ownership', async () => {
  const checkpoint = { jobId: identity.jobId, leaseToken: identity.leaseToken, payloadHash: identity.payloadHash, phase: 'authorized' };
  const restored = await createCheckpointStore(backing(checkpoint)).load();
  assert.equal(restored?.hhAccountKey, undefined);
  assert.equal(restored?.phase, 'authorized');
  assert.equal(isCheckpointValue({ ...checkpoint, hhAccountKey: 101 }), false);
});

test('corrupt receipt and recursive recovery chains are retained for user recovery and never replayed', async () => {
  const checkpoint = { ...identity, phase: 'reconciling' };
  const corrupt = { ...checkpoint, receipt: { receiptId: 'synthetic-receipt', outcome: 'confirmed', result: { kind: 'read_profile', resumes: [{ resumeId: 'synthetic', internalId: 42 }] } } };
  await assert.rejects(createCheckpointStore(backing(corrupt)).load(), /invalid_checkpoint_requires_user/);
  const recursive = { ...checkpoint, reconcileOriginal: { ...checkpoint, reconcileOriginal: checkpoint } };
  await assert.rejects(createCheckpointStore(backing(recursive)).load(), /invalid_checkpoint_requires_user/);
});

test('valid durable read receipts survive a worker restart unchanged', async () => {
  const receipt = { ...identity, receiptId: 'synthetic-receipt', outcome: 'confirmed', evidence: { hhAccountKey: identity.hhAccountKey, observedAt: new Date().toISOString() }, result: { kind: 'read_profile', resumes: [{ resumeId: 'synthetic-resume', internalId: '42' }] } };
  const checkpoint = { ...identity, phase: 'receipted', receipt };
  assert.deepEqual(await createCheckpointStore(backing(checkpoint)).load(), checkpoint);
});
