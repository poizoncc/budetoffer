import assert from "node:assert/strict";
import { test } from "node:test";
import { installPairedCompanion } from "../apps/chrome-companion/background/bootstrap.ts";
import type {
  CompanionMessageListener,
  PairedChromeApi,
} from "../apps/chrome-companion/shared/chrome-api.ts";
import { unavailableExecutionChrome } from "./helpers/chrome.ts";

function fixture(fetchImpl: typeof fetch) {
  const data: Record<string, unknown> = {};
  let listener: CompanionMessageListener | undefined;
  const chrome: PairedChromeApi = {
    ...unavailableExecutionChrome(),
    storage: {
      local: {
        async get(key: string) {
          return { [key]: data[key] };
        },
        async set(value: object) {
          Object.assign(data, value);
        },
        async remove(keys: string | string[]) {
          for (const key of Array.isArray(keys) ? keys : [keys]) {
            delete data[key];
          }
        },
        async setAccessLevel() {},
      },
    },
    alarms: { create() {}, onAlarm: { addListener() {} } },
    runtime: {
      id: "trusted-extension",
      getURL: (path: string) => `chrome-extension://trusted-extension/${path}`,
      onStartup: { addListener() {} },
      onMessage: {
        addListener(value: CompanionMessageListener) {
          listener = value;
        },
      },
    },
  };
  const worker = installPairedCompanion(chrome, fetchImpl, {
    onboardingConfig: {
      version: "2026-10-10",
      termsUrl: "https://example.test/terms",
      privacyUrl: "https://example.test/privacy",
    },
  });
  return {
    data,
    worker,
    message: (
      message: unknown,
      sender: { id?: string; url?: string },
      respond: (value: unknown) => void,
    ) => {
      assert.ok(listener);
      return listener(message, sender, respond);
    },
  };
}
const paired = {
  deviceId: "device-1",
  accessToken: "x".repeat(43),
  expiresAt: new Date(Date.now() + 60000).toISOString(),
};
const agreement = {
  adult: true,
  terms: true,
  privacy: true,
  computerAwake: true,
  version: "2026-10-10",
};
test("paired bootstrap retains secret only in trusted storage and sends no cookies", async () => {
  const calls: { url: string; options: RequestInit }[] = [];
  const fixtureValue = fixture(async (url, options) => {
    calls.push({ url: String(url), options: options! });
    let payload: unknown = { ready: false };
    if (String(url).endsWith("/redeem")) payload = paired;
    else if (String(url).endsWith("/lease")) payload = { job: null };
    return Response.json(payload);
  });
  // Startup checks are bounded and complete before pairing.
  await new Promise((resolve) => setImmediate(resolve));
  const status = await fixtureValue.worker.pair({
    origin: "http://127.0.0.1:6971",
    code: "a".repeat(43),
    label: "Test",
  });
  assert.equal(status.paired, true);
  assert.equal(status.onboardingRequired, true);
  assert.ok(!JSON.stringify(status).includes(paired.accessToken));
  await fixtureValue.worker.tick();
  assert.equal(calls.length, 1);
  await fixtureValue.worker.acceptOnboarding(agreement);
  await fixtureValue.worker.tick();
  assert.equal(calls.length, 3);
  for (const call of calls) {
    assert.equal(call.options.credentials, "omit");
    assert.equal(call.options.redirect, "error");
  }
  assert.deepEqual(JSON.parse(String(calls[1].options.body)), {
    hhAccountKey: null,
  });
  assert.equal(
    fixtureValue.message(
      { type: "chairs:device-status" },
      { id: "trusted-extension", url: "https://hh.ru/vacancy/1" },
      () => {
        throw new Error("secret response");
      },
    ),
    false,
  );
});
test("replacement pairing preserves uncertainty and requests only owner-scoped reconciliation reads", async () => {
  let requests = 0;
  const calls: string[] = [];
  const f = fixture(async (url, options) => {
    requests++;
    calls.push(String(url));
    if (String(url).endsWith("/lease")) {
      assert.deepEqual(JSON.parse(String(options?.body)), {
        reconcileOriginalJobId: "job",
      });
    }
    if (String(url).endsWith("/redeem")) return Response.json(paired);
    if (String(url).endsWith("/recovery")) {
      return Response.json({ jobId: "job", state: "reconciling" });
    }
    return Response.json({ job: null });
  });
  await new Promise((resolve) => setImmediate(resolve));
  await assert.rejects(
    f.worker.pair({
      origin: "https://outside.invalid",
      code: "a".repeat(43),
      label: "Test",
    }),
    /invalid_pairing/,
  );
  f.data["chairs-companion-checkpoint-v1"] = {
    phase: "authorized",
    jobId: "job",
    leaseToken: "x".repeat(43),
    payloadHash: "a".repeat(64),
  };
  await f.worker.pair({
    origin: "http://127.0.0.1:6971",
    code: "a".repeat(43),
    label: "Test",
  });
  assert.equal(requests, 1);
  assert.equal((await f.worker.status()).requiresReconciliation, true);
  await f.worker.acceptOnboarding(agreement);
  await f.worker.tick();
  assert.equal((await f.worker.status()).requiresReconciliation, true);
  assert.equal(calls.filter((url) => url.endsWith("/lease")).length, 1);
  assert.equal(
    calls.some((url) => url.endsWith("/receipts")),
    false,
  );
});
test("only owner-authenticated terminal recovery clears an expired-device checkpoint", async () => {
  let recoveredState = "reconciling";
  const calls: string[] = [];
  const f = fixture(async (url) => {
    calls.push(String(url));
    if (String(url).endsWith("/redeem")) return Response.json(paired);
    if (String(url).endsWith("/recovery")) {
      return Response.json({ jobId: "job", state: recoveredState });
    }
    return Response.json({ job: null });
  });
  await new Promise((resolve) => setImmediate(resolve));
  f.data["chairs-companion-checkpoint-v1"] = {
    phase: "authorized",
    jobId: "job",
    leaseToken: "old",
    payloadHash: "a".repeat(64),
    deviceId: "expired",
    origin: "http://127.0.0.1:6971",
  };
  await f.worker.pair({
    origin: "http://127.0.0.1:6971",
    code: "a".repeat(43),
    label: "Replacement",
  });
  await f.worker.acceptOnboarding(agreement);
  await f.worker.tick();
  assert.ok(f.data["chairs-companion-checkpoint-v1"]);
  recoveredState = "completed";
  await f.worker.tick();
  assert.equal(f.data["chairs-companion-checkpoint-v1"], undefined);
  assert.equal(calls.filter((url) => url.endsWith("/lease")).length, 1);
});
