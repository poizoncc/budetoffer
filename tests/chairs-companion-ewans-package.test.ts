import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, posix } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { strFromU8, unzipSync } from "fflate";
import ts from "typescript";
import { createCompanionArchive } from "../scripts/package-companion.ts";
import {
  companionEwans,
  readCompanionEwans,
} from "../packages/ewans/src/index.ts";
import type { PairedChromeApi } from "../apps/chrome-companion/shared/chrome-api.ts";
import { unavailableExecutionChrome } from "./helpers/chrome.ts";

const PREFIX = "budetoffer-chrome/";

function importsIn(source: string, file: string): string[] {
  const module = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.ES2022,
    true,
    ts.ScriptKind.JS,
  );
  const imports: string[] = [];
  function visit(node: ts.Node): void {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier
    ) {
      assert.ok(
        ts.isStringLiteral(node.moduleSpecifier),
        `nonliteral module import in ${file}`,
      );
      imports.push(node.moduleSpecifier.text);
    } else if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword
    ) {
      const argument = node.arguments[0];
      assert.ok(
        argument && ts.isStringLiteral(argument),
        `nonliteral dynamic import in ${file}`,
      );
      imports.push(argument.text);
    }
    ts.forEachChild(node, visit);
  }
  visit(module);
  return imports;
}

function functionText(source: string, name: string): string {
  const module = ts.createSourceFile(
    "callback.js",
    source,
    ts.ScriptTarget.ES2022,
    true,
    ts.ScriptKind.JS,
  );
  const declaration = module.statements.find(
    (statement) =>
      ts.isFunctionDeclaration(statement) && statement.name?.text === name,
  );
  assert.ok(declaration, `missing serialized function: ${name}`);
  return declaration.getText(module);
}

function callable(
  value: unknown,
  key: string,
): (...args: unknown[]) => unknown {
  assert.ok(value && typeof value === "object");
  const method: unknown = Reflect.get(value, key);
  assert.equal(typeof method, "function", `missing compiled method: ${key}`);
  if (typeof method !== "function") throw new Error("compiled_method_missing");
  return (...args) => Reflect.apply(method, value, args);
}

function reachable(graph: Map<string, string[]>, root: string): Set<string> {
  const visited = new Set<string>();
  const pending = [root];
  while (pending.length) {
    const current = pending.pop();
    assert.ok(current);
    if (visited.has(current)) continue;
    visited.add(current);
    pending.push(...(graph.get(current) ?? []));
  }
  return visited;
}

