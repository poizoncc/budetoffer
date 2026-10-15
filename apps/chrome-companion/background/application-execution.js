import { createChromeExecution } from './execution.js';
import { createApplicationMutation } from './mutation.js';
import { readResponseResumeEvidence, openResponseUi, responseFormOperation } from '../hh/response-form.js';
import { requireRunnableTab } from './tab-state.js';

const hash = async text => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))].map(byte => byte.toString(16).padStart(2, '0')).join('');
const cleanText = value => String(value || '').normalize('NFKC').replace(/@charset\s+["'][^"']+["'];?/giu, ' ').replace(/\.tmpl_hh[\w-]*(?:\s+[^{]{0,180})?\s*\{[^{}]*\}/giu, ' ').replace(/\s+/gu, ' ').trim();

/** Opt-in adapter. Bootstrap does not enable it automatically. All HH tabs belong
 * to this invocation; existing user tabs are only read by the identity helper.
 */
export function createApplicationExecution(chromeApi, { readExecutor = createChromeExecution(chromeApi, null, null).execute } = {}) {
  let owned, proof, boundJob, documentId;
  const alive = job => { if (Date.parse(job.expiresAt) <= Date.now()) throw new Error('lease_expired'); };
  const request = job => ({ hhAccountKey: job.hhAccountKey, vacancyId: job.payload.vacancyId, resumeId: job.payload.resumeId });
  async function inject(job, func, args) {
    alive(job);
    if (!owned || requireRunnableTab(await chromeApi.tabs.get(owned.id)).url !== owned.url) throw new Error('unexpected_hh_navigation');
    const results = await chromeApi.scripting.executeScript({ target: { tabId: owned.id, ...(documentId ? { documentIds: [documentId] } : { frameIds: [0] }) }, world: 'ISOLATED', func, args });
    if (results.length !== 1 || results[0].frameId !== 0 || results[0].error || !results[0].documentId) throw new Error('response_preflight_unverified');
    documentId ??= results[0].documentId;
    if (results[0].documentId !== documentId || requireRunnableTab(await chromeApi.tabs.get(owned.id)).url !== owned.url) throw new Error('unexpected_hh_navigation');
    return results[0].result;
  }
  async function read(job, payload) {
    alive(job);
    return readExecutor({ ...job, kind: payload.kind, payload });
  }
  async function history(job) {
    return read(job, { kind: 'reconcile_history', originalJobId: job.jobId, applicationId: job.payload.applicationId, vacancyId: job.payload.vacancyId, resumeId: job.payload.resumeId });
  }
  async function inspect(job) {
    const current = await inject(job, readResponseResumeEvidence, [request(job)]);
    if (!current.ownershipVerified || !current.selectionVerified || !current.responseAllowed || current.resumeInternalId !== proof.resumeInternalId) throw new Error('response_preflight_unverified');
    const form = await inject(job, responseFormOperation, [{ ...request(job), operation: 'inspect' }]);
    if (form.formVersion !== 'hh-popup-portal-radio-v1') throw new Error('unsupported_response_form');
    return { ...current, formVersion: form.formVersion };
  }
  const adapter = {
    async preflight(job) {
      if (job.kind !== 'apply_vacancy' || job.payload?.kind !== job.kind || Object.keys(job.payload.answers ?? {}).length) throw new Error('unsupported_response_questions');
      if (boundJob && boundJob !== job.jobId) throw new Error('executor_busy');
      if (proof) { const current = await inspect(job); if (await hash(JSON.stringify(current)) !== proof.formFingerprint) throw new Error('mutation_context_changed'); return { ...proof }; }
      boundJob = job.jobId;
      const profile = await read(job, { kind: 'read_profile', includeResumeIds: [job.payload.resumeId], includeProfileText: false });
      if (profile.outcome !== 'confirmed' || profile.result?.resumes?.length !== 1 || profile.result.resumes[0].resumeId !== job.payload.resumeId) throw new Error('resume_ownership_unverified');
      const vacancy = await read(job, { kind: 'verify_vacancy', applicationId: job.payload.applicationId, vacancyId: job.payload.vacancyId, expectedVersion: job.payload.expectedVersion });
      if (vacancy.outcome !== 'confirmed' || vacancy.result?.vacancyId !== job.payload.vacancyId || !vacancy.result.text) throw new Error('vacancy_text_unavailable');
      const before = await history(job);
      if (before.outcome === 'already_exists') throw new Error('already_applied');
      // This reason is produced only after a complete exact-owner three-list scan.
      if (before.outcome !== 'needs_user' || before.evidence?.reasonCode !== 'history_not_confirmed') throw new Error('history_identity_unverified');
      const url = `https://hh.ru/applicant/vacancy_response?vacancyId=${job.payload.vacancyId}`;
      const tab = await chromeApi.tabs.create({ url, active: false });
      if (!Number.isInteger(tab.id)) throw new Error('response_preflight_unverified');
      owned = { id: tab.id, url };
      await chromeApi.tabs.update?.(tab.id, { autoDiscardable: false });
      const deadline = Math.min(Date.now() + 20000, Date.parse(job.expiresAt));
      while (requireRunnableTab(await chromeApi.tabs.get(tab.id)).status !== 'complete') { if (Date.now() >= deadline) throw new Error('hh_page_timeout'); await new Promise(resolve => setTimeout(resolve, 100)); }
      proof = { resumeInternalId: profile.result.resumes[0].internalId };
      const initial = await inject(job, readResponseResumeEvidence, [request(job)]);
      if (!initial.responseAllowed || initial.resumeInternalId !== proof.resumeInternalId) throw new Error('response_preflight_unverified');
      // Reveal the letter first: a click outside a portal may otherwise dismiss it.
      await inject(job, openResponseUi, [{ ...request(job), operation: 'open-letter' }]);
      await inject(job, openResponseUi, [{ ...request(job), operation: 'open-picker' }]);
      // React updates may be asynchronous; poll only reads, never repeat UI clicks.
      let selected;
      for (let i = 0; i < 20; i++) {
        selected = await inject(job, readResponseResumeEvidence, [request(job)]);
        if (selected.selectionVerified) break;
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      if (!selected?.selectionVerified) throw new Error('resume_selection_unverified');
      let current;
      for (let i = 0; i < 20; i++) {
        try { current = await inspect(job); break; } catch (error) { if (error.message !== 'unsupported_response_form' || i === 19) throw error; await new Promise(resolve => setTimeout(resolve, 50)); }
      }
      proof = { ...current, supported: true, formFingerprint: await hash(JSON.stringify(current)), vacancyTextHash: await hash(cleanText(vacancy.result.text)) };
      return { ...proof };
    },
    async submit(job, permit, expected) {
      if (!proof || expected.formFingerprint !== proof.formFingerprint || boundJob !== job.jobId) throw new Error('mutation_context_changed');
      await adapter.preflight(job);
      return inject(job, responseFormOperation, [{ ...request(job), operation: 'submit', jobId: job.jobId, payloadHash: job.payloadHash, coverLetter: job.payload.coverLetter, permit }]);
    },
    async readConfirmation(job, expected) {
      const receipt = await history(job), result = receipt.result;
      if (receipt.outcome !== 'already_exists' || result?.kind !== 'reconcile_history' || result.originalJobId !== job.jobId || result.resumeInternalId !== expected.resumeInternalId || !result.complete || receipt.evidence?.hhAccountKey !== job.hhAccountKey) throw new Error('submission_unconfirmed');
      return { ...result, hhAccountKey: job.hhAccountKey };
    },
    async close() {
      if (owned) { const tab = await chromeApi.tabs.get(owned.id).catch(() => null); if (tab?.url === owned.url) await chromeApi.tabs.remove(owned.id).catch(() => {}); }
      owned = proof = boundJob = documentId = undefined;
    }
  };
  return adapter;
}

export function createPackagedApplicationExecutor(chromeApi, transport, checkpoints) {
  return async job => {
    const adapter = createApplicationExecution(chromeApi);
    const run = createApplicationMutation({ transport, checkpoints, inspect: adapter.preflight, submit: adapter.submit, reconcile: adapter.readConfirmation,
      confirmReceipt: async (current, permit, observed) => {
        const { hhAccountKey, ...result } = observed;
        return { receiptId: crypto.randomUUID(), jobId: current.jobId, leaseToken: current.leaseToken, payloadHash: current.payloadHash, permitId: permit.permitId, outcome: 'confirmed', result,
          evidence: { hhAccountKey, vacancyId: current.payload.vacancyId, resumeId: current.payload.resumeId, observedAt: new Date().toISOString() } };
      } });
    try { return await run(job); } finally { await adapter.close(); }
  };
}
