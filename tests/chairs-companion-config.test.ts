import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { strFromU8, unzipSync } from "fflate";
import popupBuildConfig from "../apps/chrome-companion/vite.config.ts";
import {
  BFF_API_URL,
  BFF_BASE_URL,
  POPUP_COPY,
} from "../apps/chrome-companion/shared/config.ts";
import {
  COMPANION_ORIGINS,
  SERVER_ORIGIN,
} from "../apps/chrome-companion/shared/destinations.ts";
import { COMPANION_ONBOARDING } from "../apps/chrome-companion/shared/onboarding.ts";
import {
  createCompanionArchive,
  packageLocalCompanion,
} from "../scripts/package-companion.ts";

function property(value: unknown, key: string): unknown {
  assert.ok(value !== null && typeof value === "object");
  return Reflect.get(value, key);
}

function assertConfig(
  value: unknown,
  origin: string,
  offlineCode: string,
): void {
  assert.equal(property(value, "BFF_BASE_URL"), origin);
  assert.equal(property(value, "BFF_API_URL"), `${origin}/api/v1`);
  const offline = property(property(value, "POPUP_COPY"), "offline");
  assert.equal(typeof offline, "string");
  assert.ok(String(offline).endsWith(`(${offlineCode})`));
}

test("public source configuration uses the cabinet and catalogued network guidance", async () => {
  assert.equal(SERVER_ORIGIN, "https://my.budetoffer.ru");
  assert.deepEqual(COMPANION_ORIGINS, [SERVER_ORIGIN]);
  assertConfig(
    { BFF_BASE_URL, BFF_API_URL, POPUP_COPY },
    SERVER_ORIGIN,
    "BO-COMP-008",
  );
  assert.doesNotMatch(POPUP_COPY.offline, /локальн|запустите приложение/iu);
  assert.equal(COMPANION_ONBOARDING.termsUrl, `${BFF_BASE_URL}/legal/terms`);
  assert.equal(
    COMPANION_ONBOARDING.privacyUrl,
    `${BFF_BASE_URL}/legal/privacy`,
  );
  const manifest: unknown = JSON.parse(
    await readFile(
      new URL("../apps/chrome-companion/manifest.json", import.meta.url),
      "utf8",
    ),
  );
  assert.deepEqual(property(manifest, "host_permissions"), [
    "https://my.budetoffer.ru:443/*",
    "https://hh.ru/*",
    "https://*.hh.ru/*",
  ]);
  assert.equal(
    popupBuildConfig.build?.target,
    `chrome${String(property(manifest, "minimum_chrome_version"))}`,
  );
});

test("compiled configuration follows the packaged custom origin and retains local package support", async () => {
  const directory = await mkdtemp(
    join(await realpath(tmpdir()), "budetoffer-config-"),
  );
  try {
    await writeFile(
      join(directory, "package.json"),
      JSON.stringify({ type: "module" }),
    );
    const origin = "https://cabinet.example.test";
    const entries = unzipSync(await createCompanionArchive({ origin }));
    for (const name of ["config", "destinations", "ewans", "onboarding"]) {
      const file = `shared/${name}.js`;
      const content = entries[`budetoffer-chrome/${file}`];
      assert.ok(content, `missing compiled configuration dependency: ${file}`);
      const target = join(directory, "server", file);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, content);
    }
    const serverConfig: unknown = await import(
      pathToFileURL(join(directory, "server/shared/config.js")).href
    );
    assertConfig(serverConfig, origin, "BO-COMP-008");
    const onboardingModule: unknown = await import(
      pathToFileURL(join(directory, "server/shared/onboarding.js")).href
    );
    const onboarding = property(onboardingModule, "COMPANION_ONBOARDING");
    assert.equal(property(onboarding, "version"), COMPANION_ONBOARDING.version);
    assert.equal(property(onboarding, "termsUrl"), `${origin}/legal/terms`);
    assert.equal(property(onboarding, "privacyUrl"), `${origin}/legal/privacy`);
    const manifestBytes = entries["budetoffer-chrome/manifest.json"];
    const instructions = entries["budetoffer-chrome/INSTALL.txt"];
    assert.ok(manifestBytes && instructions);
    const packagedManifest: unknown = JSON.parse(strFromU8(manifestBytes));
    assert.ok(
      strFromU8(instructions).includes(
        `Chrome ${String(property(packagedManifest, "minimum_chrome_version"))} или новее`,
      ),
    );

    const localDirectory = join(directory, "local");
    await packageLocalCompanion({ outputDir: localDirectory });
    const localManifest: unknown = JSON.parse(
      await readFile(join(localDirectory, "manifest.json"), "utf8"),
    );
    assert.deepEqual(property(localManifest, "host_permissions"), [
      "http://127.0.0.1:6970/*",
      "http://127.0.0.1:6971/*",
      "https://hh.ru/*",
      "https://*.hh.ru/*",
    ]);
    const localConfig: unknown = await import(
      pathToFileURL(join(localDirectory, "shared/config.js")).href
    );
    assert.equal(
      property(localConfig, "BFF_BASE_URL"),
      "http://127.0.0.1:6970",
    );
    assert.equal(
      property(localConfig, "BFF_API_URL"),
      "http://127.0.0.1:6970/api/v1",
    );
    assert.equal(
      property(property(localConfig, "POPUP_COPY"), "offline"),
      "Локальное подключение недоступно. Запустите приложение и повторите проверку.",
    );
    const localDestinations: unknown = await import(
      pathToFileURL(join(localDirectory, "shared/destinations.js")).href
    );
    assert.equal(property(localDestinations, "SERVER_ORIGIN"), null);
    assert.deepEqual(property(localDestinations, "COMPANION_ORIGINS"), [
      "http://127.0.0.1:6970",
      "http://127.0.0.1:6971",
    ]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
