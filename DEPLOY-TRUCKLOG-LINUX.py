#!/usr/bin/env python3
"""Deploy a verified Truck Log source archive on its Linux Docker host.

Only the Python standard library is needed. This preserves the supplied .env
and existing Docker volumes; it never bootstraps accounts, prunes or resets data.
"""
import argparse
import base64
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import stat
import subprocess
import sys
import time
from urllib.parse import quote, quote_plus, urlsplit
import zipfile

MAX_ARCHIVE = 256 * 1024 * 1024
MAX_FILE = 64 * 1024 * 1024
MAX_TOTAL = 768 * 1024 * 1024
MAX_FILES = 10000
MAX_LINE = 65536
SECRET_KEY = re.compile(r"PASSWORD|PASSWD|SECRET|TOKEN|CREDENTIAL|KEY", re.I)
ANSI = re.compile(r"\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b\[[0-?]*[ -/]*[@-~]")


class DeployError(Exception):
    pass


def regular(path, limit):
    info = path.lstat()
    if not stat.S_ISREG(info.st_mode) or info.st_size > limit:
        raise DeployError("A deployment input is not a regular file or exceeds its size limit.")
    return info


def dotenv(text):
    values = {}
    for line in text.splitlines():
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        match = re.fullmatch(r"([A-Za-z_][A-Za-z0-9_]*)=(.*)", line)
        if not match:
            raise DeployError("old.env must use plain KEY=value lines without export or multiline values.")
        key, raw = match.groups()
        if key in values:
            raise DeployError("Duplicate old.env key: " + key)
        raw = raw.strip()
        if raw.startswith(("'", '"')):
            delimiter, value, index = raw[0], "", 1
            while index < len(raw):
                char = raw[index]
                if char == delimiter:
                    if raw[index + 1:].strip() and not raw[index + 1:].lstrip().startswith("#"):
                        raise DeployError("Invalid quoted old.env value for " + key)
                    break
                if char == "\\" and index + 1 < len(raw):
                    following = raw[index + 1]
                    escapes = {'"': '"', "\\": "\\", "n": "\n", "r": "\r", "t": "\t"} if delimiter == '"' else {"'": "'"}
                    if following in escapes:
                        value += escapes[following]
                        index += 2
                        continue
                value += char
                index += 1
            else:
                raise DeployError("Unterminated old.env quote for " + key)
        else:
            value = re.split(r"\s+#", raw, maxsplit=1)[0].rstrip()
        if any(ord(char) < 32 or ord(char) == 127 for char in value):
            raise DeployError("Control characters in old.env value for " + key)
        values[key] = value
    return values


class Redactor:
    def __init__(self, paths):
        self.paths = paths
        self.secrets = set()
        self.refresh()

    def add(self, value):
        if not value:
            return
        for variant in (value, value.replace("$$", "$")):
            encoded = variant.encode("utf-8")
            self.secrets.update((variant, quote(variant, safe=""), quote_plus(variant),
                                 base64.b64encode(encoded).decode(), base64.urlsafe_b64encode(encoded).decode(),
                                 json.dumps(variant, ensure_ascii=True)[1:-1], json.dumps(variant, ensure_ascii=False)[1:-1], repr(variant)[1:-1]))
            for rendered in (quote(variant, safe=""), quote_plus(variant)):
                self.secrets.add(re.sub(r"%[0-9A-Fa-f]{2}", lambda match: match[0].lower(), rendered))
            self.secrets.update((base64.b64encode(encoded).decode().rstrip("="), base64.urlsafe_b64encode(encoded).decode().rstrip("=")))

    def refresh(self):
        for path in self.paths:
            try:
                text = path.read_text(encoding="utf-8-sig")
            except (OSError, UnicodeError):
                continue
            # Raw RHS matters: Compose interpolation errors can echo quotes and
            # comments from the original line, rather than its decoded value.
            for match in re.finditer(r"^([A-Za-z_][A-Za-z0-9_]*)=(.*)$", text, re.M):
                if SECRET_KEY.search(match[1]):
                    self.add(match[2].strip())
                    self.add(match[2].strip().strip("'\""))
            try:
                for key, value in dotenv(text).items():
                    if SECRET_KEY.search(key):
                        self.add(value)
            except DeployError:
                pass

    def clean(self, value):
        self.refresh()  # Setup may have just generated its missing signing key.
        value = ANSI.sub("", value).replace("\r", "")
        value = "".join(char for char in value if char in "\n\t" or ord(char) >= 32)
        for secret in sorted(self.secrets, key=len, reverse=True):
            value = value.replace(secret, "[REDACTED]")
        value = re.sub(r"(?i)(https?://[^\s/@:]+:)[^\s/@]+(@)", r"\1[REDACTED]\2", value)
        value = re.sub(r"(?i)((?:[A-Z0-9_]*(?:PASSWORD|PASSWD|SECRET|TOKEN|CREDENTIAL|KEY)[A-Z0-9_]*|authorization)\s*[:=]\s*).*", r"\1[REDACTED]", value)
        value = re.sub(r"(?i)\b[a-f0-9]{64}\b", "[REDACTED]", value)
        return value


