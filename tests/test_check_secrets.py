import importlib.util
import io
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest
import zipfile

MODULE_PATH = Path(__file__).resolve().parent.parent / "scripts" / "check-secrets.py"
SPEC = importlib.util.spec_from_file_location("check_secrets", MODULE_PATH)
checker = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(checker)


def archive(files):
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as opened:
        for name, content in files.items():
            opened.writestr(name, content)
    return output.getvalue()


class PublicFilePolicyTests(unittest.TestCase):
    def test_private_paths_and_zip_traversal_are_rejected(self):
        for name in (".env", ".env.production", ".npmrc", "input/account.json", "data/profile.json", "server.json", "keys/private.pem", "../escape.js"):
            with self.subTest(name=name), self.assertRaises(checker.ScanError):
                checker.validate_path(name)
        with self.assertRaises(checker.ScanError):
            checker.inspect_zip(archive({"../escape.js": "not a secret"}), "download.zip")

    def test_private_data_inside_nested_zip_is_rejected(self):
        nested = archive({"download/config.zip": archive({".env": "synthetic"})})
        with self.assertRaises(checker.ScanError):
            checker.inspect_zip(nested, "download.zip")

    def test_overdeep_archives_cannot_evade_scanner_coverage(self):
        nested = archive({"file.js": "console.log('safe');"})
        for _ in range(checker.MAX_ARCHIVE_DEPTH):
            nested = archive({"nested.zip": nested})
        with self.assertRaises(checker.ScanError):
            checker.inspect_zip(nested, "download.zip")

    def test_tracked_symlinks_are_rejected(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / "outside.js").write_text("synthetic", encoding="utf-8")
            (root / "public.js").symlink_to(root / "outside.js")
            with self.assertRaises(checker.ScanError):
                checker.snapshot(root, root / "snapshot", ["public.js"])


@unittest.skipUnless(shutil.which("gitleaks"), "Install the pinned Gitleaks to run scanner integration tests")
class GitleaksIntegrationTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="budetoffer-scanner-test-")
        self.root = Path(self.temporary.name)
        subprocess.run(["git", "init", "--quiet", str(self.root)], check=True)
        (self.root / ".gitleaks.toml").write_text("[extend]\nuseDefault = true\n", encoding="utf-8")

    def tearDown(self):
        self.temporary.cleanup()

    def stage(self):
        subprocess.run(["git", "-C", str(self.root), "add", "--all"], check=True)

    def test_runtime_token_variables_and_public_origins_are_not_secrets(self):
        (self.root / "transport.js").write_text(
            "const accessToken = await token();\n"
            "fetch('https://my.budetoffer.ru/api/v1/companion', {headers: {authorization: `Bearer ${accessToken}`}});\n",
            encoding="utf-8",
        )
        self.stage()
        self.assertEqual(checker.scan(self.root), 2)

    def test_realistic_credential_inside_nested_release_zip_fails_redacted(self):
        synthetic = "ghp_" + "aB3dE5fG7hI9jK1mN3pQ5rS7tU9vW1xY3zA5"
        data = archive({"extension/assets/inner.zip": archive({"credential.js": f"const apiKey = '{synthetic}';"})})
        (self.root / "release.zip").write_bytes(data)
        self.stage()
        with self.assertRaises(checker.ScanError) as context:
            checker.scan(self.root)
        self.assertIn("Potential secrets detected", str(context.exception))
        self.assertNotIn(synthetic, str(context.exception))

    def test_missing_scanner_fails_closed(self):
        with self.assertRaises(checker.ScanError):
            checker.scan(self.root, executable="budetoffer-nonexistent-secret-scanner")


if __name__ == "__main__":
    unittest.main()
