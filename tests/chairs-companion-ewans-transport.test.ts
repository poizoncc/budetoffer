import assert from "node:assert/strict";
import { COMPANION_ORIGINS } from "../apps/chrome-companion/shared/destinations.ts";
import { test } from "node:test";
import { createCompanionTransport } from "../apps/chrome-companion/background/transport.ts";
import { publicLoginRequest } from "../apps/chrome-companion/background/device-login.ts";
import {
  companionEwans,
  readCompanionEwans,
  resolveCompanionEwans,
} from "../packages/ewans/src/index.ts";

const origin = COMPANION_ORIGINS[0];

for (const status of [401, 403]) {
  test(`HTTP ${status} preserves the worker's authentication decision and adds a safe descriptor`, async () => {
    const ewans = companionEwans("request_failed", status);
    const transport = createCompanionTransport({
      origin,
      token: async () => "synthetic-device-token",
      fetchImpl: async () => Response.json({ status, ewans }, { status }),
    });
    await assert.rejects(transport.heartbeat(null), (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal(error.message, `companion_http_${status}`);
      assert.deepEqual(readCompanionEwans(error, status), ewans);
      return true;
    });
  });
}

test("transport uses the catalog for a known server error without exposing request data", async () => {
  const ewans = companionEwans("automation_access_required", 403);
  const transport = createCompanionTransport({
    origin,
    token: async () => "synthetic-device-token",
    fetchImpl: async () => Response.json({ ewans }, { status: 403 }),
  });
  await assert.rejects(transport.heartbeat(null), (error: unknown) => {
    assert.match(resolveCompanionEwans(error), new RegExp(ewans.code, "u"));
    assert.doesNotMatch(JSON.stringify(error), /synthetic-device-token/u);
    return true;
  });
});

test("HTML and forged descriptors cannot turn response contents into a popup message", async () => {
  const secret = "synthetic-private-response-marker";
  for (const response of [
    new Response(`<html>${secret}</html>`, { status: 503 }),
    Response.json(
      {
        ewans: { ...companionEwans("connection_unavailable"), message: secret },
      },
      { status: 503 },
    ),
  ]) {
    const transport = createCompanionTransport({
      origin,
      token: async () => "synthetic-device-token",
      fetchImpl: async () => response,
    });
    await assert.rejects(transport.heartbeat(null), (error: unknown) => {
      assert.ok(readCompanionEwans(error, 503));
      assert.doesNotMatch(
        resolveCompanionEwans(error),
        new RegExp(secret, "u"),
      );
      assert.doesNotMatch(JSON.stringify(error), new RegExp(secret, "u"));
      return true;
    });
  }
});

test("a legacy server without EWANS remains compatible", async () => {
  const transport = createCompanionTransport({
    origin,
    token: async () => "synthetic-device-token",
    fetchImpl: async () =>
      Response.json(
        { type: "about:blank", title: "device_unauthorized", status: 401 },
        { status: 401 },
      ),
  });
  await assert.rejects(transport.heartbeat(null), (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.equal(error.message, "companion_http_401");
    assert.ok(readCompanionEwans(error, 401));
    return true;
  });
});

test("expired login keeps its machine code while carrying the catalog message", async () => {
  await assert.rejects(
    publicLoginRequest(
      async () =>
        Response.json(
          { ewans: companionEwans("login_expired") },
          { status: 410 },
        ),
      origin,
      "device-login/start",
      { label: "Synthetic Chrome" },
    ),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal(error.message, "login_expired");
      assert.equal(readCompanionEwans(error, 410)?.key, "login_expired");
      return true;
    },
  );
});

test("unreadable success data becomes an invalid-response descriptor", async () => {
  const transport = createCompanionTransport({
    origin,
    token: async () => "synthetic-device-token",
    fetchImpl: async () => new Response("<html>unreadable</html>"),
  });
  await assert.rejects(transport.heartbeat(null), (error: unknown) => {
    assert.equal(readCompanionEwans(error, 502)?.key, "invalid_response");
    return true;
  });
});
