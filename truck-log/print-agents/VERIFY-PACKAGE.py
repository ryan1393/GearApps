#!/usr/bin/env python3
"""Read-only package/hash verification; never installs, prints or contacts a server."""
import base64
import hashlib
import json
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parent

def digest(data):
    return hashlib.sha256(data).hexdigest()


def verify():
    count = 0
    for line in (ROOT / 'SHA256SUMS.txt').read_text().splitlines():
        expected, name = line.split(None, 1)
        target = (ROOT / name).resolve()
        if not target.is_relative_to(ROOT) or digest(target.read_bytes()) != expected:
            raise ValueError(f'Package hash mismatch: {name}')
        count += 1
    guard = ROOT / '01-Guard-Shack-Agent'
    text = (guard / 'Truck-Log-Dual-Gate-Print-Agent-Service-V4R7.cmd').read_text()
    def block(name):
        start = f'###TL_V4R7_{name}_BEGIN###\n'
        end = f'\n###TL_V4R7_{name}_END###'
        return base64.b64decode(''.join(text.split(start)[1].split(end)[0].split()), validate=True)
    boot, bundle = block('BOOT'), block('BUNDLE')
    if digest(boot) != re.search(r'TL_BOOT_SHA=([a-f0-9]+)', text).group(1):
        raise ValueError('Guard boot SHA mismatch')
    if digest(bundle) not in boot.decode():
        raise ValueError('Guard bundle SHA mismatch')
    files = json.loads(bundle)['files']
    for file in files:
        data = base64.b64decode(file['data'], validate=True)
        if digest(data) != file['hash'] or len(data) != file['length']:
            raise ValueError(f"Embedded bundle mismatch: {file['name']}")
        if data != (guard / 'original-source' / file['name']).read_bytes():
            raise ValueError(f"Embedded source mismatch: {file['name']}")
    setup = (guard / 'original-source/setup.cjs').read_text()
    nested = json.loads(re.search(r'const PACKAGE=(\[.*?\]);', setup).group(1))
    for file in nested:
        data = base64.b64decode(file['data'], validate=True)
        if digest(data) != file['hash'] or len(data) != file['length']:
            raise ValueError(f"Nested bundle mismatch: {file['name']}")
        if data != (guard / 'original-source' / file['name']).read_bytes():
            raise ValueError(f"Nested source mismatch: {file['name']}")
    watcher = ROOT / '02-SAP-Queue-Watcher'
    for script in list(watcher.glob('*.cmd')) + list(watcher.glob('*.ps1')):
        data = script.read_bytes()
        data.decode('ascii')
        if data.count(b'\n') != data.count(b'\r\n'):
            raise ValueError(f'Windows script must use CRLF: {script.name}')
    print(f'PASS: {count} package hashes, guard boot/bundle and {len(nested)} nested source files; Windows script encodings')


if __name__ == '__main__':
    verify()
