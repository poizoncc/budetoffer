import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  companionEwans,
  companionEwansCatalog,
  createCompanionRequestError,
  readCompanionEwans,
  resolveCompanionEwans,
} from "../packages/ewans/src/index.ts";

test("catalog keeps unique stable codes and exact six-field descriptors", () => {
  const catalog = companionEwansCatalog();
  assert.ok(Object.keys(catalog).length > 30);
  for (const [code, descriptor] of Object.entries(catalog)) {
    assert.match(code, /^BO-COMP-\d{3}$/u);
    assert.equal(code, descriptor.code);
    assert.equal(descriptor.group, "COMPANION");
    assert.deepEqual(Object.keys(descriptor).sort(), [
      "code",
      "group",
      "httpStatus",
      "key",
      "message",
      "status",
    ]);
    assert.deepEqual(
      readCompanionEwans(descriptor, descriptor.httpStatus),
      descriptor,
    );
  }
  assert.equal(companionEwans("invalid_pairing").code, "BO-COMP-001");
});

test("flat, content, problem and throwable descriptors resolve identically", () => {
  const descriptor = companionEwans("device_login_rate_limited", 429);
  for (const value of [
    descriptor,
    { content: descriptor, status: 429 },
    { status: 429, title: "legacy_title", ewans: descriptor },
    Object.assign(new Error("legacy_message"), { ewans: descriptor }),
  ]) {
    assert.deepEqual(readCompanionEwans(value, 429), descriptor);
    const message = resolveCompanionEwans(value);
    assert.match(message, /Слишком много попыток подключения/u);
    assert.match(message, /Подождите/u);
    assert.ok(message.endsWith(`(${descriptor.code})`));
  }
});

test("invalid, changed, additional and mismatching descriptor fields are rejected", () => {
  const descriptor = companionEwans("device_unauthorized", 401);
  for (const value of [
    null,
    undefined,
    [],
    "unauthorized",
    {},
    { ...descriptor, message: "private token synthetic-hidden-value" },
    { ...descriptor, code: "BO-COMP-999" },
    { ...descriptor, group: "SYSTEM" },
    { ...descriptor, status: "success" },
    { ...descriptor, key: "request_unauthorized" },
    { ...descriptor, httpStatus: 403 },
    { ...descriptor, data: "extra" },
    { ...descriptor, [Symbol("extra")]: "extra" },
    { ...descriptor, constructor: "forbidden" },
    Object.assign(Object.create({ inherited: true }), descriptor),
  ]) {
    assert.equal(readCompanionEwans(value, 401), null);
  }
  assert.equal(readCompanionEwans(descriptor, 403), null);
  assert.equal(readCompanionEwans({ ewans: descriptor }, 403), null);
  assert.equal(readCompanionEwans({ content: descriptor }, 403), null);
});

test("prototype keys, getters and hostile proxies cannot become messages", () => {
  const descriptor = companionEwans("device_not_paired");
  const poisoned: unknown = JSON.parse(
    JSON.stringify({ ...descriptor, ["__proto__"]: { polluted: true } }),
  );
  assert.equal(readCompanionEwans(poisoned), null);
  assert.equal(
    readCompanionEwans({ ewans: descriptor, prototype: true }),
    null,
  );
  let accessed = false;
  const getter = Object.defineProperty({}, "ewans", {
    get() {
      accessed = true;
      throw new Error("synthetic-hidden-value");
    },
  });
  assert.equal(readCompanionEwans(getter), null);
  assert.equal(accessed, false);
  const hostile = new Proxy(
    {},
    {
      ownKeys() {
        throw new Error("synthetic-hidden-value");
      },
    },
  );
  assert.equal(readCompanionEwans(hostile), null);
  assert.doesNotMatch(
    resolveCompanionEwans(hostile),
    /synthetic-hidden-value/u,
  );
});

test("catalog and parsed descriptors are copies that cannot alter later responses", () => {
  const descriptor = companionEwans("invalid_pairing");
  const catalog = companionEwansCatalog();
  Reflect.set(descriptor, "message", "changed");
  Reflect.set(catalog["BO-COMP-001"], "key", "changed");
  Reflect.deleteProperty(catalog, "BO-COMP-002");
  const current = companionEwans("invalid_pairing");
  assert.equal(current.message, "Код подключения введён неверно.");
  assert.equal(current.key, "invalid_pairing");
  assert.ok(companionEwansCatalog()["BO-COMP-002"]);
  const parsed = readCompanionEwans(current);
  assert.ok(parsed);
  Reflect.set(parsed, "message", "changed again");
  assert.deepEqual(companionEwans("invalid_pairing"), current);
});