class Log:
    def __init__(self, path, redactor):
        flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0)
        self.file = os.fdopen(os.open(path, flags, 0o600), "w", encoding="utf-8")
        self.redactor = redactor

    def write(self, text):
        clean = self.redactor.clean(str(text)).rstrip("\n")
        print(clean, flush=True)
        self.file.write(clean + "\n")
        self.file.flush()

    def close(self):
        self.file.close()


def member_path(name):
    if not name or "\\" in name or ":" in name or any(ord(char) < 32 or ord(char) == 127 for char in name):
        raise DeployError("Unsafe archive/manifest path.")
    name = name[:-1] if name.endswith("/") else name
    parts = name.split("/")
    if any(part in ("", ".", "..") for part in parts) or PurePosixPath(name).is_absolute():
        raise DeployError("Unsafe archive/manifest path.")
    if any(part in (".git", "node_modules", ".env") for part in parts):
        raise DeployError("Archive contains local runtime data instead of a clean release.")
    return name


def extract(archive, target):
    with zipfile.ZipFile(archive) as bundle:
        entries, seen, declared = [], set(), 0
        if len(bundle.infolist()) > MAX_FILES:
            raise DeployError("Archive has too many entries.")
        for info in bundle.infolist():
            if info.filename != info.orig_filename:
                raise DeployError("Archive filename contains a truncated or unsafe character.")
            name = member_path(info.filename)
            if name.casefold() in seen:
                raise DeployError("Duplicate archive path.")
            seen.add(name.casefold())
            kind = stat.S_IFMT(info.external_attr >> 16)
            if kind not in (0, stat.S_IFREG, stat.S_IFDIR) or bool(info.flag_bits & 1):
                raise DeployError("Archive links, special files and encryption are not supported.")
            if (kind == stat.S_IFDIR and not info.is_dir()) or (kind == stat.S_IFREG and info.is_dir()):
                raise DeployError("Archive entry type does not match its path.")
            if info.file_size > MAX_FILE:
                raise DeployError("Archive member exceeds its size limit.")
            declared += info.file_size
            if declared > MAX_TOTAL:
                raise DeployError("Archive exceeds its expanded size limit.")
            entries.append((info, name))
        target.mkdir(mode=0o700)  # Refuse to overwrite any previous extraction.
        actual = 0
        files = set()
        for info, name in entries:
            destination = target.joinpath(*name.split("/"))
            destination.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
            if info.is_dir():
                destination.mkdir(mode=0o700, exist_ok=True)
                continue
            flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0)
            written = 0
            with bundle.open(info) as source, os.fdopen(os.open(destination, flags, 0o600), "wb") as output:
                while True:
                    chunk = source.read(65536)
                    if not chunk:
                        break
                    written += len(chunk)
                    actual += len(chunk)
                    if written > min(info.file_size, MAX_FILE) or actual > MAX_TOTAL:
                        raise DeployError("Archive exceeded its declared extraction budget.")
                    output.write(chunk)
            if written != info.file_size:
                raise DeployError("Archive member size does not match its declaration.")
            files.add(name)
        return files


def verify_manifest(release, files):
    manifest = release / "SHA256SUMS.txt"
    regular(manifest, 4 * 1024 * 1024)
    listed = set()
    for line in manifest.read_text(encoding="utf-8").splitlines():
        match = re.fullmatch(r"([a-fA-F0-9]{64}) [ *](.+)", line)
        if not match:
            raise DeployError("Invalid SHA256SUMS.txt line.")
        digest, name = match.groups()
        name = member_path(name)
        if name == "SHA256SUMS.txt" or name in listed or name not in files:
            raise DeployError("Manifest has a duplicate, missing or self-referencing entry.")
        listed.add(name)
        if hashlib.sha256((release / name).read_bytes()).hexdigest() != digest.lower():
            raise DeployError("Release manifest verification failed for " + name)
    if listed != files - {"SHA256SUMS.txt"}:
        raise DeployError("Manifest does not cover every extracted file.")