test("packaged EWANS is the canonical compiled core and every module stays inside the archive", async () => {
  const archive = unzipSync(
    await createCompanionArchive({ origin: "https://app.example.test" }),
  );
  const names = Object.keys(archive);
  const coreName = `${PREFIX}shared/ewans.js`;
  assert.ok(archive[coreName], "the relocated EWANS runtime module is present");
  assert.equal(names.filter((name) => name.endsWith("/ewans.js")).length, 1);
  assert.ok(names.every((name) => name.startsWith(PREFIX)));
  assert.ok(
    !names.some((name) =>
      /(?:^|\/)(?:packages|src|bridge|bff|input|data|node_modules|\.git)(?:\/|$)|\.(?:ts|tsx|map)$|(?:^|\/)\.env(?:\.|$)/u.test(
        name,
      ),
    ),
  );

  const graph = new Map<string, string[]>();
  for (const name of names.filter((item) => item.endsWith(".js"))) {
    const code = strFromU8(archive[name]);
    assert.doesNotMatch(
      code,
      /\/Users\/|\/private\/tmp\/|apps\/bff\/|packages\/ewans\/src|sourceMappingURL=/u,
    );
    // Vite's popup imports two fixed chrome.runtime.getURL modules. The
    // standalone worker graph below must use only archive-relative literals.
    if (name.startsWith(`${PREFIX}popup/assets/`)) continue;
    const targets = importsIn(code, name).map((specifier) => {
      assert.ok(
        specifier.startsWith("."),
        `external module ${specifier} in ${name}`,
      );
      assert.doesNotMatch(specifier, /[?#\\]/u);
      const target = posix.normalize(
        posix.join(posix.dirname(name), specifier),
      );
      assert.ok(
        target.startsWith(PREFIX),
        `module escapes archive: ${name} -> ${specifier}`,
      );
      assert.ok(
        archive[target],
        `missing packaged import: ${name} -> ${specifier}`,
      );
      assert.ok(
        target.endsWith(".js"),
        `uncompiled runtime import: ${specifier}`,
      );
      return target;
    });
    graph.set(name, targets);
  }
  for (const consumer of [
    "background/transport.js",
    "background/bootstrap.js",
    "background/device-login.js",
  ]) {
    assert.ok(
      reachable(graph, `${PREFIX}${consumer}`).has(coreName),
      `${consumer} can load the canonical EWANS module`,
    );
  }
  const source = await readFile(
    new URL("../packages/ewans/src/index.ts", import.meta.url),
    "utf8",
  );
  const emitted = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      newLine: ts.NewLineKind.LineFeed,
    },
    fileName: "index.ts",
  }).outputText;
  assert.equal(
    strFromU8(archive[coreName]),
    emitted,
    "packaging ships the canonical source compilation without rewriting function bodies",
  );
  for (const [file, name] of [
    ["hh/account", "readVerifiedAccountIdentity"],
    ["background/publication", "readPublicationResumeArtifacts"],
    ["hh/response-form", "responseFormOperation"],
  ]) {
    const callbackSource = await readFile(
      new URL(`../apps/chrome-companion/${file}.ts`, import.meta.url),
      "utf8",
    );
    const compiled = ts.transpileModule(callbackSource, {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ESNext,
      },
    }).outputText;
    assert.equal(
      functionText(strFromU8(archive[`${PREFIX}${file}.js`]), name),
      functionText(compiled, name),
      `runtime relocation preserves Chrome callback body: ${name}`,
    );
  }

  const directory = await mkdtemp(join(tmpdir(), "budetoffer-ewans-package-"));
  try {
    for (const [name, bytes] of Object.entries(archive)) {
      const file = join(directory, name);
      await mkdir(dirname(file), { recursive: true });
      await writeFile(file, bytes);
    }
    const rateLimited = companionEwans("device_login_rate_limited", 429);
    const request: typeof fetch = async () =>
      Response.json(
        { ewans: rateLimited, detail: "synthetic-hidden-value" },
        { status: 429 },
      );
    const transportModule: unknown = await import(
      pathToFileURL(join(directory, PREFIX, "background/transport.js")).href
    );
    const transport = callable(
      transportModule,
      "createCompanionTransport",
    )({
      origin: "https://app.example.test",
      token: async () => "synthetic-token",
      fetchImpl: request,
    });
    await assert.rejects(
      async () => {
        await callable(transport, "heartbeat")(null);
      },
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.equal(error.message, "companion_http_429");
        assert.deepEqual(readCompanionEwans(error, 429), rateLimited);
        assert.doesNotMatch(JSON.stringify(error), /synthetic-hidden-value/u);
        return true;
      },
    );

    const stored: Record<string, unknown> = {};
    const chrome: PairedChromeApi = {
      ...unavailableExecutionChrome(),
      storage: {
        local: {
          async get(key: string) {
            return { [key]: stored[key] };
          },
          async set(value: object) {
            Object.assign(stored, value);
          },
          async remove(keys: string | string[]) {
            for (const key of Array.isArray(keys) ? keys : [keys]) {
              delete stored[key];
            }
          },
          async setAccessLevel() {},
        },
      },
      alarms: { create() {}, onAlarm: { addListener() {} } },
      runtime: {
        id: "synthetic-extension",
        getURL: (path) => `chrome-extension://synthetic-extension/${path}`,
        onStartup: { addListener() {} },
        onMessage: { addListener() {} },
      },
    };
    const bootstrapModule: unknown = await import(
      pathToFileURL(join(directory, PREFIX, "background/bootstrap.js")).href
    );
    const worker = callable(bootstrapModule, "installPairedCompanion")(
      chrome,
      request,
    );
    for (let i = 0; i < 6; i++) {
      await new Promise((resolve) => setImmediate(resolve));
    }
    await assert.rejects(
      async () => {
        await callable(
          worker,
          "startLogin",
        )({ origin: "https://app.example.test", label: "Synthetic Chrome" });
      },
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.equal(error.message, "device_login_unavailable");
        assert.deepEqual(readCompanionEwans(error, 429), rateLimited);
        return true;
      },
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
