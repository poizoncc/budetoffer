import {createHash} from 'node:crypto';
import {mkdir, readFile, rm, writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {strFromU8, unzipSync} from 'fflate';
import {createCompanionArchive} from './package-companion.ts';

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

const directory = fileURLToPath(new URL('../build/', import.meta.url));
const origin = 'https://my.budetoffer.ru';
await mkdir(directory, {recursive: true});
const bytes = await createCompanionArchive({origin});
await writeFile(new URL('../build/budetoffer-chrome.zip', import.meta.url), bytes);
const sha256 = createHash('sha256').update(bytes).digest('hex');
await writeFile(new URL('../build/SHA256SUMS', import.meta.url), `${sha256}  budetoffer-chrome.zip\n`);
const entries = unzipSync(bytes);
await rm(new URL('../build/budetoffer-chrome/', import.meta.url), {recursive: true, force: true});
for (const [name, content] of Object.entries(entries)) {
  if (!/^budetoffer-chrome\/(?:[A-Za-z0-9._-]+\/)*[A-Za-z0-9._-]+$/u.test(name)) throw new Error('unsafe_build_path');
  const path = new URL(`../build/${name}`, import.meta.url);
  await mkdir(new URL('./', path), {recursive: true});
  await writeFile(path, content);
}
const manifestBytes = entries['budetoffer-chrome/manifest.json'];
if (!manifestBytes) throw new Error('missing_manifest');
const manifest: unknown = JSON.parse(strFromU8(manifestBytes));
const metadata: unknown = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
if (!record(manifest) || typeof manifest.version !== 'string' || typeof manifest.minimum_chrome_version !== 'string' || !record(metadata) || manifest.version !== metadata.version) throw new Error('version_mismatch');
await writeFile(new URL('../build/release.json', import.meta.url), JSON.stringify({formatVersion: 1, version: manifest.version, origin, fileName: 'budetoffer-chrome.zip', sha256, size: bytes.byteLength, chromeMinimumVersion: manifest.minimum_chrome_version}, null, 2) + '\n');
console.log(JSON.stringify({version: manifest.version, origin, sha256, archive: 'build/budetoffer-chrome.zip', unpacked: 'build/budetoffer-chrome'}));