def validate_env(values):
    for key in ("TRUCK_LOG_DATABASE_USERNAME", "TRUCK_LOG_DATABASE_PASSWORD", "TRUCK_LOG_DATABASE_NAME"):
        value = values.get(key, "").strip()
        if not value or re.search(r"(?i)^(?:change_?me|replace.*|your_.*|<.*>)$", value) or (key.endswith("PASSWORD") and value.lower() == "api"):
            raise DeployError("Existing credentials are missing or still a template: " + key)
    if any(key.startswith("COMPOSE_") or key in ("DOCKER_HOST", "DOCKER_CONTEXT", "DOCKER_TLS", "DOCKER_TLS_VERIFY", "DOCKER_CERT_PATH") for key in values):
        raise DeployError("Remove Docker endpoint/Compose control variables from old.env; deployment uses its verified local configuration.")
    origin = urlsplit(values.get("TRUCK_LOG_PUBLIC_ORIGIN", ""))
    mode = values.get("TRUCK_LOG_ADMIN_TRANSPORT", "https" if origin.scheme == "https" else "internal-http")
    if mode not in ("internal-http", "https"):
        raise DeployError("TRUCK_LOG_ADMIN_TRANSPORT must be internal-http or https.")
    if origin.username or origin.password or origin.query or origin.fragment or origin.path not in ("", "/"):
        raise DeployError("TRUCK_LOG_PUBLIC_ORIGIN must be an origin without credentials or a path.")
    if mode == "https":
        if origin.scheme != "https" or not origin.hostname:
            raise DeployError("HTTPS mode requires an https:// TRUCK_LOG_PUBLIC_ORIGIN.")
        if not re.fullmatch(r"[a-f0-9]{64}", values.get("TRUCK_LOG_ADMIN_PROXY_KEY", "")):
            raise DeployError("HTTPS mode requires a 64-character lowercase hex proxy key.")
        certificate_dir = Path(values.get("TRUCK_LOG_TLS_CERT_DIR", ""))
        if not certificate_dir.is_absolute() or not certificate_dir.is_dir():
            raise DeployError("HTTPS requires an absolute certificate directory on this Linux host.")
        for name in ("fullchain.pem", "privkey.pem"):
            path = certificate_dir / name
            if not path.is_file() or not os.access(path, os.R_OK) or path.stat().st_size == 0:
                raise DeployError("HTTPS certificate directory is missing a readable " + name)
    elif origin.scheme and origin.scheme != "http":
        raise DeployError("An HTTPS origin requires HTTPS transport and its certificate configuration.")
    claim = values.get("TRUCK_LOG_PRINT_CLAIM_TOKEN_SECRET", "")
    if claim and not re.fullmatch(r"[a-fA-F0-9]{64}", claim):
        raise DeployError("Existing print signing secret has an invalid format.")
    return mode == "https"


