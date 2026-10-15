import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import {
  checkBoundaries,
  collectImports,
  validateImport,
  validateSerializedFunctions,
} from "../scripts/check-boundaries.ts";

const page = "apps/ui-layer/src/pages/companion-popup/ui/CompanionPopup.tsx";
const worker = "apps/chrome-companion/background/execution.ts";

test("FSD imports stay below their owner and use a slice public API", () => {
  assert.deepEqual(validateImport(page, "@/shared/ui/button"), []);
  assert.deepEqual(validateImport(page, "../model/companion-popup"), []);
  assert.deepEqual(
    validateImport(
      "apps/chrome-companion/src/popup/main.tsx",
      "@/pages/companion-popup",
    ),
    [],
  );
  assert.equal(
    validateImport(
      "apps/ui-layer/src/shared/ui/button.tsx",
      "@/pages/companion-popup",
    )[0]?.rule,
    "fsd-upward-import",
  );
  assert.equal(
    validateImport(page, "@/pages/another")[0]?.rule,
    "fsd-cross-slice",
  );
  assert.equal(
    validateImport(
      "apps/chrome-companion/src/popup/main.tsx",
      "@/pages/companion-popup/ui/CompanionPopup",
    )[0]?.rule,
    "fsd-public-api",
  );
});

test("relative imports cannot escape the public source or reach private server code", () => {
  assert.equal(
    validateImport(worker, "../../../../../../private.ts")[0]?.rule,
    "escaping-import",
  );
  assert.equal(
    validateImport(worker, "../../bff/src/server.ts")[0]?.rule,
    "private-source-import",
  );
  assert.equal(
    validateImport(
      page,
      "../../../../../vendor/qrko-uikit/src/shadcn/button.tsx",
    )[0]?.rule,
    "private-source-import",
  );
  assert.equal(
    validateImport(page, "file:///tmp/private.ts")[0]?.rule,
    "escaping-import",
  );
  assert.equal(
    validateImport(page, "/tmp/private.ts")[0]?.rule,
    "escaping-import",
  );
});

test("worker runtime uses browser code while package consumers use declared QRKO exports", () => {
  assert.deepEqual(
    validateImport(worker, "../shared/companion-protocol.ts"),
    [],
  );
  assert.deepEqual(validateImport(worker, "chrome", true), []);
  assert.equal(
    validateImport(worker, "node:fs")[0]?.rule,
    "worker-external-runtime",
  );
  assert.equal(
    validateImport(worker, "react")[0]?.rule,
    "worker-external-runtime",
  );
  assert.equal(
    validateImport(worker, "@/shared/ui/button")[0]?.rule,
    "worker-ui-runtime",
  );
  assert.equal(
    validateImport(page, "@qrko/uikit/src/shadcn/button")[0]?.rule,
    "package-public-api",
  );
  assert.deepEqual(validateImport(page, "@qrko/uikit/shadcn/button"), []);
});

test("AST import collection includes exports, import types, require and dynamic imports", () => {
  const source = ts.createSourceFile(
    "fixture.ts",
    `
    import type { Identity } from './identity.ts';
    import { type Model } from './model.ts';
    export { value } from './value.ts';
    export type { Result } from './result.ts';
    type State = import('./state.ts').State;
    import('./dynamic.ts');
    require('node:fs');
  `,
    ts.ScriptTarget.Latest,
    true,
  );
  assert.deepEqual(collectImports(source), [
    { specifier: "./identity.ts", typeOnly: true },
    { specifier: "./model.ts", typeOnly: true },
    { specifier: "./value.ts", typeOnly: false },
    { specifier: "./result.ts", typeOnly: true },
    { specifier: "./state.ts", typeOnly: true },
    { specifier: "./dynamic.ts", typeOnly: false },
    { specifier: "node:fs", typeOnly: false },
  ]);
});

function fixtureProgram(source: string): ts.Program {
  const files = new Map([
    ["/fixture.ts", source],
    ["/globals.d.ts", "declare const document: { title: string };"],
    ["/dependency.ts", "export const imported = () => 1;"],
  ]);
  const options: ts.CompilerOptions = {
    noLib: true,
    noEmit: true,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
  };
  const host = ts.createCompilerHost(options);
  host.getSourceFile = (file, languageVersion) => {
    const text = files.get(file);
    return text === undefined
      ? undefined
      : ts.createSourceFile(file, text, languageVersion, true);
  };
  host.fileExists = (file) => files.has(file);
  host.readFile = (file) => files.get(file);
  return ts.createProgram([...files.keys()], options, host);
}

test("serialized callbacks reject module captures, including imported and shorthand values", () => {
  const program = fixtureProgram(`
    import { imported } from './dependency.ts';
    const outer = 42;
    export function injected() { return { outer, value: imported() }; }
  `);
  const failures = validateSerializedFunctions(program, [
    { file: "/fixture.ts", name: "injected" },
  ]);
  assert.deepEqual(failures.map((item) => item.rule).sort(), [
    "serialized-capture:injected:imported",
    "serialized-capture:injected:outer",
  ]);
});

test("serialized callback locals, property names, type references and browser globals are allowed", () => {
  const program = fixtureProgram(`
    type Identity = { title: string };
    export function injected(input: Identity) {
      const local = input.title;
      function normalize(value: string) { return value; }
      return { title: normalize(local), original: document.title };
    }
  `);
  assert.deepEqual(
    validateSerializedFunctions(program, [
      { file: "/fixture.ts", name: "injected" },
    ]),
    [],
  );
  assert.equal(
    validateSerializedFunctions(program, [
      { file: "/fixture.ts", name: "missing" },
    ])[0]?.rule,
    "serialized-missing:missing",
  );
});

test("current standalone extension satisfies source, package and serialization boundaries", () => {
  assert.deepEqual(
    checkBoundaries(fileURLToPath(new URL("../", import.meta.url))),
    [],
  );
});