test("legacy machine keys are localized without rendering arbitrary remote strings", () => {
  for (const value of [
    "invalid_pairing",
    new Error("invalid_pairing"),
    { code: "invalid_pairing", message: "synthetic-hidden-value" },
    { title: "invalid_pairing" },
  ]) {
    assert.match(resolveCompanionEwans(value), /\(BO-COMP-001\)$/u);
  }
  for (const value of [
    "synthetic-hidden-value",
    new Error("synthetic-hidden-value"),
    { message: "synthetic-hidden-value" },
    { detail: "synthetic-hidden-value", code: "unknown_key" },
    { ...companionEwans("invalid_pairing"), message: "synthetic-hidden-value" },
  ]) {
    const result = resolveCompanionEwans(value);
    assert.doesNotMatch(result, /synthetic-hidden-value/u);
    assert.match(result, /\(BO-COMP-009\)$/u);
  }
  assert.match(
    resolveCompanionEwans({}, "network_unavailable"),
    /\(BO-COMP-008\)$/u,
  );
  assert.match(
    resolveCompanionEwans({}, "unknown synthetic-hidden-value"),
    /\(BO-COMP-035\)$/u,
  );
});

test("HTTP fallbacks preserve each expected status and reject misleading known keys", () => {
  for (const httpStatus of [
    400, 401, 403, 404, 405, 408, 409, 410, 413, 415, 421, 422, 429, 500, 502,
    503, 504,
  ]) {
    const fallback = companionEwans("synthetic_unknown_code", httpStatus);
    assert.equal(fallback.httpStatus, httpStatus);
    assert.ok(fallback.key.startsWith("request_"));
    assert.deepEqual(readCompanionEwans(fallback, httpStatus), fallback);
  }
  assert.equal(companionEwans("login_expired", 403).key, "request_forbidden");
  assert.equal(companionEwans("invalid_device_login", 400).code, "BO-COMP-015");
  assert.equal(companionEwans("invalid_device_login", 404).code, "BO-COMP-016");
  assert.equal(companionEwans("unknown").httpStatus, 503);
  assert.equal(companionEwans("network_unavailable").httpStatus, 503);
  assert.equal(companionEwans("__proto__", 400).key, "request_invalid");
  assert.equal(companionEwans("constructor", 409).key, "request_conflict");
});

test("request errors retain legacy control-flow messages while exposing safe EWANS", () => {
  const unauthorized = createCompanionRequestError(
    {},
    401,
    "companion_http_401",
  );
  const forbidden = createCompanionRequestError({}, 403, "companion_http_403");
  assert.equal(unauthorized.message, "companion_http_401");
  assert.equal(unauthorized.status, 401);
  assert.equal(unauthorized.ewans.httpStatus, 401);
  assert.equal(forbidden.message, "companion_http_403");
  assert.equal(forbidden.status, 403);
  assert.equal(forbidden.ewans.key, "request_forbidden");
  assert.notEqual(unauthorized.ewans.code, forbidden.ewans.code);
  assert.match(
    resolveCompanionEwans(forbidden),
    /Повторная привязка Chrome не требуется/u,
  );
  const legacy = createCompanionRequestError(
    { title: "invalid_device_login" },
    404,
    "pairing_rejected",
  );
  assert.equal(legacy.message, "pairing_rejected");
  assert.equal(legacy.ewans.code, "BO-COMP-016");
  const valid = companionEwans("device_login_rate_limited", 429);
  assert.deepEqual(
    createCompanionRequestError(
      { ewans: valid },
      429,
      "device_login_unavailable",
    ).ewans,
    valid,
  );
  assert.equal(
    createCompanionRequestError({ ewans: valid }, 401, "companion_http_401")
      .ewans.httpStatus,
    401,
  );
});

test("request errors never expose remote details through the message resolver", () => {
  const error = createCompanionRequestError(
    {
      title: "SELECT synthetic-hidden-value",
      code: "unknown_code",
      detail: "Bearer synthetic-hidden-value",
      ewans: {
        ...companionEwans("request_failed"),
        message: "synthetic-hidden-value",
      },
    },
    500,
    "companion_http_500",
  );
  assert.equal(error.message, "companion_http_500");
  assert.equal(error.ewans.key, "request_failed");
  assert.doesNotMatch(
    resolveCompanionEwans(error),
    /synthetic-hidden-value|SELECT|Bearer/u,
  );
});

test("the wire core has no framework, browser or backend dependencies", async () => {
  const source = await readFile(
    new URL("../packages/ewans/src/index.ts", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(source, /^\s*import\s/mu);
  assert.doesNotMatch(source, /@nestjs|axios|i18next|node:|chrome\./u);
});
