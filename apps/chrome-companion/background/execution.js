import { readVerifiedAccountIdentity, accountMatches } from '../hh/account.js';
import { readPageEvidence } from '../hh/actions.js';
import { readHistoryAccountIdentity } from '../hh/history-account.js';
import { readApplicationOutcomesPage } from '../hh/outcomes.js';
import { MAX_HISTORY_PAGES } from '../hh/history-limits.js';
import { readPublicationResumeArtifacts } from './publication.js';
import { executeJob, blockedReceipt } from '../hh/executor.js';
import { requireRunnableTab } from './tab-state.js';

const HH = 'https://hh.ru';
const validId = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,128}$/u.test(value);
const vacancyId = value => typeof value === 'string' && /^[1-9]\d{0,19}$/u.test(value);

// HH may redirect its canonical host to a regional host. Read-only jobs still
// target the exact same resource, and verify the account before and after it.
function sameReadTarget(actual, expected) {
  try {
    const source = new URL(actual), target = new URL(expected);
    const hh = url => url.protocol === 'https:' && /(^|\.)hh\.ru$/u.test(url.hostname)
      && !url.username && !url.password && !url.port && !url.hash;
    return hh(source) && hh(target) && source.pathname === target.pathname && source.search === target.search;
  } catch { return false; }
}

