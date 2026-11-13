"""Local deployment regressions; fake Docker/setup only, never a real host."""
import base64
import contextlib
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import stat
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch
from urllib.parse import quote
import warnings
import zipfile

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "DEPLOY-TRUCKLOG-LINUX.py"
spec = importlib.util.spec_from_file_location("trucklog_deployment", SCRIPT)
deploy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(deploy)


class LinuxDeploymentTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.stage = self.root / "private-stage"
        self.stage.mkdir(mode=0o700)
        self.source_env = self.stage / "old.env"
        self.archive = self.stage / "TruckLog.zip"
        self.calls = self.root / "docker-calls.jsonl"
        self.bin = self.root / "bin"
        self.bin.mkdir()
        fake = self.bin / "docker"
        fake.write_text("#!" + sys.executable + "\nimport json,sys\nfrom pathlib import Path\n"
                        + "p=Path(" + repr(str(self.calls)) + ")\n"
                        + "with p.open('a') as f: f.write(json.dumps(sys.argv[1:])+'\\n')\n"
                        + "print('healthy' if sys.argv[1:2]==['inspect'] else 'fixture Docker operation completed')\n")
        fake.chmod(0o700)
        self.env = dict(os.environ, PATH=str(self.bin) + os.pathsep + os.environ.get("PATH", os.defpath),
                        DOCKER_HOST="ssh://stale-host", DOCKER_CONTEXT="wrong-context", DOCKER_TLS_VERIFY="1",
                        DOCKER_CERT_PATH="/stale/certs", DOCKER_CONFIG="/fixture/docker-config", HTTP_PROXY="http://fixture-proxy:8080",
                        TRUCK_LOG_DATABASE_PASSWORD="STALE_ENV_VALUE", TRUCK_LOG_RELEASE="0.0.0", COMPOSE_FILE="/stale.yml")

    def env_file(self, password="real-existing-password", https=False, transport=True):
        text = "TRUCK_LOG_DATABASE_USERNAME=api\nTRUCK_LOG_DATABASE_PASSWORD='" + password + "'\nTRUCK_LOG_DATABASE_NAME=TruckLog\n"
        if https:
            certs = self.root / "tls"
            certs.mkdir(exist_ok=True)
            (certs / "fullchain.pem").write_text("fixture certificate")
            (certs / "privkey.pem").write_text("fixture key")
            text += "TRUCK_LOG_PUBLIC_ORIGIN=https://trucklog.example.test\nTRUCK_LOG_ADMIN_PROXY_KEY=" + "b" * 64 + "\nTRUCK_LOG_TLS_CERT_DIR=" + str(certs) + "\n"
            if transport:
                text += "TRUCK_LOG_ADMIN_TRANSPORT=https\n"
        self.source_env.write_text(text)
        return text

    def bundle(self, exit_code=0, extra=None, bad_manifest=False):
        fixture = """import base64,json,os,sys
from pathlib import Path
keys=['DOCKER_HOST','DOCKER_CONTEXT','DOCKER_TLS_VERIFY','DOCKER_CERT_PATH','DOCKER_CONFIG','HTTP_PROXY','TRUCK_LOG_RELEASE','COMPOSE_FILE']
Path('child-environment.json').write_text(json.dumps({k:os.environ.get(k) for k in keys}))
p=Path('.env')
new='c'*64
with p.open('a') as f:f.write('TRUCK_LOG_PRINT_CLAIM_TOKEN_SECRET='+new+'\\n')
print('generated diagnostic '+base64.b64encode(new.encode()).decode())
print('USEFUL fixture error on stderr',file=sys.stderr)
""" + "print(json.dumps({'diagnostic': " + repr(getattr(self, "diagnostic", "not-secret")) + "}),file=sys.stderr)\nraise SystemExit(" + str(exit_code) + ")\n"
        contents = {"truck-log/VERSION": b"1.0.3\n", "truck-log/SETUP-TRUCK-LOG.sh": b"#!/bin/sh\n./tools/check.sh\npython3 fixture.py\n",
                    "truck-log/tools/check.sh": b"#!/bin/sh\ndocker info --format '{{.OSType}}'\n", "truck-log/fixture.py": fixture.encode(),
                    "truck-log/docker-compose.yml": b"services: {}\n", "truck-log/docker-compose.https.yml": b"services: {}\n"}
        if extra:
            contents.update(extra)
        manifest = "".join(("0" * 64 if bad_manifest and name.endswith("fixture.py") else hashlib.sha256(data).hexdigest()) + "  " + name + "\n" for name, data in sorted(contents.items()))
        with zipfile.ZipFile(self.archive, "w", zipfile.ZIP_DEFLATED) as bundle:
            for name, data in contents.items():
                bundle.writestr(name, data)
            bundle.writestr("SHA256SUMS.txt", manifest)
        return hashlib.sha256(self.archive.read_bytes()).hexdigest()

    def run_deploy(self, digest=None):
        return subprocess.run([sys.executable, str(SCRIPT), "--archive", str(self.archive), "--env-file", str(self.source_env),
                               "--sha256", digest or hashlib.sha256(self.archive.read_bytes()).hexdigest()],
                              env=self.env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, timeout=20)

    def test_http_preserves_credentials_permissions_local_docker_and_generated_secret_redaction(self):
        original = self.env_file()
        self.bundle()
        result = self.run_deploy()
        self.assertEqual(result.returncode, 0, result.stdout)
        app = self.stage / "release/truck-log"
        self.assertEqual(self.source_env.read_text(), original)
        self.assertTrue((app / ".env").read_text().startswith(original))
        self.assertEqual(stat.S_IMODE((app / ".env").stat().st_mode), 0o600)
        self.assertEqual(stat.S_IMODE((self.stage / "deploy.log").stat().st_mode), 0o600)
        self.assertTrue((app / "tools/check.sh").stat().st_mode & stat.S_IXUSR)
        self.assertEqual(stat.S_IMODE((app / "fixture.py").stat().st_mode), 0o644)
        self.assertEqual(stat.S_IMODE((app / "tools").stat().st_mode), 0o755)
        self.assertEqual(stat.S_IMODE(self.stage.stat().st_mode), 0o700)
        seen = json.loads((app / "child-environment.json").read_text())
        self.assertEqual(seen["DOCKER_HOST"], "unix:///var/run/docker.sock")
        for key in ("DOCKER_CONTEXT", "DOCKER_TLS_VERIFY", "DOCKER_CERT_PATH"):
            self.assertIsNone(seen[key])
        self.assertEqual(seen["DOCKER_CONFIG"], "/fixture/docker-config")
        self.assertEqual(seen["HTTP_PROXY"], "http://fixture-proxy:8080")
        self.assertEqual(seen["TRUCK_LOG_RELEASE"], "1.0.3")
        for output in (result.stdout, (self.stage / "deploy.log").read_text()):
            self.assertIn("USEFUL fixture error", output)
            self.assertNotIn("c" * 64, output)
            self.assertNotIn(base64.b64encode(b"c" * 64).decode(), output)

    def test_https_inferred_mode_and_password_healthy_do_not_corrupt_health_decisions(self):
        self.env_file("healthy", https=True, transport=False)
        self.bundle()
        result = self.run_deploy()
        self.assertEqual(result.returncode, 0, result.stdout)
        calls = [json.loads(line) for line in self.calls.read_text().splitlines()]
        self.assertTrue(any("docker-compose.https.yml" in call and "config" in call for call in calls))
        self.assertTrue(any("docker-compose.https.yml" in call and "--build" in call for call in calls))
        self.assertEqual(sum(call[0] == "inspect" for call in calls), 2)
        self.assertNotIn("healthy", (self.stage / "deploy.log").read_text())

    def test_real_child_error_code_and_escaped_secret_are_preserved_and_redacted(self):
        password = 'quote"slash\\secret$$part'
        self.env_file(password)
        self.diagnostic = password.replace("$$", "$")
        self.bundle(exit_code=27)
        result = self.run_deploy()
        self.assertEqual(result.returncode, 27)
        for output in (result.stdout, (self.stage / "deploy.log").read_text()):
            self.assertIn("USEFUL fixture error", output)
            self.assertNotIn(json.dumps(self.diagnostic)[1:-1], output)
            self.assertNotIn(self.diagnostic, output)

    def test_digest_or_manifest_failure_runs_no_code_and_copies_no_env(self):
        for invalid_digest in (True, False):
            with self.subTest(invalid_digest=invalid_digest):
                self.env_file()
                self.bundle(bad_manifest=not invalid_digest)
                result = self.run_deploy("0" * 64 if invalid_digest else None)
                self.assertNotEqual(result.returncode, 0)
                self.assertFalse(self.calls.exists())
                self.assertFalse((self.stage / "release/truck-log/.env").exists())
                (self.stage / "deploy.log").unlink()

    def test_zip_traversal_duplicates_symlinks_and_expansion_bounds(self):
        self.env_file()
        cases = ["../escape", "/absolute", "C:/drive", "folder\\escape", "folder/../escape"]
        for name in cases:
            with self.subTest(name=name):
                self.bundle(extra={name: b"bad"})
                with self.assertRaises(deploy.DeployError):
                    deploy.extract(self.archive, self.stage / "target")
        for kind in ("duplicate", "symlink", "budget"):
            with self.subTest(kind=kind), warnings.catch_warnings():
                warnings.simplefilter("ignore", UserWarning)
                with zipfile.ZipFile(self.archive, "w") as bundle:
                    bundle.writestr("item", b"a" * 20)
                    if kind == "duplicate":
                        bundle.writestr("item", b"b")
                    if kind == "symlink":
                        info = zipfile.ZipInfo("link")
                        info.create_system = 3
                        info.external_attr = (stat.S_IFLNK | 0o777) << 16
                        bundle.writestr(info, "../outside")
                with patch.object(deploy, "MAX_FILE", 8 if kind == "budget" else 1024), self.assertRaises(deploy.DeployError):
                    deploy.extract(self.archive, self.stage / "target")

    def test_redactor_variants_controls_ansi_and_context(self):
        secret = 'quote"slash\\secret$$π'
        self.env_file(secret)
        redactor = deploy.Redactor([self.source_env])
        for value in (secret, secret.replace("$$", "$"), quote(secret, safe=""), base64.b64encode(secret.encode()).decode(),
                      json.dumps(secret)[1:-1], repr(secret)[1:-1], "\x00".join(secret), "\x1b[31m" + secret + "\x1b[0m"):
            with self.subTest(value=value):
                self.assertNotIn(value.replace("\x00", ""), redactor.clean(value))
        self.assertNotIn("new-secret", redactor.clean("NEW_API_KEY=new-secret"))

    def test_oversized_native_line_is_suppressed_without_printing_any_prefix(self):
        self.env_file()
        redactor = deploy.Redactor([self.source_env])
        log = deploy.Log(self.stage / "long-line.log", redactor)
        console = io.StringIO()
        try:
            with contextlib.redirect_stdout(console):
                code, _ = deploy.run_logged([sys.executable, "-c", "print('PRIVATE-PREFIX'+('x'*70000));raise SystemExit(19)"], self.stage, self.env, log)
            self.assertEqual(code, 19)
        finally:
            log.close()
        for output in (console.getvalue(), (self.stage / "long-line.log").read_text()):
            self.assertNotIn("PRIVATE-PREFIX", output)
            self.assertIn("suppressed", output)

    def test_invalid_database_and_explicit_https_mismatch_fail_before_setup(self):
        for values in ({"TRUCK_LOG_DATABASE_USERNAME": "api", "TRUCK_LOG_DATABASE_PASSWORD": "CHANGE_ME", "TRUCK_LOG_DATABASE_NAME": "TruckLog"},
                       {"TRUCK_LOG_DATABASE_USERNAME": "api", "TRUCK_LOG_DATABASE_PASSWORD": "real", "TRUCK_LOG_DATABASE_NAME": "TruckLog", "TRUCK_LOG_PUBLIC_ORIGIN": "https://host", "TRUCK_LOG_ADMIN_TRANSPORT": "internal-http"}):
            with self.assertRaises(deploy.DeployError):
                deploy.validate_env(values)


if __name__ == "__main__":
    unittest.main(verbosity=2)
