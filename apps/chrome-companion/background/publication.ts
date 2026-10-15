// No HH publication DOM adapter is currently grounded for the extension.
// Packaging selectors from the legacy Local driver is not ownership/form proof.
import {isRecord} from '../shared/record.ts';
import type {StorageArea, ResumeArtifact} from '../shared/companion-protocol.ts';

const PUBLICATION_PHASES = ['duplicate', 'bind_copy', 'title', 'about', 'skills', 'levels', 'wizard', 'preferences', 'final_readback'] as const;
type PublicationPhase = typeof PUBLICATION_PHASES[number];
type PublicationReceipt = {receiptId: string; revision: number; phaseHash: string; outcome: 'confirmed'; proofId: string; permitId?: string};
type PublicationCheckpoint = {publicationId: string; phase: PublicationPhase; revision: number; phaseHash: string; status: 'authorized' | 'reading' | 'receipted'; permitId?: string; receipt?: PublicationReceipt};
type PublicationCheckpointStore = {load(): Promise<PublicationCheckpoint | null>; save(value: PublicationCheckpoint): Promise<void>; clear(): Promise<void>};
type PublicationState = {id: string; phase: string; revision: number; phaseHash: string; state: string; binding: {hhAccountKey: string; baseResumeId: string}; copy?: {resumeId: string; internalId: string} | null};
type PublicationPermit = {publicationId: string; phase: string; revision: number; phaseHash: string; permitId: string; expiresAt: string};
type PublicationTransport = {receipt(id: string, receipt: PublicationReceipt): Promise<unknown>; permit(id: string, revision: number, hash: string): Promise<unknown>};
type PublicationAdapter = {inspect(state: PublicationState): Promise<unknown>; proof(state: PublicationState): Promise<unknown>; perform?(state: PublicationState, permit: PublicationPermit): Promise<unknown>};
function isPhase(value: unknown): value is PublicationPhase {return PUBLICATION_PHASES.some(phase => phase === value);}
export const supportedPublicationAdapters: Readonly<Partial<Record<PublicationPhase, PublicationAdapter>>> = Object.freeze({});

