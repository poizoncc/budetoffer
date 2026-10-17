import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { JSDOM } from "jsdom";
import ts from "typescript";

test("cabinet bridge filters senders and commands and forwards only public status fields", async () => {
  const code = ts.transpileModule(
    await readFile("apps/chrome-companion/hh/cabinet-connect.ts", "utf8"),
    {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.None,
      },
    },
  ).outputText;
  const dom = new JSDOM("", {
    url: "https://my.budetoffer.ru/profile",
    runScripts: "outside-only",
  });
  const calls: unknown[] = [];
  const replies: unknown[] = [];
  Object.defineProperty(dom.window, "chrome", {
    value: {
      runtime: {
        sendMessage: async (message: unknown) => {
          calls.push(message);
          return {
            ok: true,
            paired: true,
            deviceId: "synthetic",
            accessToken: "must-not-cross",
            deviceCode: "also-private",
            onboardingRequired: true,
          };
        },
      },
    },
  });
  dom.window.postMessage = (message: unknown) => {
    replies.push(message);
  };
  dom.window.eval(code);
  const data = {
    type: "budetoffer:cabinet-connect-request",
    requestId: "synthetic-request-1234",
    action: "start",
  };
  const send = (
    value: unknown,
    origin = "https://my.budetoffer.ru",
    source: Window | null = dom.window as unknown as Window,
  ) =>
    dom.window.dispatchEvent(
      new dom.window.MessageEvent("message", { data: value, origin, source }),
    );
  send(data, "https://evil.example");
  send(data, "https://my.budetoffer.ru", null);
  send({ ...data, action: "disconnect" });
  send({ ...data, requestId: "short" });
  assert.equal(calls.length, 0);
  send(data);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [
    { type: "chairs:cabinet-start-login" },
  ]);
  assert.ok(!JSON.stringify(replies).includes("must-not-cross"));
  assert.ok(!JSON.stringify(replies).includes("also-private"));
  assert.equal(
    (replies[0] as { onboardingRequired: boolean }).onboardingRequired,
    true,
  );
  dom.window.close();
});
