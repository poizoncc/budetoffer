import { createHash } from "node:crypto";
import { readFileSync, readdirSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const UI = "apps/ui-layer/src/";
const COMPANION = "apps/chrome-companion/";
const EWANS = "packages/ewans/src/index.ts";
const LAYERS = ["app", "pages", "widgets", "features", "entities", "shared"];
const RUNTIME = /^(?:background|hh|shared|popup)\//u;
const SLICED = new Set(["pages", "widgets", "features", "entities"]);

export interface BoundaryViolation {
  file: string;
  rule: string;
}
export interface SourceImport {
  specifier: string;
  typeOnly: boolean;
}
export interface SerializedEntry {
  file: string;
  name: string;
}

function violation(file: string, rule: string): BoundaryViolation[] {
  return [{ file, rule }];
}

function isWithin(file: string, directory: string): boolean {
  const boundary = path.resolve(directory);
  return file === boundary || file.startsWith(`${boundary}/`);
}

/** Pure policy: module resolution and package/provenance checks run separately. */
export function validateImport(
  importer: string,
  specifier: string,
  typeOnly = false,
): BoundaryViolation[] {
  const file = path.posix.normalize(importer.replaceAll("\\", "/"));
  const runtime =
    file.startsWith(COMPANION) && RUNTIME.test(file.slice(COMPANION.length));
  if (file === EWANS) return violation(file, "ewans-must-be-import-free");
  if (
    specifier.includes("\\") ||
    path.posix.isAbsolute(specifier) ||
    /^(?:file|https?):/u.test(specifier)
  ) {
    return violation(file, "escaping-import");
  }
  if (
    specifier.startsWith("@qrko/") &&
    /(?:^|\/)(?:src|packages|vendor|\.\.)(?:\/|$)/u.test(specifier)
  ) {
    return violation(file, "package-public-api");
  }
  let target: string;
  if (specifier.startsWith("@/")) {
    target = path.posix.normalize(UI + specifier.slice(2));
  } else if (specifier.startsWith(".")) {
    target = path.posix.normalize(
      path.posix.join(path.posix.dirname(file), specifier),
    );
  } else {
    if (runtime && !typeOnly) return violation(file, "worker-external-runtime");
    return [];
  }
  if (target.startsWith("../")) return violation(file, "escaping-import");
  if (target === EWANS || `${target}.ts` === EWANS) return [];
  if (!target.startsWith(UI) && !target.startsWith(COMPANION)) {
    return violation(file, "private-source-import");
  }
  if (
    target.startsWith(COMPANION) &&
    !RUNTIME.test(target.slice(COMPANION.length)) &&
    !target.startsWith(`${COMPANION}src/`)
  ) {
    return violation(file, "private-source-import");
  }
  if (runtime && !typeOnly && target.startsWith(UI)) {
    return violation(file, "worker-ui-runtime");
  }
  if (file.startsWith(UI) && target.startsWith(COMPANION)) {
    return violation(file, "ui-companion-import");
  }
  if (!target.startsWith(UI)) return [];
  const targetParts = target.slice(UI.length).split("/");
  const fromParts = file.startsWith(UI)
    ? file.slice(UI.length).split("/")
    : ["app"];
  const fromLayer = fromParts[0] ?? "";
  const targetLayer = targetParts[0] ?? "";
  const fromRank = LAYERS.indexOf(fromLayer);
  const targetRank = LAYERS.indexOf(targetLayer);
  if (fromRank < 0 || targetRank < 0) {
    return violation(file, "unknown-ui-layer");
  }
  if (targetRank < fromRank) return violation(file, "fsd-upward-import");
  const sameSlice =
    fromLayer === targetLayer && fromParts[1] === targetParts[1];
  if (targetRank === fromRank && SLICED.has(fromLayer) && !sameSlice) {
    return violation(file, "fsd-cross-slice");
  }
  if (SLICED.has(targetLayer) && !sameSlice) {
    const subpath = targetParts.slice(2).join("/");
    if (
      subpath !== "" &&
      subpath !== "index" &&
      subpath !== "index.ts" &&
      subpath !== "index.tsx"
    ) {
      return violation(file, "fsd-public-api");
    }
  }
  return [];
}

/** Include static exports, dynamic imports and import types without regex guessing. */
export function collectImports(source: ts.SourceFile): SourceImport[] {
  const imports: SourceImport[] = [];
  function visit(node: ts.Node) {
    if (
      ts.isImportDeclaration(node) &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      const clause = node.importClause;
      const named = clause?.namedBindings;
      const namedTypesOnly =
        !clause?.name &&
        named &&
        ts.isNamedImports(named) &&
        named.elements.length > 0 &&
        named.elements.every((element) => element.isTypeOnly);
      imports.push({
        specifier: node.moduleSpecifier.text,
        typeOnly: Boolean(clause?.isTypeOnly || namedTypesOnly),
      });
    } else if (
      ts.isExportDeclaration(node) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      const named = node.exportClause;
      const namedTypesOnly =
        named &&
        ts.isNamedExports(named) &&
        named.elements.length > 0 &&
        named.elements.every((element) => element.isTypeOnly);
      imports.push({
        specifier: node.moduleSpecifier.text,
        typeOnly: Boolean(node.isTypeOnly || namedTypesOnly),
      });
    } else if (
      ts.isImportTypeNode(node) &&
      ts.isLiteralTypeNode(node.argument) &&
      ts.isStringLiteral(node.argument.literal)
    ) {
      imports.push({ specifier: node.argument.literal.text, typeOnly: true });
    } else if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) &&
          node.expression.text === "require"))
    ) {
      const argument = node.arguments[0];
      if (argument && ts.isStringLiteral(argument)) {
        imports.push({ specifier: argument.text, typeOnly: false });
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  return imports;
}

function isPropertyName(node: ts.Identifier): boolean {
  const parent = node.parent;
  return (
    (ts.isPropertyAccessExpression(parent) && parent.name === node) ||
    (ts.isPropertyAssignment(parent) && parent.name === node) ||
    (ts.isMethodDeclaration(parent) && parent.name === node) ||
    (ts.isLabeledStatement(parent) && parent.label === node) ||
    ((ts.isBreakStatement(parent) || ts.isContinueStatement(parent)) &&
      parent.label === node)
  );
}

/** Serialized callbacks may use their own locals and ambient browser globals. */
export function validateSerializedFunctions(
  program: ts.Program,
  entries: readonly SerializedEntry[],
): BoundaryViolation[] {
  const checker = program.getTypeChecker();
  const failures: BoundaryViolation[] = [];
  for (const entry of entries) {
    const source = program.getSourceFile(entry.file);
    const operation = source?.statements.find(
      (statement): statement is ts.FunctionDeclaration =>
        ts.isFunctionDeclaration(statement) &&
        statement.name?.text === entry.name,
    );
    if (!source || !operation?.body) {
      failures.push({
        file: entry.file,
        rule: `serialized-missing:${entry.name}`,
      });
      continue;
    }
    const operationStart = operation.pos;
    const operationEnd = operation.end;
    const captured = new Set<string>();
    function visit(node: ts.Node) {
      if (ts.isTypeNode(node)) return;
      if (ts.isIdentifier(node) && !isPropertyName(node)) {
        let symbol = checker.getSymbolAtLocation(node);
        if (ts.isShorthandPropertyAssignment(node.parent)) {
          symbol = checker.getShorthandAssignmentValueSymbol(node.parent);
        }
        const declarations = symbol?.declarations ?? [];
        if (
          declarations.some(
            (declaration) =>
              !declaration.getSourceFile().isDeclarationFile &&
              (declaration.getSourceFile() !== source ||
                declaration.pos < operationStart ||
                declaration.end > operationEnd),
          )
        ) {
          captured.add(node.text);
        }
      }
      ts.forEachChild(node, visit);
    }
    visit(operation);
    for (const name of captured) {
      failures.push({
        file: entry.file,
        rule: `serialized-capture:${entry.name}:${name}`,
      });
    }
  }
  return failures;
}

const SERIALIZED: readonly SerializedEntry[] = [
  { file: `${COMPANION}hh/account.ts`, name: "readVerifiedAccountIdentity" },
  {
    file: `${COMPANION}hh/history-account.ts`,
    name: "readHistoryAccountIdentity",
  },
  { file: `${COMPANION}hh/actions.ts`, name: "readPageEvidence" },
  { file: `${COMPANION}hh/outcomes.ts`, name: "readApplicationOutcomesPage" },
  {
    file: `${COMPANION}background/publication.ts`,
    name: "readPublicationResumeArtifacts",
  },
  {
    file: `${COMPANION}hh/response-form.ts`,
    name: "readResponseResumeEvidence",
  },
  { file: `${COMPANION}hh/response-form.ts`, name: "openResponseUi" },
  { file: `${COMPANION}hh/response-form.ts`, name: "responseFormOperation" },
];

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function readObject(file: string): Record<string, unknown> {
  const value: unknown = JSON.parse(readFileSync(file, "utf8"));
  if (!record(value)) throw new Error("invalid_boundary_configuration");
  return value;
}

function walk(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (
      ["node_modules", "dist", "build", ".git", "coverage"].includes(entry.name)
    ) {
      return [];
    }
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) return walk(file);
    return [file];
  });
}

