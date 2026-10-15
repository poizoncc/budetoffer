/** Untrusted JSON, Chrome messages and persisted values must be narrowed first. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function errorMessage(error: unknown): string {
  // Injected errors may come from another JavaScript realm.
  return isRecord(error) && typeof error.message === "string"
    ? error.message
    : "";
}