def child_environment(values, app, version):
    env = dict(os.environ)
    preserve = {"DOCKER_CONFIG", "HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "NO_PROXY", "http_proxy", "https_proxy", "all_proxy", "no_proxy"}
    for key in list(env):
        if key not in preserve and (key in values or key.startswith(("TRUCK_LOG_", "RXO_", "SMTP_", "COMPOSE_")) or key in ("DOCKER_CONTEXT", "DOCKER_TLS", "DOCKER_TLS_VERIFY", "DOCKER_CERT_PATH")):
            env.pop(key, None)
    env.update(DOCKER_HOST="unix:///var/run/docker.sock", TRUCK_LOG_RELEASE=version,
               COMPOSE_FILE=str(app / "docker-compose.yml"), COMPOSE_PROJECT_NAME="truck-log")
    return env


def run_logged(command, cwd, env, log):
    process = subprocess.Popen(command, cwd=str(cwd), env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                               text=True, encoding="utf-8", errors="replace", bufsize=1)
    captured = []
    try:
        while True:
            line = process.stdout.readline(MAX_LINE + 1)
            if not line:
                break
            if len(line) > MAX_LINE and not line.endswith("\n"):
                while line and not line.endswith("\n"):
                    line = process.stdout.readline(MAX_LINE + 1)
                log.write("[output line exceeded the limit and was suppressed]")
                continue
            log.write(line)
            # Raw text stays in memory only for exact control decisions (e.g.
            # a real password may coincidentally equal the word "healthy").
            captured.append(line)
            if len(captured) > 50:
                captured.pop(0)
    finally:
        process.stdout.close()
    code = process.wait()
    return (128 - code if code < 0 else code), "".join(captured)


def deploy(args):
    archive, original = Path(args.archive).absolute(), Path(args.env_file).absolute()
    stage = archive.parent
    info = stage.lstat()
    if not stat.S_ISDIR(info.st_mode) or info.st_uid != os.getuid() or stat.S_IMODE(info.st_mode) & 0o077 or original.parent != stage:
        raise DeployError("Archive and old.env must be in one private, user-owned directory with mode 0700.")
    regular(archive, MAX_ARCHIVE)
    regular(original, 1024 * 1024)
    os.chmod(original, 0o600)
    text = original.read_text(encoding="utf-8-sig").replace("\r\n", "\n")
    redactor = Redactor([original, stage / "release/truck-log/.env"])
    log = Log(stage / "deploy.log", redactor)
    try:
        values = dotenv(text)
        https = validate_env(values)
        if not re.fullmatch(r"[a-fA-F0-9]{64}", args.sha256) or hashlib.sha256(archive.read_bytes()).hexdigest() != args.sha256.lower():
            raise DeployError("Uploaded archive SHA256 does not match; no release code was run.")
        release = stage / "release"
        files = extract(archive, release)
        verify_manifest(release, files)
        log.write("[PASS] Archive digest and every release manifest entry verified.")
        app = release / "truck-log"
        regular(app / "SETUP-TRUCK-LOG.sh", MAX_FILE)
        version = (app / "VERSION").read_text(encoding="utf-8").strip()
        if not re.fullmatch(r"\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?", version):
            raise DeployError("Release VERSION is invalid.")
        # Public source/assets need readable modes inside built images (Nginx
        # workers are unprivileged). The enclosing staging directory stays0700.
        for path in release.rglob("*"):
            path.chmod(0o755 if path.is_dir() or path.suffix == ".sh" else 0o644)
        flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0)
        with os.fdopen(os.open(app / ".env", flags, 0o600), "w", encoding="utf-8", newline="\n") as output:
            output.write(text)
        if not shutil.which("docker") or not shutil.which("sh"):
            raise DeployError("This Linux host requires Docker Engine/CLI, Compose v2 and sh.")
        env = child_environment(values, app, version)
        log.write("[INFO] Running setup on the Linux host using its local Docker socket.")
        code, _ = run_logged(["sh", "SETUP-TRUCK-LOG.sh"] + (["--no-start"] if https else []), app, env, log)
        if code:
            return code
        if https:
            compose = ["docker", "compose", "--env-file", ".env", "-f", "docker-compose.yml", "-f", "docker-compose.https.yml"]
            for command in (compose + ["config", "--quiet"], compose + ["up", "-d", "--build"]):
                code, _ = run_logged(command, app, env, log)
                if code:
                    return code
            deadline = time.monotonic() + 360
            healthy = False
            while time.monotonic() < deadline:
                states = []
                for name in ("truck-log-server", "truck-log-web"):
                    code, state = run_logged(["docker", "inspect", "--format", "{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}", name], app, env, log)
                    states.append(code == 0 and state.strip() == "healthy")
                if all(states):
                    healthy = True
                    break
                time.sleep(5)
            code, _ = run_logged(compose + ["ps"], app, env, log)
            if not healthy:
                raise DeployError("HTTPS core services did not become healthy within 360 seconds. Review the redacted deployment log.")
            if code:
                return code
        log.write("[PASS] Linux deployment completed. Existing credentials and Docker volumes were preserved.")
        return 0
    except Exception as error:
        # Never let an unexpected parser/process exception emit a raw traceback.
        log.write("[FAIL] " + str(error))
        return 2
    finally:
        log.close()


class Parser(argparse.ArgumentParser):
    def error(self, message):
        raise DeployError("Required arguments: --archive ZIP --env-file old.env --sha256 SHA256.")


def main():
    parser = Parser(description=__doc__)
    parser.add_argument("--archive", required=True)
    parser.add_argument("--env-file", required=True)
    parser.add_argument("--sha256", required=True)
    try:
        return deploy(parser.parse_args())
    except (DeployError, OSError, UnicodeError) as error:
        print("[FAIL] " + str(error), flush=True)
        return 2


if __name__ == "__main__":
    sys.exit(main())
