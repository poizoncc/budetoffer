// No HH publication DOM adapter is currently grounded for the extension.
// Packaging selectors from the legacy Local driver is not ownership/form proof.
export const supportedPublicationAdapters = Object.freeze({});

// Serializable READ-ONLY function for chrome.scripting in a pinned owned tab.
// Grounded 2026-10-04: title H1, about-card single P, skills-card skill-tag-ID,
// advancedKeySkills + keySkills define the selected projection. The larger
// resumeApplicantSkills array is a catalog, not the selected skill list.
// No publication status or duplicate causality is inferred here.
export function readPublicationResumeArtifacts(request, documentRef = globalThis.document, locationHref = globalThis.location?.href) {
  const fail = reason => { throw Error(reason); };
  const record = value => !!value && typeof value === 'object' && !Array.isArray(value);
  const id = value => typeof value === 'string' && /^[A-Za-z0-9_-]{4,128}$/u.test(value);
  const normalize = value => String(value || '').replace(/\r\n?/gu, '\n').replace(/\s+/gu, ' ').trim();
  if (!record(request) || Object.keys(request).some(key => !['resumeId','internalId','hhAccountKey'].includes(key)) || !id(request.resumeId)
    || typeof request.internalId !== 'string' || !/^[1-9]\d{0,30}$/u.test(request.internalId)) fail('invalid_resume_read_target');
  const url = new URL(locationHref);
  // Match the existing HH host boundary; allow only the observed profile link query.
  if (url.protocol !== 'https:' || !/(^|\.)hh\.ru$/u.test(url.hostname) || url.port || url.username || url.password
    || (url.search && url.search !== '?hhtmFrom=applicant_profile') || url.hash || url.pathname !== `/resume/${request.resumeId}`) fail('resume_read_target_changed');
  const source = documentRef.querySelector('template#HH-Lux-InitialState')?.innerHTML;
  if (typeof source !== 'string' || !source || source.length > 5000000) fail('resume_state_unavailable');
  let state;
  try { state = JSON.parse(source); } catch { fail('resume_state_unavailable'); }
  const user = state?.userId, resume = state?.applicantResume, attrs = resume?._attributes;
  if (state?.userType !== 'applicant' || typeof user !== 'string' || !/^[1-9]\d{0,30}$/u.test(user)
    || !record(state.account) || !record(state.hhidAccount) || !record(state.session)
    || !['isFallback','securityCheckFailed','isMultiAccount','hasExtraAccounts'].every(key => state.session[key] === false)
    || request.hhAccountKey !== `hh-applicant-${user}` || !record(resume) || resume.forbidden !== null || !record(attrs)
    || attrs.user !== user || attrs.permission !== 'edit' || attrs.hash !== request.resumeId || attrs.id !== request.internalId
    || !record(resume.applicantUserStatuses) || !Object.hasOwn(resume.applicantUserStatuses,user)
    || !record(resume.applicantUserStatuses[user]) || !Object.hasOwn(resume.applicantUserStatuses[user],'jobSearchStatus')) fail('resume_ownership_unverified');
  const one = selector => { const nodes = documentRef.querySelectorAll(selector); if (nodes.length !== 1) fail('resume_projection_unsupported'); return nodes[0]; };
  const title = one('h1[data-qa="resume-block-title-position"]');
  const aboutCard = one('div[data-qa="resume-about-card"]');
  const paragraphs = aboutCard.querySelectorAll('p');
  if (paragraphs.length !== 1 || paragraphs[0].querySelector('button,input,textarea,select,script,style,[hidden],[aria-hidden="true"]')) fail('resume_about_projection_incomplete');
  // cloneNode can upgrade custom elements. Read data nodes without constructing
  // another DOM tree or executing callbacks from imported resume markup.
  const pending=[paragraphs[0]],parts=[];let visited=0,length=0;
  while(pending.length){const node=pending.pop();if(++visited>10000)fail('resume_text_projection_incomplete');
    if(node.nodeType===3){const value=node.nodeValue||'';length+=value.length;if(length>20000)fail('resume_text_projection_incomplete');parts.push(value);continue;}
    if(node.tagName?.toLowerCase()==='br')parts.push('\n');
    const children=node.childNodes||[];for(let index=children.length-1;index>=0;index--)pending.push(children[index]);
  }
  const headline = normalize(title.textContent), about = normalize(parts.join(''));
  if (!headline || headline.length > 1000 || !about || about.length > 20000 || /(?:…|\.\.\.)$/u.test(about)) fail('resume_text_projection_incomplete');
  const skillCard = one('div[data-qa="skills-card"]');
  const tags = [...skillCard.querySelectorAll('[data-qa^="skill-tag-"]')];
  const catalog = resume.resumeApplicantSkills, selected = resume.advancedKeySkills, selectedNames = resume.keySkills;
  if (![catalog,selected,selectedNames].every(list => Array.isArray(list) && list.length <= 200)
    || tags.length !== selected.length || selectedNames.length !== selected.length) fail('resume_skill_projection_incomplete');
  const skillIdentity = value => {
    if (typeof value !== 'string' && !(typeof value === 'number' && Number.isSafeInteger(value) && value >= 0)) return '';
    const text = String(value); return /^[A-Za-z0-9_-]{1,128}$/u.test(text) ? text : '';
  };
  const catalogById = new Map(), catalogNames = new Set();
  for (const skill of catalog) {
    const skillId = skillIdentity(skill?.id), name = typeof skill?.name === 'string' ? normalize(skill.name) : '';
    if (!record(skill) || !skillId || !name || name.length > 200 || typeof skill.category !== 'string'
      || catalogById.has(skillId) || catalogNames.has(name)) fail('resume_skill_projection_incomplete');
    catalogById.set(skillId,{name,category:skill.category}); catalogNames.add(name);
  }
  const byId = new Map(), names = new Set();
  for (const skill of selected) {
    const skillId = skillIdentity(skill?.id), name = typeof skill?.name === 'string' ? normalize(skill.name) : '';
    const known = catalogById.get(skillId);
    if (!record(skill) || Object.keys(skill).length !== 3 || !Object.keys(skill).every(key => ['id','general','name'].includes(key))
      || typeof skill.general !== 'boolean' || !skillId || !name || name.length > 200 || byId.has(skillId) || names.has(name)
      || !known || known.category !== 'SKILL' || known.name !== name) fail('resume_skill_projection_incomplete');
    byId.set(skillId,name); names.add(name);
  }
  const declaredNames = new Set();
  for (const skill of selectedNames) {
    const name = typeof skill?.string === 'string' ? normalize(skill.string) : '';
    if (!record(skill) || Object.keys(skill).length !== 1 || !Object.hasOwn(skill,'string') || !name || !names.has(name)
      || declaredNames.has(name)) fail('resume_skill_projection_incomplete');
    declaredNames.add(name);
  }
  const seen = new Set(), keySkills = [];
  for (const tag of tags) {
    const skillId = tag.getAttribute('data-qa').slice('skill-tag-'.length);
    const name = normalize(tag.textContent);
    if (!byId.has(skillId) || byId.get(skillId) !== name || seen.has(skillId)) fail('resume_skill_projection_incomplete');
    seen.add(skillId); keySkills.push(name);
  }
  return {kind:'resume_artifact_readback',readerVersion:'hh-owned-resume-dom-v1',hhAccountKey:request.hhAccountKey,resumeId:request.resumeId,internalId:request.internalId,headline,about,keySkills};
}

