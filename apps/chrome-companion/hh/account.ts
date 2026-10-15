export function accountMatches(expected: unknown, observed: unknown): boolean {
  return typeof expected === "string" && expected.length > 0 && typeof observed === "string" && observed.length > 0 && expected === observed;
}

// Observed on logged-in HH homepage and vacancy pages on 2026-10-04.
// Missing/changed schema and ambiguous account sessions fail closed. This does
// not certify resume ownership; each action must establish that separately.
export function readVerifiedAccountIdentity(documentRef: Document | undefined = globalThis.document): string | null {
  function record(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  }
  try {
    const node = documentRef?.querySelector('template#HH-Lux-InitialState');
    if (!node || node.innerHTML.length > 4_000_000) return null;
    const data: unknown = JSON.parse(node.innerHTML);
    if (!record(data)) return null;
    const session = record(data.session) ? data.session : null;
    if (data.userType !== 'applicant' || typeof data.userId !== 'string' || !/^[1-9]\d{0,19}$/u.test(data.userId)
      || !data.account || !data.hhidAccount || session?.isFallback !== false
      || session?.securityCheckFailed !== false || session?.isMultiAccount !== false
      || session?.hasExtraAccounts !== false) return null;
    return `hh-applicant-${data.userId}`;
  } catch {return null;}
}