function vendorChecks(
  root: string,
  packageImports: ReadonlyMap<string, string[]>,
): BoundaryViolation[] {
  const failures: BoundaryViolation[] = [];
  const metadata = readObject(path.join(root, "package.json"));
  const dependencies = record(metadata.dependencies)
    ? metadata.dependencies
    : {};
  const provenance = readObject(path.join(root, "vendor/provenance.json"));
  if (!Array.isArray(provenance.packages)) {
    return violation("vendor/provenance.json", "invalid-vendor-provenance");
  }
  const require = createRequire(path.join(root, "package.json"));
  for (const name of Object.keys(dependencies).filter((name) =>
    name.startsWith("@qrko/"),
  )) {
    const files = packageImports.get(name) ?? [];
    const declaration = dependencies[name];
    const origin = provenance.packages.find(
      (item: unknown) => record(item) && item.name === name,
    );
    if (
      typeof declaration !== "string" ||
      !/^file:vendor\/qrko-[a-z-]+$/u.test(declaration) ||
      !record(origin) ||
      typeof origin.version !== "string" ||
      !/^\d+\.\d+\.\d+-main\.(?:\d{8}\.)?[a-f0-9]+$/u.test(origin.version) ||
      !Array.isArray(origin.files)
    ) {
      failures.push({ file: "package.json", rule: "unpinned-qrko-package" });
      continue;
    }
    const directory = realpathSync(path.join(root, declaration.slice(5)));
    const manifest = readObject(path.join(directory, "package.json"));
    if (manifest.name !== name || manifest.version !== origin.version) {
      failures.push({
        file: "vendor/provenance.json",
        rule: "vendor-version-mismatch",
      });
    }
    for (const item of origin.files) {
      if (
        !record(item) ||
        typeof item.path !== "string" ||
        typeof item.sha256 !== "string" ||
        !/^[a-f0-9]{64}$/u.test(item.sha256) ||
        !isWithin(path.resolve(root, "vendor", item.path), directory)
      ) {
        failures.push({
          file: "vendor/provenance.json",
          rule: "invalid-vendor-file",
        });
        continue;
      }
      const digest = createHash("sha256")
        .update(readFileSync(path.join(root, "vendor", item.path)))
        .digest("hex");
      if (digest !== item.sha256) {
        failures.push({
          file: `vendor/${item.path}`,
          rule: "vendor-provenance-mismatch",
        });
      }
    }
    for (const specifier of files) {
      try {
        const resolved = realpathSync(require.resolve(specifier));
        if (!isWithin(resolved, directory)) {
          failures.push({ file: specifier, rule: "qrko-package-source-alias" });
        }
      } catch {
        failures.push({ file: specifier, rule: "unresolved-qrko-export" });
      }
    }
  }
  for (const name of packageImports.keys()) {
    if (!(name in dependencies)) {
      failures.push({ file: "package.json", rule: "undeclared-qrko-package" });
    }
  }
  return failures;
}

