import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createCompanionController,
  vacancyIdFromUrl,
} from "../apps/chrome-companion/popup/controller.ts";
import type { LocalApplication } from "../apps/chrome-companion/popup/controller.ts";
import { isRecord } from "../apps/chrome-companion/shared/record.ts";

const page = { url: "https://spb.hh.ru/vacancy/111", title: "Engineer" };
const application: LocalApplication = {
  id: "app-111",
  version: 3,
  status: "pending",
  source: "hh.ru",
  externalId: "111",
  canonicalUrl: page.url,
  title: "Engineer",
  company: "Example",
};
function fixture(rows: LocalApplication[] = [application]) {
  const mutations: Array<{
    path: string;
    body: Record<string, unknown>;
    headers: Headers;
  }> = [];
  let active = page;
  const controller = createCompanionController({
    readPage: async () => active,
    ready: async () => ({ status: "ok" }),
    request: async (path, options = {}) => {
      if (options.method === "POST") {
        assert.ok(typeof options.body === "string");
        const body: unknown = JSON.parse(options.body);
        assert.ok(isRecord(body));
        assert.equal(typeof body.toStatus, "string");
        mutations.push({ path, body, headers: new Headers(options.headers) });
        return {
          application: { ...application, status: body.toStatus, version: 4 },
        };
      }
      return path.includes("?") ? { applications: rows } : { application };
    },
  });
  return {
    controller,
    mutations,
    changePage: () => {
      active = { ...page, url: "https://hh.ru/vacancy/222" };
    },
  };
}
test("matches vacancy identity, never the first pending row, and stages without pretending to send", async () => {
  const { controller, mutations } = fixture([
    {
      ...application,
      id: "other",
      externalId: "222",
      canonicalUrl: "https://hh.ru/vacancy/222",
    },
    application,
  ]);
  await controller.load();
  await controller.act("prepare");
  assert.equal(mutations.length, 1);
  assert.equal(mutations[0].path, "/applications/app-111/transitions");
  assert.equal(mutations[0].body.toStatus, "claimed");
  assert.equal(mutations[0].headers.get("if-match"), "3");
  assert.match(controller.state.message, /не отправлен/u);
});
test("blocks page mismatch, missing and ambiguous identities without any mutation", async () => {
  const changed = fixture();
  await changed.controller.load();
  changed.changePage();
  await assert.rejects(
    changed.controller.act("prepare"),
    /страница изменилась/u,
  );
  assert.equal(changed.mutations.length, 0);
  const missing = fixture([
    {
      ...application,
      externalId: "222",
      canonicalUrl: "https://hh.ru/vacancy/222",
    },
  ]);
  await assert.rejects(missing.controller.load(), /не найдена/u);
  await assert.rejects(missing.controller.act("prepare"), /заявку/u);
  assert.equal(missing.mutations.length, 0);
  const ambiguous = fixture([
    application,
    { ...application, id: "second-account" },
  ]);
  await assert.rejects(ambiguous.controller.load(), /несколько/u);
  await assert.rejects(ambiguous.controller.act("prepare"), /несколько/u);
  assert.equal(ambiguous.mutations.length, 0);
});
test("permits only legal actions and requires a delay reason", async () => {
  const { controller, mutations } = fixture();
  await controller.load();
  await assert.rejects(controller.act("delay", "Needs review"), /подготовьте/u);
  const unsupportedAction: unknown = "send";
  const unsupportedResult: unknown = Reflect.apply(controller.act, controller, [
    unsupportedAction,
  ]);
  assert.ok(unsupportedResult instanceof Promise);
  await assert.rejects(unsupportedResult, /Недопустимое/u);
  assert.equal(mutations.length, 0);
  assert.equal(vacancyIdFromUrl("https://hh.ru/applicant/resumes"), null);
  assert.equal(vacancyIdFromUrl("https://evil.example/vacancy/111"), null);
});
test("serializes action clicks while a request is pending", async () => {
  let release: () => void = () => {};
  let calls = 0;
  const controller = createCompanionController({
    readPage: async () => page,
    ready: async () => ({ status: "ok" }),
    request: async (path, options = {}) => {
      if (options.method === "POST") {
        calls++;
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        return {
          application: { ...application, status: "claimed", version: 4 },
        };
      }
      return path.includes("?")
        ? { applications: [application] }
        : { application };
    },
  });
  await controller.load();
  const first = controller.act("prepare");
  await new Promise((resolve) => setTimeout(resolve, 0));
  await controller.act("prepare");
  release();
  await first;
  assert.equal(calls, 1);
});
test("checks every page and refuses a stale version before any transition", async () => {
  const paths: string[] = [];
  let transitions = 0;
  const controller = createCompanionController({
    readPage: async () => page,
    ready: async () => ({ status: "ok" }),
    request: async (path, options = {}) => {
      paths.push(path);
      if (options.method === "POST") {
        transitions++;
        return { application };
      }
      if (path.includes("offset=0")) {
        return {
          applications: Array.from({ length: 100 }, (_, index) => ({
            ...application,
            id: `other-${index}`,
            externalId: "222",
            canonicalUrl: "https://hh.ru/vacancy/222",
          })),
        };
      }
      if (path.includes("offset=100")) return { applications: [application] };
      return { application: { ...application, version: 4 } };
    },
  });
  await controller.load();
  assert.equal(controller.state.application?.id, "app-111");
  await assert.rejects(controller.act("prepare"), /Данные заявки изменились/u);
  assert.equal(transitions, 0);
  assert.equal(controller.state.application, null);
  assert.ok(paths.some((path) => path.includes("offset=100")));
});

test("untrusted local application responses cannot authorize a transition", async () => {
  let mutations = 0;
  const controller = createCompanionController({
    readPage: async () => page,
    ready: async () => ({ status: "ok" }),
    request: async (_path, options) => {
      if (options?.method === "POST") mutations++;
      return { applications: [{ ...application, version: "3" }] };
    },
  });
  await assert.rejects(controller.load(), /Некорректный/u);
  await assert.rejects(controller.act("prepare"), /Сначала/u);
  assert.equal(mutations, 0);
});

test("a missing company on another row cannot block selection of the exact vacancy", async () => {
  const { controller } = fixture([
    {
      ...application,
      company: null,
      id: "other",
      externalId: "222",
      canonicalUrl: "https://hh.ru/vacancy/222",
    },
    { ...application, company: null },
  ]);
  await controller.load();
  assert.equal(controller.state.application?.id, application.id);
  assert.equal(controller.state.application?.company, null);
});

test("normalises the v1 nested vacancy response before matching and transitioning", async () => {
  const nested = {
    id: application.id,
    version: application.version,
    status: application.status,
    vacancy: {
      source: "hh.ru",
      externalId: "111",
      canonicalUrl: page.url,
      title: application.title,
      company: null,
    },
  };
  const unrelated = {
    ...nested,
    id: "telegram-item",
    vacancy: {
      source: "telegram",
      externalId: "synthetic",
      canonicalUrl: null,
      title: null,
      company: null,
    },
  };
  let mutations = 0;
  const controller = createCompanionController({
    readPage: async () => page,
    ready: async () => ({ status: "ok" }),
    request: async (path, options) => {
      if (options?.method === "POST") {
        mutations++;
        return { application: { ...nested, status: "claimed", version: 4 } };
      }
      return path.includes("?")
        ? { applications: [unrelated, nested] }
        : { application: nested };
    },
  });
  await controller.load();
  await controller.act("prepare");
  assert.equal(mutations, 1);
  assert.equal(controller.state.application?.title, application.title);
  assert.equal(controller.state.application?.status, "claimed");
});