// Separate key/schema from application checkpoints; never store CV/artifact text.
export function createPublicationCheckpointStore(storage) {
  const key = 'hh-companion-publication-v1';
  const phases = ['duplicate', 'bind_copy', 'title', 'about', 'skills', 'levels', 'wizard', 'preferences', 'final_readback'];
  function validate(v) {
    const keys = ['publicationId', 'phase', 'revision', 'phaseHash', 'status', 'permitId', 'receipt'];
    if (!v || typeof v !== 'object' || Object.keys(v).some(k => !keys.includes(k))
      || typeof v.publicationId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/u.test(v.publicationId)
      || !phases.includes(v.phase) || !Number.isSafeInteger(v.revision) || v.revision < 0
      || !/^[a-f0-9]{64}$/u.test(v.phaseHash) || !['authorized', 'reading', 'receipted'].includes(v.status)
      || (v.permitId !== undefined && !/^[A-Za-z0-9_-]{43}$/u.test(v.permitId))) throw Error('invalid_publication_checkpoint');
    if (v.receipt !== undefined) {
      const r = v.receipt;
      if (!r || typeof r !== 'object' || Object.keys(r).some(k => !['receiptId', 'revision', 'phaseHash', 'outcome', 'proofId', 'permitId'].includes(k))
        || v.status !== 'receipted' || r.revision !== v.revision || r.phaseHash !== v.phaseHash || r.outcome !== 'confirmed'
        || ![r.receiptId,r.proofId].every(id => typeof id === 'string' && /^[A-Za-z0-9_-]{1,128}$/u.test(id))
        || (r.permitId !== undefined && !/^[A-Za-z0-9_-]{43}$/u.test(r.permitId))) throw Error('invalid_publication_checkpoint');
    } else if (v.status === 'receipted') throw Error('invalid_publication_checkpoint');
    return structuredClone(v);
  }
  return {
    async load() { const v = (await storage.get(key))[key]; return v === undefined ? null : validate(v); },
    async save(v) { await storage.set({ [key]: validate(v) }); },
    async clear() { await storage.remove(key); }
  };
}