export function checkBoundaries(root: string): BoundaryViolation[] {
  const failures: BoundaryViolation[] = [];
  const packageImports = new Map<string, string[]>();
  const files = [
    ...walk(path.join(root, COMPANION)),
    ...walk(path.join(root, UI)),
    path.join(root, EWANS),
  ];
  for (const absolute of files) {
    const file = path.relative(root, absolute).replaceAll(path.sep, "/");
    if (
      file.endsWith("vite.config.ts") ||
      /(?:\.d\.ts|\.(?:test|spec)\.tsx?)$/u.test(file)
    ) {
      continue;
    }
    if (!/\.tsx?$/u.test(file) && !file.endsWith(".css")) continue;
    const text = readFileSync(absolute, "utf8");
    const imports = file.endsWith(".css")
      ? Array.from(text.matchAll(/@import\s+["']([^"']+)["']/gu), (match) => ({
          specifier: match[1] ?? "",
          typeOnly: false,
        }))
      : collectImports(
          ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true),
        );
    for (const imported of imports) {
      failures.push(
        ...validateImport(file, imported.specifier, imported.typeOnly),
      );
      if (imported.specifier.startsWith("@qrko/")) {
        const name = imported.specifier.split("/").slice(0, 2).join("/");
        packageImports.set(name, [
          ...(packageImports.get(name) ?? []),
          imported.specifier,
        ]);
      }
    }
  }
  for (const absolute of [
    ...walk(root).filter(
      (file) =>
        path.basename(file).startsWith("tsconfig") && file.endsWith(".json"),
    ),
  ]) {
    const file = path.relative(root, absolute).replaceAll(path.sep, "/");
    if (file.startsWith("vendor/")) continue;
    const config = readObject(absolute);
    const options = record(config.compilerOptions)
      ? config.compilerOptions
      : {};
    const aliases = record(options.paths) ? options.paths : {};
    for (const [alias, targets] of Object.entries(aliases)) {
      if (alias.startsWith("@qrko/")) {
        failures.push({ file, rule: "qrko-package-source-alias" });
      }
      if (
        !Array.isArray(targets) ||
        targets.some(
          (target: unknown) =>
            typeof target !== "string" ||
            !isWithin(path.resolve(path.dirname(absolute), target), root),
        )
      ) {
        failures.push({ file, rule: "escaping-source-alias" });
      }
    }
  }
  const viteFile = `${COMPANION}vite.config.ts`;
  const vite = ts.createSourceFile(
    viteFile,
    readFileSync(path.join(root, viteFile), "utf8"),
    ts.ScriptTarget.Latest,
    true,
  );
  function inspectAlias(node: ts.Node) {
    if (
      ts.isPropertyAssignment(node) &&
      node.name.getText(vite).replaceAll(/["']/gu, "") === "alias"
    ) {
      function inspectTarget(child: ts.Node) {
        if (
          ts.isStringLiteral(child) &&
          (child.text.startsWith("@qrko/") ||
            /(?:^|\/)(?:packages|vendor\/qrko-[a-z-]+)(?:\/|$)/u.test(
              child.text,
            ))
        ) {
          failures.push({ file: viteFile, rule: "qrko-package-source-alias" });
        }
        ts.forEachChild(child, inspectTarget);
      }
      inspectTarget(node.initializer);
    }
    ts.forEachChild(node, inspectAlias);
  }
  inspectAlias(vite);
  const runtimeConfig = path.join(root, COMPANION, "tsconfig.runtime.json");
  const loaded = ts.readConfigFile(runtimeConfig, ts.sys.readFile);
  if (loaded.error) {
    failures.push({
      file: `${COMPANION}tsconfig.runtime.json`,
      rule: "invalid-runtime-config",
    });
  } else {
    const parsed = ts.parseJsonConfigFileContent(
      loaded.config,
      ts.sys,
      path.dirname(runtimeConfig),
    );
    const program = ts.createProgram(parsed.fileNames, {
      ...parsed.options,
      noEmit: true,
    });
    const captures = validateSerializedFunctions(
      program,
      SERIALIZED.map((entry) => ({
        ...entry,
        file: path.join(root, entry.file),
      })),
    );
    failures.push(
      ...captures.map((item) => ({
        ...item,
        file: path.relative(root, item.file).replaceAll(path.sep, "/"),
      })),
    );
  }
  failures.push(...vendorChecks(root, packageImports));
  return failures;
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const root = fileURLToPath(new URL("../", import.meta.url));
  const failures = checkBoundaries(root);
  for (const failure of failures) {
    console.error(`${failure.file}: ${failure.rule}`);
  }
  if (failures.length) process.exitCode = 1;
  else {
    console.log(
      "Boundaries verified: extension, FSD, QRKO packages and 8 serialized callbacks.",
    );
  }
}