// Serializable READ-ONLY function for chrome.scripting in a pinned owned tab.
// Grounded 2026-10-04: title H1, about-card single P, skills-card skill-tag-ID,
// advancedKeySkills + keySkills define the selected projection. The larger
// resumeApplicantSkills array is a catalog, not the selected skill list.
// No publication status or duplicate causality is inferred here.
export function readPublicationResumeArtifacts(request: { resumeId: string; internalId: string; hhAccountKey: string }, documentRef: Document = globalThis.document, locationHref: string = globalThis.location?.href): ResumeArtifact {
  function fail(reason: string): never { throw Error(reason); }
  function record(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === 'object' && !Array.isArray(value); }
  function id(value: unknown): value is string { return typeof value === 'string' && /^[A-Za-z0-9_-]{4,128}$/u.test(value); }
  function normalize(value: unknown): string { return String(value || '').replace(/\r\n?/gu, '\n').replace(/\s+/gu, ' ').trim(); }
  if (!record(request) || Object.keys(request).some(key => !['resumeId','internalId','hhAccountKey'].includes(key)) || !id(request.resumeId)
    || typeof request.internalId !== 'string' || !/^[1-9]\d{0,30}$/u.test(request.internalId)) fail('invalid_resume_read_target');
  const url = new URL(locationHref);
  // Match the existing HH host boundary; allow only the observed profile link query.
  if (url.protocol !== 'https:' || !/(^|\.)hh\.ru$/u.test(url.hostname) || url.port || url.username || url.password
    || (url.search && url.search !== '?hhtmFrom=applicant_profile') || url.hash || url.pathname !== `/resume/${request.resumeId}`) fail('resume_read_target_changed');
  const source = documentRef.querySelector('template#HH-Lux-InitialState')?.innerHTML;
  if (typeof source !== 'string' || !source || source.length > 5000000) fail('resume_state_unavailable');
  let state: unknown;
  try { state = JSON.parse(source); } catch { fail('resume_state_unavailable'); }
  if (!record(state)) fail('resume_ownership_unverified');
  const user = state.userId;
  const resume = state.applicantResume;
  const attrs = record(resume) ? resume._attributes : null;
  const session = state.session;
  const statuses = record(resume) && record(resume.applicantUserStatuses) ? resume.applicantUserStatuses : null;
  const status = statuses && typeof user === 'string' && Object.hasOwn(statuses, user) ? statuses[user] : null;
  if (state.userType !== 'applicant' || typeof user !== 'string' || !/^[1-9]\d{0,30}$/u.test(user)
    || !record(state.account) || !record(state.hhidAccount) || !record(session)
    || !['isFallback','securityCheckFailed','isMultiAccount','hasExtraAccounts'].every(key => session[key] === false)
    || request.hhAccountKey !== `hh-applicant-${user}` || !record(resume) || resume.forbidden !== null || !record(attrs)
    || attrs.user !== user || attrs.permission !== 'edit' || attrs.hash !== request.resumeId || attrs.id !== request.internalId
    || !record(status) || !Object.hasOwn(status, 'jobSearchStatus')) fail('resume_ownership_unverified');
  function one(selector: string): Element {
    const nodes = documentRef.querySelectorAll(selector);
    const node = nodes[0];
    if (nodes.length !== 1 || !node) fail('resume_projection_unsupported');
    return node;
  }
  const title = one('h1[data-qa="resume-block-title-position"]');
  const aboutCard = one('div[data-qa="resume-about-card"]');
  const paragraphs = aboutCard.querySelectorAll('p');
  const paragraph = paragraphs[0];
  if (paragraphs.length !== 1 || !paragraph || paragraph.querySelector('button,input,textarea,select,script,style,[hidden],[aria-hidden="true"]')) fail('resume_about_projection_incomplete');
  // cloneNode can upgrade custom elements. Read data nodes without constructing
  // another DOM tree or executing callbacks from imported resume markup.
  const pending: Node[] = [paragraph]; const parts: string[] = [];let visited=0; let length=0;
  while(pending.length){const node=pending.pop();if(!node)break;if(++visited>10000)fail('resume_text_projection_incomplete');
    if(node.nodeType===3){const value=node.nodeValue||'';length+=value.length;if(length>20000)fail('resume_text_projection_incomplete');parts.push(value);continue;}
    if(node.nodeName.toLowerCase()==='br')parts.push('\n');
    const children=node.childNodes;for(let index=children.length-1;index>=0;index--){const child=children.item(index);if(child)pending.push(child);}
  }
  const headline = normalize(title.textContent); const about = normalize(parts.join(''));
  if (!headline || headline.length > 1000 || !about || about.length > 20000 || /(?:…|\.\.\.)$/u.test(about)) fail('resume_text_projection_incomplete');
  const skillCard = one('div[data-qa="skills-card"]');
  const tags = [...skillCard.querySelectorAll('[data-qa^="skill-tag-"]')];
  const catalog = resume.resumeApplicantSkills; const selected = resume.advancedKeySkills; const selectedNames = resume.keySkills;
  if (!Array.isArray(catalog) || catalog.length > 200 || !Array.isArray(selected) || selected.length > 200 || !Array.isArray(selectedNames) || selectedNames.length > 200
    || tags.length !== selected.length || selectedNames.length !== selected.length) fail('resume_skill_projection_incomplete');
  const skillIdentity = (value: unknown): string => {
    if (typeof value !== 'string' && !(typeof value === 'number' && Number.isSafeInteger(value) && value >= 0)) return '';
    const text = String(value); return /^[A-Za-z0-9_-]{1,128}$/u.test(text) ? text : '';
  };
  const catalogById = new Map<string, { name: string; category: string }>(); const catalogNames = new Set<string>();
  for (const skill of catalog) {
    if (!record(skill)) fail('resume_skill_projection_incomplete');
    const skillId = skillIdentity(skill.id); const name = typeof skill.name === 'string' ? normalize(skill.name) : '';
    if (!skillId || !name || name.length > 200 || typeof skill.category !== 'string'
      || catalogById.has(skillId) || catalogNames.has(name)) fail('resume_skill_projection_incomplete');
    catalogById.set(skillId,{name,category:skill.category}); catalogNames.add(name);
  }
  const byId = new Map<string, string>(); const names = new Set<string>();
  for (const skill of selected) {
    if (!record(skill)) fail('resume_skill_projection_incomplete');
    const skillId = skillIdentity(skill.id); const name = typeof skill.name === 'string' ? normalize(skill.name) : '';
    const known = catalogById.get(skillId);
    if (Object.keys(skill).length !== 3 || !Object.keys(skill).every(key => ['id','general','name'].includes(key))
      || typeof skill.general !== 'boolean' || !skillId || !name || name.length > 200 || byId.has(skillId) || names.has(name)
      || !known || known.category !== 'SKILL' || known.name !== name) fail('resume_skill_projection_incomplete');
    byId.set(skillId,name); names.add(name);
  }
  const declaredNames = new Set<string>();
  for (const skill of selectedNames) {
    if (!record(skill)) fail('resume_skill_projection_incomplete');
    const name = typeof skill.string === 'string' ? normalize(skill.string) : '';
    if (Object.keys(skill).length !== 1 || !Object.hasOwn(skill,'string') || !name || !names.has(name)
      || declaredNames.has(name)) fail('resume_skill_projection_incomplete');
    declaredNames.add(name);
  }
  const seen = new Set<string>(); const keySkills: string[] = [];
  for (const tag of tags) {
    const skillId = tag.getAttribute('data-qa')?.slice('skill-tag-'.length);
    const name = normalize(tag.textContent);
    if (!skillId || !byId.has(skillId) || byId.get(skillId) !== name || seen.has(skillId)) fail('resume_skill_projection_incomplete');
    seen.add(skillId); keySkills.push(name);
  }
  return {kind:'resume_artifact_readback',readerVersion:'hh-owned-resume-dom-v1',hhAccountKey:request.hhAccountKey,resumeId:request.resumeId,internalId:request.internalId,headline,about,keySkills};
}