export function createChromeExecution(chromeApi, transport, checkpoints) {
  let running = false;
  async function inject(tabId, func, args = [], documentId) {
    const tab=requireRunnableTab(await chromeApi.tabs.get(tabId));
    let source;try{source=new URL(tab.url);}catch{throw new Error('unexpected_hh_navigation');}
    if(source.protocol!=='https:'||!/(^|\.)hh\.ru$/u.test(source.hostname)||source.username||source.password||source.port)throw new Error('unexpected_hh_navigation');
    const response = await chromeApi.scripting.executeScript({ target: { tabId, ...(documentId ? { documentIds: [documentId] } : { frameIds: [0] }) }, world: 'ISOLATED', func, args });
    if (!Array.isArray(response) || response.length !== 1 || response[0]?.frameId !== 0 || response[0]?.error) throw new Error('hh_read_failed');
    return { value: response[0].result, documentId: response[0].documentId };
  }
  async function loaded(tabId, expectedUrl, job) {
    const deadline = Math.min(Date.now() + 20000, job ? Date.parse(job.expiresAt) : Infinity);
    while (Date.now() < deadline) {
      if (job && Date.parse(job.expiresAt) <= Date.now()) throw new Error('lease_expired');
      const tab = requireRunnableTab(await chromeApi.tabs.get(tabId));
      if (tab.status === 'complete') {
        if (!sameReadTarget(tab.url, expectedUrl)) throw new Error('unexpected_hh_navigation');
        return;
      }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error(job && Date.parse(job.expiresAt) <= Date.now() ? 'lease_expired' : 'hh_page_timeout');
  }
  async function withOwnedTab(initialUrl, run) {
    const tab = await chromeApi.tabs.create({ url: initialUrl, active: false });
    if (!Number.isInteger(tab?.id)) throw new Error('hh_read_failed');
    let expected = initialUrl;
    try {
      // Owned background tabs remain inactive, but should not be evicted by
      // memory saver midway through a bounded job. User tabs remain untouched.
      await chromeApi.tabs.update?.(tab.id, { autoDiscardable: false });
      return await run(tab.id, async url => {
        const current = requireRunnableTab(await chromeApi.tabs.get(tab.id));
        // A user-navigated tab is no longer ours to steer or close.
        if (!sameReadTarget(current.url, expected)) throw new Error('unexpected_hh_navigation');
        expected = url; await chromeApi.tabs.update(tab.id, { url });
      });
    } finally {
      const current = await chromeApi.tabs.get(tab.id).catch(() => null);
      if (sameReadTarget(current?.url, expected)) await chromeApi.tabs.remove(tab.id).catch(() => {});
    }
  }
  async function identity() {
    if (!chromeApi.tabs?.query || !chromeApi.scripting?.executeScript) return null;
    try {
      const tabs = await chromeApi.tabs.query({ url: ['https://hh.ru/*', 'https://*.hh.ru/*'] });
      const identities = new Set();
      // Conflicting open sessions stop work; never guess which account was meant.
      if (tabs.length > 10) return null;
      for (const tab of tabs) {
        if (!Number.isInteger(tab.id) || tab.status !== 'complete') continue;
        const observed = await inject(tab.id, readVerifiedAccountIdentity).catch(() => null);
        if (typeof observed?.value === 'string' && observed.value) identities.add(observed.value);
      }
      if (identities.size > 1) return null;
      if (identities.size === 1) return [...identities][0];
      return await withOwnedTab(HH + '/', async tabId => { await loaded(tabId, HH + '/'); return (await inject(tabId, readVerifiedAccountIdentity)).value ?? null; });
    } catch { return null; }
  }
  async function readJob(job) {
    if (Date.parse(job.expiresAt) <= Date.now()) throw new Error('lease_expired');
    const p = job.payload;
    if (job.kind === 'read_application_outcomes') {
      const keys = ['applicationId', 'expectedVersion', 'vacancyId', 'resumeId', 'resumeInternalId', 'negotiationId', 'claimJobId', 'historyJobId'];
      if (Object.keys(p).sort().join() !== ['kind', 'targets', 'maxPages'].sort().join() || !Number.isInteger(p.maxPages) || p.maxPages < 1 || p.maxPages > MAX_HISTORY_PAGES || !Array.isArray(p.targets) || p.targets.length < 1 || p.targets.length > 20 || p.targets.some(t => !t || Object.keys(t).sort().join() !== [...keys].sort().join() || !['applicationId', 'resumeId', 'claimJobId', 'historyJobId'].every(k => validId(t[k])) || !['vacancyId', 'resumeInternalId', 'negotiationId'].every(k => typeof t[k] === 'string' && /^[1-9]\d{0,30}$/u.test(t[k])) || !Number.isSafeInteger(t.expectedVersion) || t.expectedVersion < 0) || new Set(p.targets.map(t => t.applicationId)).size !== p.targets.length || new Set(p.targets.map(t => t.negotiationId)).size !== p.targets.length) throw new Error('invalid_read_payload');
    }
    const searchUrl = page => {
      const url = new URL(`${HH}/search/vacancy`);
      url.searchParams.set('text', p.text);
      for (const [key, value] of p.searchParameters ?? []) url.searchParams.append(key, value);
      url.searchParams.set('page', String(page));
      return url.href;
    };
    if (job.kind === 'discover_search' && (!validId(p.savedSearchId) || typeof p.text !== 'string' || p.text.length > 1000 || !Number.isInteger(p.maxPages) || p.maxPages < 1 || p.maxPages > 20 || (p.searchParameters !== undefined && (!Array.isArray(p.searchParameters) || p.searchParameters.length > 40 || !p.searchParameters.every(pair => Array.isArray(pair) && pair.length === 2 && ['area', 'experience', 'employment', 'schedule', 'professional_role', 'salary', 'currency', 'only_with_salary', 'search_field', 'order_by', 'period', 'label'].includes(pair[0]) && typeof pair[1] === 'string' && /^[a-zA-Z0-9_-]{1,80}$/u.test(pair[1])))))) throw new Error('invalid_read_payload');
    if (job.kind === 'verify_vacancy' && (!vacancyId(p.vacancyId) || !validId(p.applicationId) || !Number.isSafeInteger(p.expectedVersion) || p.expectedVersion < 0)) throw new Error('invalid_read_payload');
    if (job.kind === 'read_profile' && (!Array.isArray(p.includeResumeIds) || p.includeResumeIds.length > 20 || !p.includeResumeIds.every(validId) || typeof p.includeProfileText !== 'boolean')) throw new Error('invalid_read_payload');
    if (job.kind === 'read_resume_artifact' && (!validId(p.resumeId) || p.resumeId.length < 4 || typeof p.internalId !== 'string' || !/^[1-9]\d{0,30}$/u.test(p.internalId))) throw new Error('invalid_read_payload');
    if (job.kind === 'reconcile_history' && (!vacancyId(p.vacancyId) || !validId(p.resumeId) || !validId(p.originalJobId) || !validId(p.applicationId))) throw new Error('invalid_read_payload');
    const initialUrl = job.kind === 'read_application_outcomes' ? `${HH}/resume/${p.targets[0].resumeId}` : job.kind === 'discover_search' ? searchUrl(0) : job.kind === 'verify_vacancy' ? `${HH}/vacancy/${p.vacancyId}` : job.kind === 'read_profile' && p.includeResumeIds.length === 0 ? HH + '/' : `${HH}/resume/${job.kind === 'read_profile' ? p.includeResumeIds[0] : p.resumeId}`;
    return withOwnedTab(initialUrl, async (tabId, navigate) => {
      let currentUrl = initialUrl;
      async function read(url, request) {
        if (Date.parse(job.expiresAt) <= Date.now()) throw new Error('lease_expired');
        if (url !== currentUrl) { await navigate(url); currentUrl = url; }
        await loaded(tabId, url, job);
        let before = await inject(tabId, readVerifiedAccountIdentity);
        if (!before.value && request?.operation === 'history') before = await inject(tabId, readHistoryAccountIdentity, [], before.documentId);
        if (!accountMatches(job.hhAccountKey, before.value)) throw new Error('account_identity_unverified');
        const reader = job.kind === 'read_application_outcomes' && request?.operation === 'history' ? readApplicationOutcomesPage : job.kind === 'read_resume_artifact' ? readPublicationResumeArtifacts : readPageEvidence;
        const result = request ? (await inject(tabId, reader, [request], before.documentId)).value : null;
        let after = await inject(tabId, readVerifiedAccountIdentity, [], before.documentId);
        if (!after.value && request?.operation === 'history') after = await inject(tabId, readHistoryAccountIdentity, [], before.documentId);
        if (!accountMatches(job.hhAccountKey, after.value)) throw new Error('account_changed');
        if (!sameReadTarget(requireRunnableTab(await chromeApi.tabs.get(tabId)).url, url)) throw new Error('unexpected_hh_navigation');
        if (Date.parse(job.expiresAt) <= Date.now()) throw new Error('lease_expired');
        return result;
      }
      if (job.kind === 'verify_vacancy') return { kind: job.kind, ...await read(initialUrl, { operation: 'vacancy', vacancyId: p.vacancyId }) };
      if (job.kind === 'read_resume_artifact') return { kind: job.kind, artifact: await read(initialUrl, { resumeId: p.resumeId, internalId: p.internalId, hhAccountKey: job.hhAccountKey }) };
      if (job.kind === 'discover_search') {
        const vacancies = [], seen = new Set();
        let pages = 0, complete = false, length = 0;
        outer: for (let page = 0; page < p.maxPages; page++) {
          const url = searchUrl(page);
          const data = await read(url, { operation: 'search', page, expectedUrl: url });
          pages++;
          const candidateIds=data.vacancies.filter(row=>vacancyId(row.vacancyId)&&!seen.has(row.vacancyId)).slice(0,20).map(row=>row.vacancyId);
          let shared=[];
          if(transport?.publicDetails&&candidateIds.length){
            try{const result=await transport.publicDetails(job,[...new Set(candidateIds)]);
              if(Array.isArray(result?.vacancies)&&result.vacancies.length<=20)shared=result.vacancies.filter(row=>row&&candidateIds.includes(row.vacancyId)&&typeof row.title==='string'&&row.title.trim()&&row.title.length<=1000
                &&(row.company===null||typeof row.company==='string'&&row.company.length<=1000)&&typeof row.text==='string'&&row.text.trim()&&row.text.length<=250000);
            }catch{/* Older server or unavailable cache: own bounded detail read. */}
          }
          for (const row of data.vacancies) {
            if (seen.has(row.vacancyId)) continue;
            if (vacancies.length >= 20 || Date.parse(job.expiresAt) - Date.now() < 25000) break outer;
            const cached=shared.find(value=>value.vacancyId===row.vacancyId);
            const detail = cached??await read(`${HH}/vacancy/${row.vacancyId}`, { operation: 'vacancy', vacancyId: row.vacancyId });
            if (length + detail.text.length > 400000) break outer;
            vacancies.push({ ...detail, company: cached?cached.company:row.company }); seen.add(row.vacancyId); length += detail.text.length;
          }
          if (!data.hasNext) { complete = true; break; }
        }
        return { kind: job.kind, savedSearchId: p.savedSearchId, pages, complete, vacancies };
      }
      if (job.kind === 'read_profile') {
        const resumes = [];
        for (const resumeId of new Set(p.includeResumeIds)) resumes.push(await read(`${HH}/resume/${resumeId}`, { operation: 'resume', resumeId }));
        if (!resumes.length) await read(HH + '/', null);
        return { kind: job.kind, resumes };
      }
      if (job.kind === 'read_application_outcomes') {
        const resumes = new Map(), observations = new Map();
        for (const target of p.targets) {
          if (!resumes.has(target.resumeId)) resumes.set(target.resumeId, (await read(`${HH}/resume/${target.resumeId}`, { operation: 'resume', resumeId: target.resumeId })).internalId);
          if (resumes.get(target.resumeId) !== target.resumeInternalId) throw new Error('resume_identity_mismatch');
        }
        let pages = 0;
        const result = complete => ({ kind: job.kind, readerVersion: 'hh-application-outcomes-v1', observedAt: new Date().toISOString(), pages, complete, observations: [...observations.values()] });
        for (const filter of ['active', 'archived', 'deleted']) {
          let expectedPages;
          for (let page = 0; ; page++) {
            if (pages >= p.maxPages) return result(false);
            const data = await read(`${HH}/applicant/negotiations?filter=${filter}&page=${page}`, { operation: 'history', filter, page, targets: p.targets, hhAccountKey: job.hhAccountKey });
            pages++; expectedPages ??= Math.max(1, data.pageCount);
            if (expectedPages !== Math.max(1, data.pageCount)) throw new Error('incomplete_history_page');
            for (const row of data.observations) {
              if (observations.has(row.negotiationId)) throw new Error('history_ambiguous');
              observations.set(row.negotiationId, row);
            }
            if (page + 1 === expectedPages && !data.hasNext) break;
            if (page + 1 >= expectedPages || !data.hasNext) throw new Error('incomplete_history_page');
          }
        }
        return result(true);
      }
      const resume = await read(initialUrl, { operation: 'resume', resumeId: p.resumeId });
      let pages = 0;
      const exact = new Map();
      const observed = new Map();
      for (const filter of ['active', 'archived', 'deleted']) {
        let expectedPages;
        for (let page = 0; ; page++) {
          if (pages >= MAX_HISTORY_PAGES) throw new Error('incomplete_history_page');
          const data = await read(`${HH}/applicant/negotiations?filter=${filter}&page=${page}`, { operation: 'history', filter, page });
          pages++;
          expectedPages ??= Math.max(1, data.pageCount);
          if (expectedPages !== Math.max(1, data.pageCount)) throw new Error('incomplete_history_page');
          for (const row of data.observations) {
            const identity = `${row.vacancyId}:${row.resumeInternalId}:${row.initiatedByApplicant}`;
            if (observed.has(row.negotiationId) && observed.get(row.negotiationId) !== identity) throw new Error('history_identity_missing');
            observed.set(row.negotiationId, identity);
            if (row.vacancyId === p.vacancyId && row.resumeInternalId === resume.internalId && row.initiatedByApplicant) exact.set(row.negotiationId, row);
          }
          if (page + 1 === expectedPages && !data.hasNext) break;
          if (page + 1 >= expectedPages || !data.hasNext) throw new Error('incomplete_history_page');
        }
      }
      if (exact.size !== 1) throw new Error(exact.size ? 'history_ambiguous' : 'history_not_confirmed');
      return { kind: job.kind, originalJobId: p.originalJobId, vacancyId: p.vacancyId, resumeId: p.resumeId, resumeInternalId: resume.internalId, negotiationId: [...exact.keys()][0], pages, complete: true };
    });
  }
  return {
    identity,
    async execute(job) {
      if (running) return blockedReceipt(job, 'executor_busy');
      running = true;
      try {
        const previous = await checkpoints?.load();
        if (previous && (previous.jobId !== job.jobId || ['authorized', 'reconciling'].includes(previous.phase))) return blockedReceipt(job, 'reconciliation_required', 'unknown');
        return await executeJob(job, { identity, readJob });
      } finally { running = false; }
    }
  };
}
