import {
  readFile,
  realpath,
  lstat,
  mkdir,
  writeFile,
  mkdtemp,
  readdir,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { strToU8, zipSync } from "fflate";
import ts from "typescript";

type PackageFile = readonly [name: string, content: string | Uint8Array];
type PackageOptions = {
  origin: string | null;
  outputDir: string;
  local?: boolean;
};
type PackageInventory = {
  name: string;
  version: string;
  license: string | null;
  firstParty: boolean;
};
type SupplementalNotice = {
  version: string;
  file: string;
  source: string;
  note: string;
};
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function errorCode(error: unknown): string {
  if (record(error) && typeof error.code === "string") return error.code;
  if (error instanceof Error) return error.message;
  return "unknown_error";
}

const source = fileURLToPath(
  new URL("../apps/chrome-companion/", import.meta.url),
);
const workspace = fileURLToPath(new URL("../", import.meta.url));
const firstPartyPackages = new Set(["@qrko/shared", "@qrko/uikit"]);
const supplementalNotices: Readonly<Record<string, SupplementalNotice>> =
  Object.freeze({
    "react-remove-scroll-bar": {
      version: "2.3.8",
      file: "licenses/react-remove-scroll-bar.LICENSE",
      source:
        "https://github.com/theKashey/react-remove-scroll-bar/blob/8ca9ba5ea52de03308fe8ced94f7b159a44d28ff/LICENSE",
      note: "The installed package declares MIT but omits its license file. This is the exact upstream license at the pinned source commit; its package.json reports 2.3.7. The npm 2.3.8 gitHead was not available upstream.",
    },
  });
const publicFiles = Object.freeze([
  "assets/budetoffer-logo.svg",
  "assets/budetoffer-icon-16.png",
  "assets/budetoffer-icon-32.png",
  "assets/budetoffer-icon-48.png",
  "assets/budetoffer-icon-128.png",
]);

async function popupNotices(renderedModules: string[]): Promise<PackageFile[]> {
  const packages = new Map<string, string>();
  for (const id of renderedModules) {
    const match = [...id.matchAll(/\/node_modules\/((?:@[^/]+\/)?[^/]+)/gu)].at(
      -1,
    );
    if (match) {
      packages.set(match[1], id.slice(0, (match.index ?? 0) + match[0].length));
    }
    const vendored = id.match(/\/vendor\/(qrko-(?:shared|uikit))\/src\//u);
    if (vendored) {
      packages.set(
        `@qrko/${vendored[1].slice(5)}`,
        join(workspace, "vendor", vendored[1]),
      );
    }
  }
  // Tailwind's generated stylesheet ships alongside the JavaScript bundle.
  packages.set("tailwindcss", join(workspace, "node_modules/tailwindcss"));
  const sections = [
    "BudetOffer Chrome companion — bundled component notices",
    "The project license is included as LICENSE. PT Sans font licensing is included as licenses/PTSans-OFL.txt.",
    "QRKO packages are identified below as first-party components. No separate license file or license grant is asserted for those package names.",
  ];
  const inventory: PackageInventory[] = [];
  for (const [name, directory] of [...packages].sort(([a], [b]) =>
    a.localeCompare(b, "en"),
  )) {
    const metadata: unknown = JSON.parse(
      await readFile(join(directory, "package.json"), "utf8"),
    );
    if (
      !record(metadata) ||
      metadata.name !== name ||
      typeof metadata.version !== "string"
    ) {
      throw new Error("invalid_popup_package_metadata");
    }
    const licenseFiles = (await readdir(directory))
      .filter((file) =>
        /^(?:licen[cs]e|notice|copying)(?:\.[a-z0-9_-]+)?$/iu.test(file),
      )
      .sort();
    const entry = {
      name,
      version: metadata.version,
      license: typeof metadata.license === "string" ? metadata.license : null,
      firstParty: firstPartyPackages.has(name),
    };
    sections.push(
      `\n=== ${name} ${metadata.version} ===`,
      entry.firstParty
        ? "First-party QRKO component; no separate license metadata supplied."
        : `Declared license: ${entry.license ?? "not supplied"}`,
    );
    for (const file of licenseFiles) {
      if (!(await lstat(join(directory, file))).isFile()) {
        throw new Error("invalid_popup_license_file");
      }
      sections.push(
        `\n--- ${file} ---\n${await readFile(join(directory, file), "utf8")}`,
      );
    }
    if (!licenseFiles.length && !entry.firstParty) {
      const supplemental = supplementalNotices[name];
      if (!supplemental || supplemental.version !== metadata.version) {
        throw new Error(`missing_popup_license:${name}`);
      }
      sections.push(
        supplemental.note,
        `Source: ${supplemental.source}`,
        await readFile(join(source, supplemental.file), "utf8"),
      );
    }
    inventory.push(entry);
  }
  if (
    renderedModules.some((id) => /\/node_modules\/react-icons\/tb\//u.test(id))
  ) {
    if (
      inventory.find((entry) => entry.name === "react-icons")?.version !==
      "5.7.0"
    ) {
      throw new Error("review_updated_tabler_license");
    }
    sections.push(
      "\n=== Tabler Icons (via react-icons/tb) ===",
      "Source: https://github.com/tabler/tabler-icons/blob/6d128ed935d4546607b1e4d5d08c8b27bdbe7758/LICENSE",
      "This is the Tabler source revision recorded by react-icons v5.7.0.",
      await readFile(join(source, "licenses/tabler-icons.LICENSE"), "utf8"),
    );
  }
  return [
    ["LICENSE", await readFile(join(workspace, "LICENSE"))],
    [
      "licenses/PTSans-OFL.txt",
      await readFile(
        join(workspace, "apps/ui-layer/src/shared/assets/fonts/OFL.txt"),
      ),
    ],
    ["THIRD_PARTY_NOTICES.txt", sections.join("\n") + "\n"],
    ["licenses/packages.json", JSON.stringify(inventory, null, 2) + "\n"],
  ];
}

let popupBuild: Promise<PackageFile[]> | undefined;
async function bundledPopupFiles() {
  if (!popupBuild) {
    popupBuild = (async () => {
      const directory = await mkdtemp(
        join(tmpdir(), "budetoffer-companion-popup-"),
      );
      try {
        const { build } = await import("vite");
        const renderedModules = new Set<string>();
        await build({
          configFile: join(source, "vite.config.ts"),
          logLevel: "error",
          build: { outDir: directory, emptyOutDir: false },
          plugins: [
            {
              name: "companion-bundled-component-notices",
              generateBundle(_options, bundle) {
                for (const output of Object.values(bundle)) {
                  if (output.type === "chunk") {
                    for (const [id, module] of Object.entries(output.modules)) {
                      if (module.renderedLength > 0) renderedModules.add(id);
                    }
                  }
                }
              },
            },
          ],
        });
        const names = await readdir(directory, { recursive: true });
        const files: PackageFile[] = [];
        for (const name of names) {
          const file = join(directory, name);
          const info = await lstat(file);
          if (!info.isFile()) continue;
          if (
            name !== "index.html" &&
            !/^assets\/[A-Za-z0-9._-]+\.(?:js|css|ttf|woff2?|svg|png)$/u.test(
              name,
            )
          ) {
            throw new Error("unexpected_popup_build_file");
          }
          files.push([`popup/${name}`, await readFile(file)]);
        }
        if (!files.some(([name]) => name === "popup/index.html")) {
          throw new Error("popup_build_missing");
        }
        return [...files, ...(await popupNotices([...renderedModules].sort()))];
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    })().catch((error) => {
      popupBuild = undefined;
      throw error;
    });
  }
  return popupBuild;
}

function serverOrigin(value: unknown) {
  if (typeof value !== "string" || value.length > 2048) {
    throw new Error("invalid_server_origin");
  }
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("invalid_server_origin");
  }
  if (
    url.protocol !== "https:" ||
    value !== url.origin ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash ||
    url.hostname.includes("*") ||
    !/^[a-z0-9.-]+$/u.test(url.hostname) ||
    url.hostname.endsWith(".")
  ) {
    throw new Error("invalid_server_origin");
  }
  return url;
}

async function readCompanionManifest() {
  const value: unknown = JSON.parse(
    await readFile(join(source, "manifest.json"), "utf8"),
  );
  if (
    !record(value) ||
    value.manifest_version !== 3 ||
    typeof value.name !== "string" ||
    typeof value.version !== "string" ||
    !/^\d+\.\d+\.\d+$/u.test(value.version) ||
    typeof value.minimum_chrome_version !== "string" ||
    !/^\d+$/u.test(value.minimum_chrome_version) ||
    !Array.isArray(value.host_permissions) ||
    !value.host_permissions.every((host: unknown) => typeof host === "string")
  ) {
    throw new Error("invalid_companion_manifest");
  }
  return {
    ...value,
    version: value.version,
    minimum_chrome_version: value.minimum_chrome_version,
  };
}

export async function createScopedServerCompanionManifest(origin: unknown) {
  const url = serverOrigin(origin);
  const manifest = await readCompanionManifest();
  return {
    ...manifest,
    name: "BudetOffer Server Companion",
    description: `BudetOffer companion for ${url.origin}.`,
    host_permissions: [
      `https://${url.hostname}:${url.port || "443"}/*`,
      "https://hh.ru/*",
      "https://*.hh.ru/*",
    ],
  };
}

/** Separate MV3 modules preserve the lexical scope of Chrome's injected functions. */
async function runtimeFiles(): Promise<PackageFile[]> {
  const configuration = ts.readConfigFile(
    join(source, "tsconfig.runtime.json"),
    ts.sys.readFile,
  );
  if (configuration.error) {
    throw new Error(
      ts.flattenDiagnosticMessageText(configuration.error.messageText, "\n"),
    );
  }
  const directory = await mkdtemp(
    join(tmpdir(), "budetoffer-companion-runtime-"),
  );
  try {
    const config = ts.parseJsonConfigFileContent(
      configuration.config,
      ts.sys,
      source,
      { outDir: directory },
    );
    const program = ts.createProgram(config.fileNames, config.options);
    const diagnostics = [
      ...config.errors,
      ...ts.getPreEmitDiagnostics(program),
    ];
    if (diagnostics.length) {
      throw new Error(
        ts.formatDiagnosticsWithColorAndContext(diagnostics, {
          getCanonicalFileName: (file) => file,
          getCurrentDirectory: () => workspace,
          getNewLine: () => "\n",
        }),
      );
    }
    for (const module of program
      .getSourceFiles()
      .filter((file) => !file.isDeclarationFile)) {
      const file = module.fileName;
      if (
        !file.startsWith(source) ||
        (await realpath(file)) !== file ||
        !(await lstat(file)).isFile()
      ) {
        throw new Error("invalid_companion_runtime_source");
      }
    }
    const result = program.emit();
    if (result.emitSkipped || result.diagnostics.length) {
      throw new Error("companion_runtime_emit_failed");
    }
    const names = (await readdir(directory, { recursive: true })).sort();
    return await Promise.all(
      names
        .filter(
          (name) => name.endsWith(".js") && name !== "shared/destinations.js",
        )
        .map(async (name) => {
          if (!/^(?:background|hh|shared|popup)\/[a-z0-9-]+\.js$/u.test(name)) {
            throw new Error("unexpected_companion_runtime_file");
          }
          const file = join(directory, name);
          if (!(await lstat(file)).isFile()) {
            throw new Error("invalid_companion_runtime_file");
          }
          return [name, await readFile(file)] as const;
        }),
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function writeCompanionPackage({
  origin,
  outputDir,
  local = false,
}: PackageOptions) {
  const manifest = local
    ? await readCompanionManifest()
    : await createScopedServerCompanionManifest(origin);
  if (
    typeof outputDir !== "string" ||
    !isAbsolute(outputDir) ||
    resolve(outputDir) !== outputDir
  ) {
    throw new Error("output_requires_canonical_absolute_path");
  }
  const parent = dirname(outputDir);
  if ((await realpath(parent)) !== parent) {
    throw new Error("output_parent_symlink");
  }
  const parentStat = await lstat(parent);
  if (
    !parentStat.isDirectory() ||
    parentStat.uid !== process.getuid?.() ||
    parentStat.mode & 0o022
  ) {
    throw new Error("output_parent_not_owned_private");
  }
  // Never overwrite or reuse an existing directory (even empty), nor follow links.
  // Materialize the entire fixed public file set before creating any output.
  const contents: PackageFile[] = await Promise.all(
    publicFiles
      .filter((path) => !path.endsWith(".js"))
      .map(async (path) => {
        const file = join(source, path);
        if ((await realpath(file)) !== file || !(await lstat(file)).isFile()) {
          throw new Error("invalid_package_source");
        }
        return [path, await readFile(file)] as const;
      }),
  );
  const popup = await bundledPopupFiles();
  await mkdir(outputDir, { mode: 0o700 });
  const cabinet = local ? "http://127.0.0.1:6971" : origin;
  const files: PackageFile[] = [
    ...contents,
    ...(await runtimeFiles()),
    ...popup,
    ["manifest.json", JSON.stringify(manifest, null, 2) + "\n"],
    [
      "shared/destinations.js",
      `// Static public deployment configuration; no credentials.\nexport const SERVER_ORIGIN = ${JSON.stringify(local ? null : origin)};\nexport const COMPANION_ORIGINS = Object.freeze(${JSON.stringify(local ? ["http://127.0.0.1:6970", cabinet] : [origin])});\n`,
    ],
  ];
  const documentConfig = `// Build-controlled public document links; no credentials.\nexport const COMPANION_ONBOARDING = Object.freeze(${JSON.stringify({ version: "2026-10-10", termsUrl: `${cabinet}/legal/terms`, privacyUrl: `${cabinet}/legal/privacy` })});\n`;
  for (const [path, content] of files) {
    await mkdir(dirname(join(outputDir, path)), {
      recursive: true,
      mode: 0o700,
    });
    await writeFile(
      join(outputDir, path),
      path === "shared/onboarding.js" ? documentConfig : content,
      { flag: "wx", mode: 0o600 },
    );
  }
  return { outputDir, origin, files: files.length };
}

export const packageCompanion = (options: {
  origin: string;
  outputDir: string;
}) => writeCompanionPackage(options);
export const packageLocalCompanion = (options: { outputDir: string }) =>
  writeCompanionPackage({ ...options, origin: null, local: true });

// Reuse the public allowlist and bundled popup; never zip the source workspace.
export async function createCompanionArchive({ origin }: { origin: string }) {
  const stage = await mkdtemp(
    join(await realpath(tmpdir()), "budetoffer-companion-archive-"),
  );
  try {
    const folder = "budetoffer-chrome";
    const outputDir = join(stage, folder);
    await packageCompanion({ origin, outputDir });
    const entries: [string, Uint8Array][] = [];
    for (const name of (await readdir(outputDir, { recursive: true })).sort()) {
      const file = join(outputDir, name);
      if ((await lstat(file)).isFile()) {
        entries.push([
          `${folder}/${name}`,
          new Uint8Array(await readFile(file)),
        ]);
      }
    }
    entries.push([
      `${folder}/INSTALL.txt`,
      strToU8(
        `BudetOffer — расширение для Chrome\nКабинет: ${origin}\n\nУстановка на компьютере (Chrome 120 или новее):\n1. Распакуйте архив и сохраните папку budetoffer-chrome на компьютере.\n2. Вставьте chrome://extensions в адресную строку Chrome.\n3. Включите «Режим разработчика».\n4. Нажмите «Загрузить распакованное расширение» и выберите папку budetoffer-chrome, в которой находится manifest.json.\n5. Откройте расширение BudetOffer и нажмите «Получить код входа». Войдите в ${origin}/profile?view=connections#companion-devices и подтвердите этот код. Завершите настройку в расширении.\n6. Войдите в свой аккаунт HH в этом Chrome. Вернитесь в ${origin}/profile?view=resume#base-resume и укажите ссылку на своё резюме.\n\nНа телефоне можно открыть кабинет и подтвердить код, а расширение устанавливается в Chrome на компьютере. Оставляйте компьютер и Chrome включёнными во время выполнения заданий.\nНе удаляйте папку после установки. Для обновления замените её содержимое новой версией и нажмите кнопку обновления расширения на chrome://extensions.\n`,
      ),
    ]);
    return zipSync(Object.fromEntries(entries), {
      level: 9,
      mtime: new Date(2026, 0, 1),
    });
  } finally {
    await rm(stage, { recursive: true, force: true });
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const [origin, outputDir, ...extra] = process.argv.slice(2);
  if (!origin || !outputDir || extra.length) {
    console.error(
      "Usage: node scripts/package-companion.ts <canonical-https-origin|--local> <new-absolute-output-directory>",
    );
    process.exitCode = 1;
  } else {
    try {
      console.log(
        JSON.stringify(
          await (origin === "--local"
            ? packageLocalCompanion({ outputDir })
            : packageCompanion({ origin, outputDir })),
        ),
      );
    } catch (error) {
      console.error(`Companion package failed: ${errorCode(error)}`);
      process.exitCode = 1;
    }
  }
}
