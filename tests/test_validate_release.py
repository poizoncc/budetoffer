import hashlib
import importlib.util
import json
from pathlib import Path
import stat
import tempfile
import unittest
import zipfile

spec = importlib.util.spec_from_file_location("validator", Path(__file__).parents[1] / "scripts/validate-release.py")
validator = importlib.util.module_from_spec(spec)
spec.loader.exec_module(validator)


class ValidateReleaseTest(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        (self.root / "distribution").mkdir()
        self.files = {name: b"synthetic packaged content" for name in validator.STATIC_FILES}
        self.manifest = {
            "manifest_version": 3, "version": "0.2.4", "minimum_chrome_version": "120",
            "permissions": sorted(validator.PERMISSIONS),
            "host_permissions": sorted(validator.HH_SCOPES | {validator.ORIGIN + ":443/*"}),
            "background": {"type": "module", "service_worker": "background/bootstrap.js"},
            "action": {"default_popup": "popup/index.html", "default_icon": {"16": "assets/budetoffer-icon-16.png"}},
            "icons": {"16": "assets/budetoffer-icon-16.png"},
            "content_scripts": [{"matches": sorted(validator.HH_SCOPES), "js": ["hh/content.js"]}],
        }
        self.files["popup/index.html"] = b'<script type="module" src="./assets/index-synthetic.js"></script>'
        self.files["popup/assets/index-synthetic.js"] = b"console.log('synthetic');"
        self.files["shared/destinations.js"] = (
            f'export const SERVER_ORIGIN = "{validator.ORIGIN}";\n'
            f'export const COMPANION_ORIGINS = Object.freeze(["{validator.ORIGIN}"]);\n'
        ).encode()

    def write(self, extra=None):
        self.files["manifest.json"] = json.dumps(self.manifest).encode()
        path = self.root / "distribution" / validator.ARCHIVE
        with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as archive:
            for name, content in self.files.items():
                archive.writestr(validator.PREFIX + name, content)
            if extra:
                archive.writestr(*extra)
        digest = hashlib.sha256(path.read_bytes()).hexdigest()
        release = {"formatVersion": 1, "fileName": validator.ARCHIVE, "version": "0.2.4", "origin": validator.ORIGIN, "sha256": digest,
                   "size": path.stat().st_size, "chromeMinimumVersion": "120"}
        self.metadata = self.root / "distribution/release.json"
        self.metadata.write_text(json.dumps(release))
        (self.root / "distribution/SHA256SUMS").write_text(f"{digest}  {validator.ARCHIVE}\n")
        return release

    def test_valid_scoped_package_and_matching_tag(self):
        self.write()
        self.assertEqual(validator.validate_release(self.root, "v0.2.4")["version"], "0.2.4")

    def test_wrong_hash_and_size(self):
        for field, value in [("sha256", "0" * 64), ("size", 1)]:
            with self.subTest(field=field):
                release = self.write()
                release[field] = value
                self.metadata.write_text(json.dumps(release))
                with self.assertRaises(validator.ValidationError):
                    validator.validate_release(self.root)

    def test_wrong_manifest_version_or_tag(self):
        self.manifest["version"] = "0.2.3"
        self.write()
        with self.assertRaisesRegex(validator.ValidationError, "Manifest version"):
            validator.validate_release(self.root)
        self.manifest["version"] = "0.2.4"
        self.write()
        with self.assertRaisesRegex(validator.ValidationError, "Release tag"):
            validator.validate_release(self.root, "v0.2.3")

    def test_unsafe_zip_paths_and_private_files(self):
        for name in ["/tmp/private", "../private", "budetoffer-chrome/../private", "budetoffer-chrome/input/cv.txt",
                     "budetoffer-chrome/.env", "budetoffer-chrome/shared/credentials.json", "budetoffer-chrome/popup/assets/index.js.map"]:
            with self.subTest(name=name):
                self.write((name, b"synthetic"))
                with self.assertRaises(validator.ValidationError):
                    validator.validate_release(self.root)

    def test_symlink_rejected(self):
        entry = zipfile.ZipInfo("budetoffer-chrome/popup/assets/link.js")
        entry.create_system = 3
        entry.external_attr = (stat.S_IFLNK | 0o777) << 16
        self.write((entry, b"../../../private"))
        with self.assertRaisesRegex(validator.ValidationError, "symlink"):
            validator.validate_release(self.root)

    def test_permission_expansion_rejected(self):
        for field, value in [("host_permissions", ["<all_urls>"]), ("permissions", ["debugger"]),
                             ("optional_host_permissions", ["https://example.invalid/*"])]:
            with self.subTest(field=field):
                manifest = self.manifest.copy()
                self.manifest[field] = value
                self.write()
                with self.assertRaises(validator.ValidationError):
                    validator.validate_release(self.root)
                self.manifest = manifest

    def test_license_and_built_popup_required(self):
        for name in ["LICENSE", "THIRD_PARTY_NOTICES.txt", "licenses/PTSans-OFL.txt", "licenses/packages.json", "popup/assets/index-synthetic.js"]:
            with self.subTest(name=name):
                value = self.files.pop(name)
                self.write()
                with self.assertRaises(validator.ValidationError):
                    validator.validate_release(self.root)
                self.files[name] = value

    def test_origin_and_destination_configuration(self):
        release = self.write()
        release["origin"] = "https://example.invalid"
        self.metadata.write_text(json.dumps(release))
        with self.assertRaisesRegex(validator.ValidationError, "origin"):
            validator.validate_release(self.root)
        self.files["shared/destinations.js"] = b'export const SERVER_ORIGIN = "https://example.invalid";'
        self.write()
        with self.assertRaisesRegex(validator.ValidationError, "origin"):
            validator.validate_release(self.root)


if __name__ == "__main__":
    unittest.main()
