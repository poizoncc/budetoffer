/** Read-only history identity proof grounded on HH's applicant-owned topic rows.
 * Empty lists cannot establish identity. Never infer an owner from resume IDs.
 */
export function readHistoryAccountIdentity(
  documentRef: Document = globalThis.document,
  locationHref: string = globalThis.location?.href,
): string | null {
  function record(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === "object" && !Array.isArray(value);
  }
  try {
    const url = new URL(locationHref);
    if (
      url.protocol !== "https:" ||
      !/(^|\.)hh\.ru$/u.test(url.hostname) ||
      url.username ||
      url.password ||
      url.port ||
      url.hash ||
      url.pathname !== "/applicant/negotiations"
    ) {
      return null;
    }
    const raw = documentRef.querySelector(
      "template#HH-Lux-InitialState",
    )?.innerHTML;
    if (!raw || raw.length > 4000000) return null;
    const data: unknown = JSON.parse(raw);
    if (!record(data)) return null;
    const session = record(data.session) ? data.session : null;
    if (
      data.userType !== "applicant" ||
      !data.account ||
      !data.hhidAccount ||
      session?.isFallback !== false ||
      session?.securityCheckFailed !== false ||
      session?.isMultiAccount !== false ||
      session?.hasExtraAccounts !== false
    ) {
      return null;
    }
    const topics = record(data.applicantNegotiations)
      ? data.applicantNegotiations.topicList
      : null;
    if (!Array.isArray(topics) || !topics.length || topics.length > 1000) {
      return null;
    }
    const owners = new Set<string>();
    for (const row of topics) {
      if (
        !record(row) ||
        typeof row.applicantUserId !== "number" ||
        !Number.isSafeInteger(row.applicantUserId) ||
        row.applicantUserId <= 0
      ) {
        return null;
      }
      owners.add(String(row.applicantUserId));
    }
    if (owners.size !== 1) return null;
    const owner = [...owners][0];
    if (data.userId !== undefined && data.userId !== owner) return null;
    return `hh-applicant-${owner}`;
  } catch {
    return null;
  }
}