// Separate key/schema from application checkpoints; never store CV/artifact text.
export function createPublicationCheckpointStore(storage: Pick<StorageArea, 'get' | 'set' | 'remove'>): PublicationCheckpointStore {
  const key = 'hh-companion-publication-v1';
  function validate(v: unknown): PublicationCheckpoint {
    const keys = ['publicationId', 'phase', 'revision', 'phaseHash', 'status', 'permitId', 'receipt'];
    if (!isRecord(v) || Object.keys(v).some(k => !keys.includes(k))
      || typeof v.publicationId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/u.test(v.publicationId)
      || !isPhase(v.phase) || typeof v.revision !== 'number' || !Number.isSafeInteger(v.revision) || v.revision < 0
      || typeof v.phaseHash !== 'string' || !/^[a-f0-9]{64}$/u.test(v.phaseHash) || !(v.status === 'authorized' || v.status === 'reading' || v.status === 'receipted')
      || (v.permitId !== undefined && (typeof v.permitId !== 'string' || !/^[A-Za-z0-9_-]{43}$/u.test(v.permitId)))) throw Error('invalid_publication_checkpoint');
    let receipt: PublicationReceipt | undefined;
    if (v.receipt !== undefined) {
      const r = v.receipt;
      if (!isRecord(r) || Object.keys(r).some(k => !['receiptId', 'revision', 'phaseHash', 'outcome', 'proofId', 'permitId'].includes(k))
        || v.status !== 'receipted' || r.revision !== v.revision || r.phaseHash !== v.phaseHash || r.outcome !== 'confirmed'
        || typeof r.receiptId !== 'string' || typeof r.proofId !== 'string' || ![r.receiptId,r.proofId].every(id => /^[A-Za-z0-9_-]{1,128}$/u.test(id))
        || (r.permitId !== undefined && (typeof r.permitId !== 'string' || !/^[A-Za-z0-9_-]{43}$/u.test(r.permitId)))) throw Error('invalid_publication_checkpoint');
      receipt = {receiptId: r.receiptId, revision: v.revision, phaseHash: v.phaseHash, outcome: 'confirmed', proofId: r.proofId, ...(r.permitId === undefined ? {} : {permitId: r.permitId})};
    } else if (v.status === 'receipted') throw Error('invalid_publication_checkpoint');
    return {publicationId: v.publicationId, phase: v.phase, revision: v.revision, phaseHash: v.phaseHash, status: v.status,
      ...(v.permitId === undefined ? {} : {permitId: v.permitId}), ...(receipt ? {receipt} : {})};
  }
  return {
    async load() { const v = (await storage.get(key))[key]; return v === undefined ? null : validate(v); },
    async save(v) { await storage.set({ [key]: validate(v) }); },
    async clear() { await storage.remove(key); }
  };
}

function assertPublicationReceiptAcknowledged(checkpoint: PublicationCheckpoint, result: unknown): asserts result is Record<string, unknown> {
  const phases = ['duplicate','bind_copy','title','about','skills','levels','wizard','preferences','final_readback'];
  const last = checkpoint.phase === 'final_readback';
  if (!isRecord(result) || result.id !== checkpoint.publicationId || result.revision !== checkpoint.revision + 1
    || result.state !== (last ? 'completed' : 'ready') || result.phase !== (last ? 'final_readback' : phases[phases.indexOf(checkpoint.phase) + 1])
    || typeof result.phaseHash !== 'string' || !/^[a-f0-9]{64}$/u.test(result.phaseHash)) throw Error('publication_receipt_unacknowledged');
}

// Recovery only replays a durable receipt. It cannot request a permit or invoke
// an adapter, and is available even when mutation feature flags are disabled.
export async function recoverPublicationReceipt({ transport, checkpoints }: {transport: Pick<PublicationTransport, 'receipt'>; checkpoints: PublicationCheckpointStore}) {
  const checkpoint = await checkpoints.load();
  if (!checkpoint) return { outcome: 'idle' };
  if (checkpoint.status !== 'receipted' || !checkpoint.receipt) return { outcome: 'needs_user', reason: 'publication_reconciliation_required' };
  try {
    const result = await transport.receipt(checkpoint.publicationId, checkpoint.receipt);
    assertPublicationReceiptAcknowledged(checkpoint, result);
    await checkpoints.clear();
    return { outcome: 'confirmed', state: result };
  } catch { return { outcome: 'unknown', reason: 'publication_reconciliation_required' }; }
}

