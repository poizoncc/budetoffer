import type { JSDOM } from "jsdom";
import type { ExecutionChromeApi } from "../../apps/chrome-companion/shared/chrome-api.ts";

/** Deliberately unavailable HH capabilities for pairing-only worker fixtures. */
export function unavailableExecutionChrome(): ExecutionChromeApi {
  const unavailable = async (): Promise<never> => {
    throw new Error("hh_browser_unavailable");
  };
  return {
    tabs: {
      query: async () => [],
      create: unavailable,
      get: unavailable,
      update: unavailable,
      remove: unavailable,
    },
    scripting: { executeScript: unavailable },
  };
}

/** Emulate Chrome's serialization boundary, so captured module helpers fail tests. */
export function runSerialized<Args extends unknown[], Result>(
  dom: JSDOM,
  func: (...args: Args) => Result,
  args: Args,
): Result {
  const callable: unknown = dom.window.eval(`(${func.toString()})`);
  if (typeof callable !== "function") {
    throw new Error("invalid_serialized_function");
  }
  // Chrome gives the result the injected callback's type. This assertion models
  // that browser boundary only; no Chrome API or domain payload is fabricated.
  return Reflect.apply(callable, undefined, args) as Result;
}
