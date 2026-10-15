#!/usr/bin/env python3
"""Scan tracked public files and nested ZIP contents with pinned local Gitleaks."""

import argparse
import io
import json
from pathlib import Path, PurePosixPath
import shutil
import stat
import subprocess
import sys
import tempfile
import zipfile

GITLEAKS_VERSION = "8.30.1"
MAX_FILE_BYTES = 50_000_000
MAX_TOTAL_BYTES = 200_000_000
MAX_ARCHIVE_DEPTH = 3
PRIVATE_DIRECTORIES = {".git", ".ssh", "input", "node_modules", "data", "logs"}
PRIVATE_NAMES = {".npmrc", ".pypirc", ".netrc", "credentials.json", "control-secrets.json", "server.json", "installation.json"}
PRIVATE_SUFFIXES = {".pem", ".key", ".p12", ".pfx", ".jks", ".kdbx", ".sqlite", ".sqlite3", ".db", ".log"}


class ScanError(ValueError):
    pass


def validate_path(value):
    path = PurePosixPath(value)
    parts = value.split("/")
    if not value or value.startswith("/") or "\\" in value or "\x00" in value or any(part in {"", ".", ".."} for part in parts):
        raise ScanError(f"Unsafe public path: {value!r}")
    lowered = tuple(part.lower() for part in parts)
    if any(part in PRIVATE_DIRECTORIES for part in lowered):
        raise ScanError(f"Private directory is not publishable: {value}")
    if any(part == ".env" or part.startswith(".env.") for part in lowered) or lowered[-1] in PRIVATE_NAMES or path.suffix.lower() in PRIVATE_SUFFIXES:
        raise ScanError(f"Private configuration or data file is not publishable: {value}")


def inspect_zip(data, label, depth=1, budget=None):
    if depth > MAX_ARCHIVE_DEPTH:
        raise ScanError(f"Nested ZIP depth exceeds scanner coverage: {label}")
    if budget is None:
        budget = [MAX_TOTAL_BYTES]
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            entries = archive.infolist()
            if len(entries) > 2_000:
                raise ScanError(f"ZIP has too many entries: {label}")
            seen = set()
            for entry in entries:
                name = entry.filename.rstrip("/")
                validate_path(name)
                if name.casefold() in seen:
                    raise ScanError(f"Duplicate ZIP path: {label}!{name}")
                seen.add(name.casefold())
                mode = stat.S_IFMT(entry.external_attr >> 16)
                if mode not in {0, stat.S_IFREG, stat.S_IFDIR} or entry.flag_bits & 1:
                    raise ScanError(f"ZIP symlink, special file or encrypted entry: {label}!{name}")
                if entry.is_dir():
                    continue
                if entry.file_size > MAX_FILE_BYTES or entry.file_size > budget[0]:
                    raise ScanError(f"ZIP exceeds inspection size limit: {label}!{name}")
                budget[0] -= entry.file_size
                content = archive.read(entry)
                if content.startswith(b"PK\x03\x04") or name.lower().endswith(".zip"):
                    inspect_zip(content, f"{label}!{name}", depth + 1, budget)
    except (zipfile.BadZipFile, RuntimeError, NotImplementedError) as error:
        raise ScanError(f"Cannot inspect ZIP: {label}") from error


def public_files(root, include_untracked=False):
    arguments = ["git", "-C", str(root), "ls-files", "-z", "--cached"]
    if include_untracked:
        arguments += ["--others", "--exclude-standard"]
    names = subprocess.check_output(arguments).decode("utf-8").split("\0")
    return sorted(set(name for name in names if name))


def snapshot(root, destination, names):
    root = root.resolve()
    total = 0
    for name in names:
        validate_path(name)
        source = root / name
        if source.is_symlink() or source.resolve() != source.absolute() or not source.is_file():
            raise ScanError(f"Tracked file is missing or is not a regular file: {name}")
        size = source.stat().st_size
        total += size
        if size > MAX_FILE_BYTES or total > MAX_TOTAL_BYTES:
            raise ScanError(f"Public snapshot exceeds inspection size limit: {name}")
        content = source.read_bytes()
        if content.startswith(b"PK\x03\x04") or name.lower().endswith(".zip"):
            inspect_zip(content, name)
        target = destination / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(content)


def scan(root, executable="gitleaks", include_untracked=False):
    binary = shutil.which(executable)
    if binary is None:
        raise ScanError(f"Install Gitleaks {GITLEAKS_VERSION} before scanning; no files were declared clean")
    version = subprocess.check_output([binary, "version"], text=True).strip()
    if version.removeprefix("v") != GITLEAKS_VERSION:
        raise ScanError(f"Expected Gitleaks {GITLEAKS_VERSION}, got {version!r}")
    names = public_files(root, include_untracked)
    if not names:
        raise ScanError("No public files selected for scanning")
    config = root / ".gitleaks.toml"
    if not config.is_file():
        raise ScanError("Missing public Gitleaks configuration")
    with tempfile.TemporaryDirectory(prefix="budetoffer-public-scan-") as temporary:
        directory = Path(temporary)
        selected = directory / "snapshot"
        selected.mkdir()
        snapshot(root, selected, names)
        report = directory / "report.json"
        result = subprocess.run([
            binary, "dir", str(selected), "--config", str(config),
            "--redact=100", "--no-banner", "--no-color", "--ignore-gitleaks-allow",
            "--gitleaks-ignore-path", str(directory / "no-ignore-file"),
            "--max-archive-depth", str(MAX_ARCHIVE_DEPTH), "--max-decode-depth", "5",
            "--report-format", "json", "--report-path", str(report),
        ], capture_output=True, text=True, cwd=directory)
        if result.returncode not in {0, 1}:
            raise ScanError("Gitleaks did not complete; no files were declared clean")
        if not report.is_file():
            raise ScanError("Gitleaks did not produce its report; no files were declared clean")
        findings = json.loads(report.read_text("utf-8"))
        if result.returncode or findings:
            locations = []
            for finding in findings:
                location = str(finding.get("File", "unknown"))
                location = location.replace(str(selected) + "/", "")
                locations.append(f"{location}:{finding.get('StartLine', '?')} ({finding.get('RuleID', 'unknown')})")
            raise ScanError("Potential secrets detected (values redacted): " + "; ".join(locations))
    return len(names)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--gitleaks", default="gitleaks", help="Path to the pinned local scanner")
    parser.add_argument("--include-untracked", action="store_true", help="Also scan untracked non-ignored files while preparing a commit")
    args = parser.parse_args()
    try:
        count = scan(Path(__file__).resolve().parent.parent, args.gitleaks, args.include_untracked)
    except (ScanError, OSError, UnicodeError, subprocess.CalledProcessError, json.JSONDecodeError) as error:
        print(f"Public secret scan failed: {error}", file=sys.stderr)
        return 1
    print(f"Gitleaks {GITLEAKS_VERSION}: no secrets detected in {count} selected public files, including ZIP contents to depth {MAX_ARCHIVE_DEPTH}.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
