/** Read-only history identity proof grounded on HH's applicant-owned topic rows.
 * Empty lists cannot establish identity. Never infer an owner from resume IDs.
 */
export function readHistoryAccountIdentity(
  documentRef: Document | null = globalThis.document,
  locationHref: string | null = globalThis.location?.href,
  diagnostic = false,
): string | null | { accountKey: string | null; reasonCode: string | null } {
  function result(accountKey: string | null, reasonCode: string | null) {
    return diagnostic ? { accountKey, reasonCode } : accountKey;
  }
  function ownerId(value: unknown): string | null {
    if (typeof value === "number") {
      return Number.isSafeInteger(value) && value > 0 ? String(value) : null;
    }
    return typeof value === "string" && /^[1-9]\d{0,19}$/u.test(value)
      ? value
      : null;
  }
  function record(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === "object" && !Array.isArray(value);
  }
  try {
    const url = new URL(locationHref ?? globalThis.location.href);
    if (
      url.protocol !== "https:" ||
      !/(^|\.)hh\.ru$/u.test(url.hostname) ||
      url.username ||
      url.password ||
      url.port ||
      url.hash ||
      url.pathname !== "/applicant/negotiations"
    ) {
      return result(null, "history_target_mismatch");
    }
    const raw = (documentRef ?? globalThis.document).querySelector(
      "template#HH-Lux-InitialState",
    )?.innerHTML;
    if (!raw || raw.length > 4000000) {
      return result(null, "unsupported_history_page");
    }
    const data: unknown = JSON.parse(raw);
    if (!record(data)) return result(null, "unsupported_history_page");
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
      return result(null, "account_identity_unverified");
    }
    const topics = record(data.applicantNegotiations)
      ? data.applicantNegotiations.topicList
      : null;
    if (!Array.isArray(topics) || !topics.length || topics.length > 1000) {
      return result(null, "history_identity_missing");
    }
    const owners = new Set<string>();
    for (const row of topics) {
      const owner = record(row) ? ownerId(row.applicantUserId) : null;
      if (!owner) return result(null, "history_identity_missing");
      owners.add(owner);
    }
    if (owners.size !== 1) return result(null, "history_ambiguous");
    const owner = [...owners][0];
    if (data.userId !== undefined && ownerId(data.userId) !== owner) {
      return result(null, "account_changed");
    }
    return result(`hh-applicant-${owner}`, null);
  } catch {
    return result(null, "unsupported_history_page");
  }
}