export function createPublicationExecutor({ transport, checkpoints, adapters = supportedPublicationAdapters, enabled = false, now = Date.now }: {transport: PublicationTransport; checkpoints: PublicationCheckpointStore; adapters?: Readonly<Partial<Record<PublicationPhase, PublicationAdapter>>>; enabled?: boolean; now?: () => number}) {
  let running = false;
  return async function execute(state: PublicationState) {
    if (running) return { outcome: 'needs_user', reason: 'publication_execution_busy' };
    running = true;
    try { return await executePhase(state); } finally { running = false; }
  };
  async function executePhase(state: PublicationState) {
    if (!enabled) return { outcome: 'needs_user', reason: 'publication_disabled' };
    const phase = state.phase;
    if (!isPhase(phase)) return { outcome: 'needs_user', reason: 'publication_phase_unsupported' };
    const adapter = adapters[phase];
    if (!adapter || typeof adapter.inspect !== 'function' || typeof adapter.proof !== 'function') return { outcome: 'needs_user', reason: 'publication_phase_unsupported' };
    const mutation = !['bind_copy', 'final_readback'].includes(state.phase);
    if (mutation && typeof adapter.perform !== 'function') return { outcome: 'needs_user', reason: 'publication_phase_unsupported' };
    const previous = await checkpoints.load();
    // An interrupted effect can only use a separate read-only reconciliation flow.
    if (previous || state.state !== 'ready') return { outcome: 'needs_user', reason: 'publication_reconciliation_required' };
    const matches = (evidence: unknown) => isRecord(evidence) && evidence.owned === true && evidence.phaseHash === state.phaseHash
      && evidence.hhAccountKey === state.binding.hhAccountKey
      && evidence.resumeId === (state.copy?.resumeId || state.binding.baseResumeId)
      && (!state.copy || evidence.internalId === state.copy.internalId);
    if (!matches(await adapter.inspect(state))) return { outcome: 'needs_user', reason: 'publication_context_changed' };
    let permit: PublicationPermit | undefined;
    const checkpoint: PublicationCheckpoint = { publicationId: state.id, phase, revision: state.revision, phaseHash: state.phaseHash, status: mutation ? 'authorized' : 'reading' };
    await checkpoints.save(checkpoint);
    try {
      if (mutation) {
        const candidate = await transport.permit(state.id, state.revision, state.phaseHash);
        if (!isRecord(candidate) || candidate.publicationId !== state.id || candidate.phase !== state.phase || candidate.revision !== state.revision || candidate.phaseHash !== state.phaseHash
          || typeof candidate.permitId !== 'string' || !/^[A-Za-z0-9_-]{43}$/u.test(candidate.permitId) || typeof candidate.expiresAt !== 'string'
          || !Number.isFinite(Date.parse(candidate.expiresAt)) || Date.parse(candidate.expiresAt) <= now() || Date.parse(candidate.expiresAt) > now() + 30000) throw Error('invalid_publication_permit');
        permit = {publicationId: state.id, phase, revision: state.revision, phaseHash: state.phaseHash, permitId: candidate.permitId, expiresAt: candidate.expiresAt};
        await checkpoints.save({ ...checkpoint, permitId: permit.permitId });
        if (!matches(await adapter.inspect(state)) || Date.parse(permit.expiresAt) <= now()) throw Error('publication_context_changed');
        // Exactly one effect per invocation. Adapter must also enforce at-most-once
        // within the pinned document and revalidate its permit before the click.
        if (!adapter.perform) throw Error('publication_phase_unsupported');
        await adapter.perform(state, permit);
      }
      const proofId = await adapter.proof(state);
      if (typeof proofId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/u.test(proofId)) throw Error('publication_proof_unavailable');
      const receipt: PublicationReceipt = { receiptId: crypto.randomUUID(), revision: state.revision, phaseHash: state.phaseHash, outcome: 'confirmed', proofId, ...(permit ? { permitId: permit.permitId } : {}) };
      await checkpoints.save({ ...checkpoint, status: 'receipted', receipt });
      const result = await transport.receipt(state.id, receipt);
      assertPublicationReceiptAcknowledged(checkpoint, result);
      await checkpoints.clear();
      return { outcome: 'confirmed', state: result };
    } catch {
      // Preserve checkpoint even if the permit response or receipt acknowledgement
      // was lost. No automatic effect retry and no invented copied resume ID.
      return { outcome: 'unknown', reason: 'publication_reconciliation_required' };
    }
  }
}
