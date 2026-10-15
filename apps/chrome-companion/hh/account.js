export function accountMatches(expected, observed) {
  return typeof expected === "string" && expected.length > 0 && typeof observed === "string" && observed.length > 0 && expected === observed;
}

// Observed on logged-in HH homepage and vacancy pages on 2026-10-04.
// Missing/changed schema and ambiguous account sessions fail closed. This does
// not certify resume ownership; each action must establish that separately.
export function readVerifiedAccountIdentity(documentRef = globalThis.document) {
  try {
    const node = documentRef?.querySelector('template#HH-Lux-InitialState');
    if (!node || node.innerHTML.length > 4_000_000) return null;
    const data = JSON.parse(node.innerHTML);
    if (data.userType !== 'applicant' || typeof data.userId !== 'string' || !/^[1-9]\d{0,19}$/u.test(data.userId)
      || !data.account || !data.hhidAccount || data.session?.isFallback !== false
      || data.session?.securityCheckFailed !== false || data.session?.isMultiAccount !== false
      || data.session?.hasExtraAccounts !== false) return null;
    return `hh-applicant-${data.userId}`;
  } catch {return null;}
}
