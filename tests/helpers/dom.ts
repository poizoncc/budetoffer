import assert from "node:assert/strict";
import type { JSDOM } from "jsdom";
import { isRecord } from "../../apps/chrome-companion/shared/record.ts";

/** Exercise the same serialized boundary as chrome.scripting, then narrow it. */
export function serializedRecord(
  dom: JSDOM,
  operation: { toString(): string },
  input: unknown,
): Record<string, unknown> {
  const result: unknown = dom.window.eval(
    `(${operation.toString()})(${JSON.stringify(input)})`,
  );
  assert.ok(isRecord(result), "serialized operation must return an object");
  return result;
}
