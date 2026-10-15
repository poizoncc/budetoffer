/** Read-only history identity proof grounded on HH's applicant-owned topic rows.
 * Empty lists cannot establish identity. Never infer an owner from resume IDs.
 */
export function readHistoryAccountIdentity(documentRef = globalThis.document, locationHref = globalThis.location?.href) {
  try {
    const url = new URL(locationHref);
    if (url.protocol !== 'https:' || url.hostname !== 'hh.ru' || url.username||url.password||url.port||url.hash||url.pathname !== '/applicant/negotiations') return null;
    const raw = documentRef.querySelector('template#HH-Lux-InitialState')?.innerHTML;
    if (!raw || raw.length > 4000000) return null;
    const data = JSON.parse(raw), session = data.session;
    if (data.userType !== 'applicant' || !data.account || !data.hhidAccount || session?.isFallback !== false || session?.securityCheckFailed !== false || session?.isMultiAccount !== false || session?.hasExtraAccounts !== false) return null;
    const topics = data.applicantNegotiations?.topicList;
    if (!Array.isArray(topics) || !topics.length || topics.length > 1000) return null;
    const owners = new Set();
    for (const row of topics) {
      if (!Number.isSafeInteger(row?.applicantUserId) || row.applicantUserId <= 0) return null;
      owners.add(String(row.applicantUserId));
    }
    if (owners.size !== 1) return null;
    const owner = [...owners][0];
    if (data.userId !== undefined && data.userId !== owner) return null;
    return `hh-applicant-${owner}`;
  } catch { return null; }
}
