import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import {
  localControllerFactory,
  type ChromeLocalApi,
} from "../apps/chrome-companion/src/popup/local-client.ts";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});
function fixture() {
  let allowed = true;
  let origin = "http://127.0.0.1:6971";
  const application = {
    id: "synthetic",
    title: "Synthetic vacancy",
    source: "hh.ru",
    externalId: "123",
    canonicalUrl: "https://hh.ru/vacancy/123",
    status: "pending",
    version: 3,
  };
  const requests: { url: string; method: string }[] = [];
  const api: ChromeLocalApi = {
    runtime: {
      getURL: (path) =>
        new URL(
          `../apps/chrome-companion/${path.replace(/\.js$/u, ".ts")}`,
          import.meta.url,
        ).href,
      sendMessage: async () => ({
        ok: true,
        paired: allowed,
        origin,
        onboardingRequired: !allowed,
      }),
    },
    tabs: {
      query: async () => [{ id: 1, url: application.canonicalUrl }],
      sendMessage: async () => ({ url: application.canonicalUrl }),
    },
    scripting: {
      executeScript: async () => {
        throw new Error("Unexpected script injection");
      },
    },
  };
  globalThis.fetch = async (input, options) => {
    const url = String(input);
    requests.push({ url, method: options?.method ?? "GET" });
    if (options?.method === "POST") {
      return Response.json({
        application: { ...application, status: "claimed", version: 4 },
      });
    }
    return Response.json(
      url.includes("/applications?")
        ? { applications: [application] }
        : { application },
    );
  };
  return {
    api,
    requests,
    application,
    deny: () => {
      allowed = false;
    },
    changeOrigin: () => {
      origin = "http://127.0.0.1:6970";
    },
  };
}

test("Local controller cannot initialise before account onboarding is accepted", async () => {
  const state = fixture();
  state.deny();
  await assert.rejects(
    localControllerFactory(state.api, "http://127.0.0.1:6971")(() => {}),
    /подтвердите условия/,
  );
  assert.equal(state.requests.length, 0);
});

test("revoking the extension while a Local application is selected prevents staging it", async () => {
  const state = fixture();
  const controller = await localControllerFactory(
    state.api,
    "http://127.0.0.1:6971",
  )(() => {});
  await controller.load();
  assert.equal(controller.state.application?.id, state.application.id);
  state.deny();
  const reads = state.requests.length;
  await assert.rejects(controller.act("prepare"), /подтвердите условия/);
  assert.equal(state.requests.length, reads);
  assert.equal(
    state.requests.some((request) => request.method === "POST"),
    false,
  );
});

test("the consent gate is rechecked immediately before the Local transition POST", async () => {
  const state = fixture();
  const read = globalThis.fetch;
  globalThis.fetch = async (input, options) => {
    const response = await read(input, options);
    if (String(input).endsWith("/applications/synthetic")) state.deny();
    return response;
  };
  const controller = await localControllerFactory(
    state.api,
    "http://127.0.0.1:6971",
  )(() => {});
  await controller.load();
  await assert.rejects(controller.act("prepare"), /подтвердите условия/);
  assert.equal(
    state.requests.some((request) => request.method === "POST"),
    false,
  );
  assert.equal(controller.state.application?.status, "pending");
});
test("pairing another origin never grants access to the selected Local adapter", async () => {
  const state = fixture();
  state.changeOrigin();
  await assert.rejects(
    localControllerFactory(state.api, "http://127.0.0.1:6971")(() => {}),
    /другому кабинету/,
  );
  assert.equal(state.requests.length, 0);
});
test("changing pairing origin after a Local application was selected prevents the transition", async () => {
  const state = fixture();
  const controller = await localControllerFactory(
    state.api,
    "http://127.0.0.1:6971",
  )(() => {});
  await controller.load();
  state.changeOrigin();
  await assert.rejects(controller.act("prepare"), /другому кабинету/);
  assert.equal(
    state.requests.some((request) => request.method === "POST"),
    false,
  );
});
test("frozen and discarded tabs do not start Local reads or inject their content script", async () => {
  for (const flag of ["frozen", "discarded"]) {
    const state = fixture();
    state.api.tabs.query = async () => [
      { id: 1, url: state.application.canonicalUrl, [flag]: true },
    ];
    const controller = await localControllerFactory(
      state.api,
      "http://127.0.0.1:6971",
    )(() => {});
    await assert.rejects(controller.load(), /приостановил вкладку/);
    assert.equal(state.requests.length, 0);
  }
});
test("a tab switch or mismatched content response cannot select an application", async () => {
  for (const mismatch of ["tab", "content"]) {
    const state = fixture();
    if (mismatch === "tab") {
      state.api.tabs.sendMessage = async () => {
        state.api.tabs.query = async () => [
          { id: 2, url: state.application.canonicalUrl },
        ];
        return { url: state.application.canonicalUrl };
      };
    } else {
      state.api.tabs.sendMessage = async () => ({
        url: "https://hh.ru/vacancy/456",
      });
    }
    const controller = await localControllerFactory(
      state.api,
      "http://127.0.0.1:6971",
    )(() => {});
    await assert.rejects(controller.load(), /страница изменилась/);
    assert.equal(state.requests.length, 0);
    assert.equal(controller.state.application, null);
  }
});
test("hidden and minimized windows need no active-page visibility check for a Local read", async () => {
  const state = fixture();
  const controller = await localControllerFactory(
    state.api,
    "http://127.0.0.1:6971",
  )(() => {});
  await controller.load();
  await controller.act("prepare");
  assert.equal(
    state.requests.filter((request) => request.method === "POST").length,
    1,
  );
  assert.ok(
    state.requests.every((request) =>
      request.url.startsWith("http://127.0.0.1:6970/"),
    ),
  );
});
