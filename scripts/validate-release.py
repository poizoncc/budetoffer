#!/usr/bin/env python3
"""Validate the public, prebuilt Chrome package without installing dependencies."""

import argparse
import hashlib
from html.parser import HTMLParser
import json
from pathlib import Path, PurePosixPath
import re
import stat
import sys
from urllib.parse import urlsplit
import zipfile

ORIGIN = "https://my.budetoffer.ru"
ARCHIVE = "budetoffer-chrome.zip"
PREFIX = "budetoffer-chrome/"
HH_SCOPES = {"https://hh.ru/*", "https://*.hh.ru/*"}
PERMISSIONS = {"activeTab", "storage", "scripting", "alarms"}
STATIC_FILES = {
    "INSTALL.txt", "LICENSE", "THIRD_PARTY_NOTICES.txt", "licenses/PTSans-OFL.txt", "licenses/packages.json", "manifest.json",
    "assets/budetoffer-logo.svg", "assets/budetoffer-icon-16.png", "assets/budetoffer-icon-32.png",
    "assets/budetoffer-icon-48.png", "assets/budetoffer-icon-128.png",
    "background/bootstrap.js", "background/transport.js", "background/checkpoint-store.js",
    "background/service-worker.js", "background/execution.js", "background/application-execution.js",
    "background/device-login.js", "background/onboarding.js", "background/tab-state.js",
    "background/mutation.js", "background/publication.js", "hh/account.js", "hh/actions.js",
    "hh/content.js", "hh/cabinet-connect.js", "hh/executor.js", "hh/outcomes.js", "hh/full-history.js", "hh/history-account.js", "hh/chat-snapshot.js",
    "hh/history-limits.js", "hh/response-form.js", "popup/controller.js", "popup/index.html",
    "shared/config.js", "shared/destinations.js", "shared/onboarding.js",
    "shared/record.js", "shared/companion-protocol.js", "shared/chrome-api.js", "shared/ewans.js",
}
POPUP_ASSET = re.compile(r"popup/assets/[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*\.(?:js|css|ttf|woff2?|svg|png)\Z")


class ValidationError(ValueError):
    pass


def require(condition, message):
    if not condition:
        raise ValidationError(message)


def unique_object(pairs):
    result = {}
    for key, value in pairs:
        require(key not in result, f"Duplicate JSON key: {key}")
        result[key] = value
    return result


def read_json(data):
    return json.loads(data, object_pairs_hook=unique_object)


def local_file(value, files, parent=""):
    require(isinstance(value, str) and value, "Missing local file reference")
    parsed = urlsplit(value)
    require(not parsed.scheme and not parsed.netloc and not parsed.query and not parsed.fragment,
            f"Non-local file reference: {value}")
    require(not value.startswith("/") and "\\" not in value, f"Unsafe file reference: {value}")
    parts = value.split("/")
    require(".." not in parts and not any(part == "" for part in parts), f"Unsafe file reference: {value}")
    path = str(PurePosixPath(parent, value))
    require(path in files and files[path], f"Missing installed file: {path}")
    return path


class PopupAssets(HTMLParser):
    def __init__(self):
        super().__init__()
        self.scripts = []
        self.styles = []

    def handle_starttag(self, tag, attrs):
        values = dict(attrs)
        if tag == "script":
            require(values.get("type") == "module" and values.get("src"), "Popup must use a local module entrypoint")
            self.scripts.append(values["src"])
        elif tag == "link" and values.get("rel") in {"stylesheet", "modulepreload"}:
            self.styles.append(values.get("href"))


def read_archive(path):
    files = {}
    names = set()
    with zipfile.ZipFile(path) as archive:
        entries = archive.infolist()
        require(0 < len(entries) <= 200, "Unexpected ZIP entry count")
        require(sum(entry.file_size for entry in entries) <= 50_000_000, "ZIP is too large when unpacked")
        for entry in entries:
            name = entry.filename
            parts = name.rstrip("/").split("/")
            require(name.startswith(PREFIX) and "\\" not in name and "\x00" not in name
                    and not any(part in {"", ".", ".."} for part in parts), f"Unsafe ZIP path: {name}")
            require(name.casefold() not in names, f"Duplicate ZIP path: {name}")
            names.add(name.casefold())
            mode = stat.S_IFMT(entry.external_attr >> 16)
            require(mode in {0, stat.S_IFREG, stat.S_IFDIR}, f"ZIP special file or symlink: {name}")
            require(not entry.flag_bits & 1, "Encrypted ZIP entries are unsupported")
            require(entry.file_size <= 10_000_000, f"ZIP entry too large: {name}")
            relative = name[len(PREFIX):]
            if entry.is_dir():
                require(mode != stat.S_IFREG and not entry.file_size, f"Invalid ZIP directory: {name}")
                continue
            require(mode != stat.S_IFDIR, f"Invalid ZIP file: {name}")
            require(relative in STATIC_FILES or POPUP_ASSET.fullmatch(relative), f"Unexpected or private ZIP file: {name}")
            files[relative] = archive.read(entry)
    for name in STATIC_FILES:
        require(name in files and files[name], f"Missing packaged file: {name}")
    return files