function assertPublicationReceiptAcknowledged(checkpoint, result) {
  const phases = ['duplicate','bind_copy','title','about','skills','levels','wizard','preferences','final_readback'];
  const last = checkpoint.phase === 'final_readback';
  if (!result || result.id !== checkpoint.publicationId || result.revision !== checkpoint.revision + 1
    || result.state !== (last ? 'completed' : 'ready') || result.phase !== (last ? 'final_readback' : phases[phases.indexOf(checkpoint.phase) + 1])
    || typeof result.phaseHash !== 'string' || !/^[a-f0-9]{64}$/u.test(result.phaseHash)) throw Error('publication_receipt_unacknowledged');
}

// Recovery only replays a durable receipt. It cannot request a permit or invoke
// an adapter, and is available even when mutation feature flags are disabled.
export async function recoverPublicationReceipt({ transport, checkpoints }) {
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

export function createPublicationExecutor({ transport, checkpoints, adapters = supportedPublicationAdapters, enabled = false, now = Date.now }) {
  let running = false;
  return async function execute(state) {
    if (running) return { outcome: 'needs_user', reason: 'publication_execution_busy' };
    running = true;
    try { return await executePhase(state); } finally { running = false; }
  };
  async function executePhase(state) {
    if (!enabled) return { outcome: 'needs_user', reason: 'publication_disabled' };
    const adapter = adapters[state.phase];
    if (!adapter || typeof adapter.inspect !== 'function' || typeof adapter.proof !== 'function') return { outcome: 'needs_user', reason: 'publication_phase_unsupported' };
    const mutation = !['bind_copy', 'final_readback'].includes(state.phase);
    if (mutation && typeof adapter.perform !== 'function') return { outcome: 'needs_user', reason: 'publication_phase_unsupported' };
    const previous = await checkpoints.load();
    // An interrupted effect can only use a separate read-only reconciliation flow.
    if (previous || state.state !== 'ready') return { outcome: 'needs_user', reason: 'publication_reconciliation_required' };
    const matches = evidence => evidence?.owned === true && evidence.phaseHash === state.phaseHash
      && evidence.hhAccountKey === state.binding.hhAccountKey
      && evidence.resumeId === (state.copy?.resumeId || state.binding.baseResumeId)
      && (!state.copy || evidence.internalId === state.copy.internalId);
    if (!matches(await adapter.inspect(state))) return { outcome: 'needs_user', reason: 'publication_context_changed' };
    let permit;
    const checkpoint = { publicationId: state.id, phase: state.phase, revision: state.revision, phaseHash: state.phaseHash, status: mutation ? 'authorized' : 'reading' };
    await checkpoints.save(checkpoint);
    try {
      if (mutation) {
        permit = await transport.permit(state.id, state.revision, state.phaseHash);
        if (permit.publicationId !== state.id || permit.phase !== state.phase || permit.revision !== state.revision || permit.phaseHash !== state.phaseHash
          || typeof permit.permitId !== 'string' || !/^[A-Za-z0-9_-]{43}$/u.test(permit.permitId)
          || !Number.isFinite(Date.parse(permit.expiresAt)) || Date.parse(permit.expiresAt) <= now() || Date.parse(permit.expiresAt) > now() + 30000) throw Error('invalid_publication_permit');
        await checkpoints.save({ ...checkpoint, permitId: permit.permitId });
        if (!matches(await adapter.inspect(state)) || Date.parse(permit.expiresAt) <= now()) throw Error('publication_context_changed');
        // Exactly one effect per invocation. Adapter must also enforce at-most-once
        // within the pinned document and revalidate its permit before the click.
        await adapter.perform(state, permit);
      }
      const proofId = await adapter.proof(state);
      if (typeof proofId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/u.test(proofId)) throw Error('publication_proof_unavailable');
      const receipt = { receiptId: crypto.randomUUID(), revision: state.revision, phaseHash: state.phaseHash, outcome: 'confirmed', proofId, ...(permit ? { permitId: permit.permitId } : {}) };
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