def validate_manifest(files, release):
    manifest = read_json(files["manifest.json"])
    require(isinstance(manifest, dict) and manifest.get("manifest_version") == 3, "Expected Manifest V3")
    require(manifest.get("version") == release["version"], "Manifest version differs from release.json")
    require(manifest.get("minimum_chrome_version") == release["chromeMinimumVersion"], "Chrome minimum version differs from release.json")
    permissions = manifest.get("permissions")
    require(isinstance(permissions, list) and len(permissions) == len(PERMISSIONS)
            and set(permissions) == PERMISSIONS, "Unexpected extension permissions")
    hosts = manifest.get("host_permissions")
    require(isinstance(hosts, list) and len(hosts) == 3, "Unexpected host permissions")
    require(set(hosts) in (HH_SCOPES | {ORIGIN + "/*"}, HH_SCOPES | {ORIGIN + ":443/*"}), "Host permissions exceed the cabinet and HH")
    for name in ("optional_permissions", "optional_host_permissions"):
        require(not manifest.get(name), f"Unexpected {name}")
    require(not manifest.get("externally_connectable") and not manifest.get("web_accessible_resources"), "Unexpected externally accessible extension resources")
    background = manifest.get("background", {})
    require(background.get("type") == "module" and background.get("service_worker") == "background/bootstrap.js", "Unexpected background entrypoint")
    local_file(background["service_worker"], files)
    action = manifest.get("action", {})
    require(action.get("default_popup") == "popup/index.html", "Unexpected popup entrypoint")
    local_file(action["default_popup"], files)
    for icons in (manifest.get("icons", {}), action.get("default_icon", {})):
        require(isinstance(icons, dict) and icons, "Missing extension icons")
        for name in icons.values():
            local_file(name, files)
    scripts = manifest.get("content_scripts")
    require(isinstance(scripts, list) and len(scripts) == 2
            and all(isinstance(script, dict) for script in scripts), "Unexpected content scripts")
    hh_scripts = [script for script in scripts if script.get("js") == ["hh/content.js"]]
    cabinet_scripts = [script for script in scripts if script.get("js") == ["hh/cabinet-connect.js"]]
    require(len(hh_scripts) == 1 and len(cabinet_scripts) == 1, "Unexpected content script entrypoints")
    script = hh_scripts[0]
    require(isinstance(script.get("matches"), list) and len(script["matches"]) == 2
            and set(script["matches"]) == HH_SCOPES, "Content scripts must be scoped to HH")
    require(script.get("js") == ["hh/content.js"] and not script.get("css"), "Unexpected content script entrypoint")
    local_file("hh/content.js", files)
    cabinet_script = cabinet_scripts[0]
    require(cabinet_script.get("matches") == [ORIGIN + "/*"]
            and not cabinet_script.get("css"), "Cabinet bridge must be scoped to the cabinet")
    for script in scripts:
        require(script.get("run_at") == "document_idle"
                and script.get("all_frames", False) is False
                and script.get("world", "ISOLATED") == "ISOLATED", "Unexpected content script execution context")
    local_file("hh/cabinet-connect.js", files)
    popup = PopupAssets()
    popup.feed(files["popup/index.html"].decode("utf-8"))
    require(popup.scripts, "Missing built popup module")
    for name in popup.scripts + popup.styles:
        local_file(name, files, "popup")
    destinations = files["shared/destinations.js"].decode("utf-8")
    origin = re.search(r"export const SERVER_ORIGIN = (\"[^\"]+\");", destinations)
    origins = re.search(r"export const COMPANION_ORIGINS = Object\.freeze\((\[[^\]]*\])\);", destinations)
    require(origin and origins and read_json(origin[1]) == ORIGIN and read_json(origins[1]) == [ORIGIN], "Packaged server origin differs from release.json")


def validate_release(root, tag=None):
    distribution = Path(root) / "distribution"
    release = read_json((distribution / "release.json").read_bytes())
    require(isinstance(release, dict) and set(release) == {"formatVersion", "version", "origin", "fileName", "sha256", "size", "chromeMinimumVersion"}, "Unexpected release.json fields")
    require(type(release["formatVersion"]) is int and release["formatVersion"] == 1, "Unsupported release metadata format")
    require(release["fileName"] == ARCHIVE, "Unexpected release archive filename")
    version = release["version"]
    require(isinstance(version, str) and re.fullmatch(r"(?:0|[1-9]\d*)(?:\.(?:0|[1-9]\d*)){0,3}", version), "Invalid Chrome version")
    require(all(int(part) <= 65535 for part in version.split(".")) and any(int(part) for part in version.split(".")), "Invalid Chrome version components")
    require(release["origin"] == ORIGIN, "Release origin must be the public cabinet")
    require(isinstance(release["chromeMinimumVersion"], str) and re.fullmatch(r"[1-9]\d{1,3}(?:\.\d+){0,3}", release["chromeMinimumVersion"]), "Invalid Chrome minimum version")
    require(isinstance(release["sha256"], str) and re.fullmatch(r"[a-f0-9]{64}", release["sha256"]), "Invalid SHA256")
    require(type(release["size"]) is int and 0 < release["size"] <= 10_000_000, "Invalid archive size")
    require(tag is None or tag == f"v{version}", "Release tag differs from the packaged version")
    path = distribution / ARCHIVE
    require(path.is_file() and not path.is_symlink(), "Missing regular distribution ZIP")
    require(path.stat().st_size == release["size"], "ZIP size differs from release.json")
    digest = hashlib.sha256(path.read_bytes()).hexdigest()
    require(digest == release["sha256"], "ZIP SHA256 differs from release.json")
    sums = (distribution / "SHA256SUMS").read_text("utf-8").strip()
    require(sums == f"{digest}  {ARCHIVE}", "SHA256SUMS must contain the single ZIP checksum")
    validate_manifest(read_archive(path), release)
    return release


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--tag", help="Require a tag matching v{version}")
    args = parser.parse_args()
    try:
        release = validate_release(Path(__file__).resolve().parent.parent, args.tag)
    except (ValidationError, OSError, UnicodeError, json.JSONDecodeError, zipfile.BadZipFile, TypeError, KeyError) as error:
        print(f"Release validation failed: {error}", file=sys.stderr)
        return 1
    print(f"Validated BudetOffer Chrome {release['version']}: {release['size']} bytes, SHA256 {release['sha256']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
