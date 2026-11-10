import base64
import contextlib
import email.parser
import email.policy
import hashlib
import http.server
import io
import json
import re
import sys
import tempfile
import threading
import time
import types
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import sap_capture_watcher as W  # noqa: E402
from sap_capture_watcher import (Route, Settings, TruckLogSettings, Watcher, WatcherError,  # noqa: E402
                                 classify_text, validate_paths, load_config)

HERE = Path(__file__).resolve().parent.parent
TOKEN = "tlpa_0123456789abcdef_" + "ab" * 32
# Copied from libs/truck-log/server/feature/print-agents/src/lib/dto/packing-slip-ingestion.dto.ts
SERVER_ALLOWED_FIELDS = {
    'sourceCaptureId', 'documentType', 'sapDocumentId', 'detectionMethod',
    'positiveMarkersFound', 'identifierCandidates', 'confidence', 'route',
    'sourceQueue', 'outputPrinter', 'capturedAt', 'printStatus', 'printError',
    'clientReportedSha256', 'reviewReason',
}
SERVER_REQUIRED_FIELDS = {
    'sourceCaptureId', 'documentType', 'detectionMethod', 'positiveMarkersFound',
    'identifierCandidates', 'route', 'sourceQueue', 'outputPrinter', 'capturedAt', 'printStatus',
}
DTO_TS = HERE.parent.parent / 'Truck-Log-1.0.0/libs/truck-log/server/feature/print-agents/src/lib/dto/packing-slip-ingestion.dto.ts'


def capture_and_process(w):
    """Single-step deterministic harness: production runs these on separate threads."""
    captured = w.scan()
    w.process_pending()
    return captured


def sample_pdf(tag=b''):
    return b"%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\n" + tag + b"\ntrailer << >>\n%%EOF\n"


class Base(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.base = Path(self.tmp.name)
        self.route = Route(8, 'DGL', self.base / 'stage' / 'capture.pdf',
                           self.base / 'in', self.base / 'ready', self.base / 'review',
                           'Fake-DGL-Printer', 'TEST', True, 'SAP-Capture-route8')
        self.logs = []

    def live_route(self):
        return Route(8, 'DGL', self.route.capture_file, self.route.incoming,
                     self.route.ready, self.route.needs_review, 'Fake-DGL-Printer', 'LIVE', True,
                     'SAP-Capture-route8')

    def tl_settings(self, api_base='https://trucklog.test/api/v1', **kw):
        values = dict(api_base=api_base, allow_http=api_base.startswith('http:'),
                      credential_file=self.base / 'cred', credential_format='file',
                      agent_id='trucklog-sap-watcher-01', source_host='TESTPC',
                      timeout_seconds=5, retry_initial_seconds=30, retry_max_seconds=900)
        values.update(kw)
        return TruckLogSettings(**values)

    def make_outbox(self, http=None, tl=None, clock=time.time):
        tl = tl or self.tl_settings()
        return W.Outbox(self.base / 'state' / 'outbox', tl, lambda: TOKEN,
                        lambda level, msg: self.logs.append((level, W.redact(msg))),
                        http=http or (lambda *a, **k: W.HttpResult(0, b'', 'offline')), clock=clock)

    def make_watcher(self, route=None, text='Packing Slip Delivery Number: 12345678',
                     printer=None, outbox=None, extract=None):
        route = route or self.route
        config = Settings((route.paths,), self.base / 'state', self.base / 'SumatraPDF.exe',
                          .5, .5, False, 1024 * 1024)
        calls = []

        def submit(src, dest):
            calls.append((str(src), dest))
            if printer:
                printer(src, dest)
        w = Watcher(config, extract_text=extract or (lambda p, o: text), submit_print=submit, outbox=outbox,
                    routes=(route,))
        return w, calls

    def make_capture(self, data=None):
        self.route.capture_file.parent.mkdir(parents=True, exist_ok=True)
        self.route.capture_file.write_bytes(data if data is not None else sample_pdf())

    def pending(self, outbox):
        return [json.loads(p.read_text()) for p in sorted(outbox.pending.glob('*.json'))]


class WatcherUnitTests(Base):
    def test_unique_number_required(self):
        self.assertEqual(classify_text('Packing List Delivery Number: 12345678'), (True, '12345678'))
        self.assertFalse(classify_text('Packing Slip Delivery Number: 1234567')[0])
        self.assertFalse(classify_text('Packing Slip Delivery Number: 12345678 Delivery No: 87654321')[0])
        self.assertFalse(classify_text('Invoice Delivery Number: 12345678')[0])

    def test_verified_test_mode_never_prints(self):
        self.make_capture()
        w, calls = self.make_watcher()
        w.prepare_dirs()
        self.assertEqual(capture_and_process(w), 0)  # First sighting never treated as stable
        time.sleep(.55)
        self.assertEqual(capture_and_process(w), 1)
        self.assertEqual(len(list(self.route.ready.glob('*.pdf'))), 1)
        self.assertEqual(calls, [])
        self.assertFalse(self.route.capture_file.exists())
        self.assertEqual(capture_and_process(w), 0)  # No repeated acceptance
        self.assertEqual(len(list((self.base / 'state' / 'journal').glob('*.json'))), 1)
        self.assertEqual(list((self.base / 'state' / 'snapshots').glob('*')), [])  # snapshot cleaned up

    def test_nonpacking_goes_to_review_no_print(self):
        self.make_capture()
        w, calls = self.make_watcher(text='Purchase order only')
        w.prepare_dirs()
        self.assertTrue(w._process(self.route))
        self.assertEqual(calls, [])
        self.assertEqual(len(list(self.route.needs_review.glob('*.pdf'))), 1)

    def test_invalid_pdf_goes_to_review(self):
        self.make_capture(data=b'%PDF-1.4\nmissing required trailer and more bytes....')
        w, calls = self.make_watcher()
        w.prepare_dirs()
        w._process(self.route)
        self.assertFalse(calls)
        self.assertEqual(len(list(self.route.needs_review.glob('*.pdf'))), 1)

    def test_live_verified_submitted_once(self):
        self.make_capture()
        live = self.live_route()
        w, calls = self.make_watcher(live)
        w.prepare_dirs()
        w._process(live)
        self.assertEqual(len(calls), 1)
        self.assertEqual(len(list(live.ready.glob('*.pdf'))), 1)
        self.assertFalse(live.capture_file.exists())

    def test_live_failure_is_uncertain_no_auto_retry(self):
        self.make_capture()
        live = self.live_route()

        def fail(*_):
            raise WatcherError('Simulated printer submission failure')
        w, calls = self.make_watcher(live, printer=fail)
        w.prepare_dirs()
        w._process(live)
        self.assertEqual(len(calls), 1)
        self.assertEqual(len(list(live.needs_review.glob('*.pdf'))), 1)
        self.assertFalse(live.capture_file.exists())
        self.assertEqual(capture_and_process(w), 0)

    def test_duplicate_capture_route_refused(self):
        other = Route(3, 'Receiving', self.route.capture_file, self.base / 'new-in',
                      self.base / 'new-ready', self.base / 'new-review')
        with self.assertRaises(WatcherError):
            validate_paths([self.route, other])

    def test_sample_ini_is_machine_local_only(self):
        c = load_config(HERE / 'watcher.ini')
        self.assertEqual([p.number for p in c.route_paths], list(range(1, 9)))
        self.assertFalse(hasattr(c, 'routes'))
        self.assertFalse(hasattr(c, 'live_print_armed'))
        self.assertEqual(c.truck_log.dpapi_scope, 'LocalMachine')
        self.assertEqual(c.truck_log.api_base, 'https://trucklog.example/api/v1')
        self.assertEqual(c.config_refresh_seconds, 60)
        text = (HERE / 'watcher.ini').read_text()
        self.assertIn('Truck Log > Admin > Printing', text.split('[watcher]')[0])
        settings = '\n'.join(x for x in text.splitlines() if not x.lstrip().startswith(';'))
        for gone in ('live_print_armed', 'physical_printer', 'test_mode', '\nenabled', '[route', 'source_queue'):
            self.assertNotIn(gone, settings)

    def test_review_logged_once_per_staged_file(self):
        # Finding 6: a tiny file still being spooled must not log REVIEW every poll.
        self.make_capture(b'%PDF')
        w, _ = self.make_watcher()
        w.prepare_dirs()
        with mock.patch.object(w, 'log') as log:
            for _ in range(6):
                capture_and_process(w)
        reviews = [c for c in log.call_args_list if c.args[0] == 'REVIEW']
        self.assertEqual(len(reviews), 1)
        self.assertTrue(self.route.capture_file.exists())


class ShippedIniTests(Base):
    def localized_ini(self, extra=None):
        text = (HERE / 'watcher.ini').read_text(encoding='utf-8')
        root = str(self.base / 'TL').replace('\\', '/')
        text = text.replace('C:\\TruckLog\\', root + '/').replace('\\', '/')
        for old, new in (extra or {}).items():
            text = text.replace(old, new)
        p = self.base / 'watcher.ini'
        p.write_text(text, encoding='utf-8')
        return p

    def test_default_ini_without_truck_log_runs_safe_default_and_never_prints(self):
        c = load_config(self.localized_ini({'https://trucklog.example': 'https://127.0.0.1:9'}))
        self.assertEqual(c.max_pdf_bytes, 25 * 1024 * 1024)
        dgl = c.route_paths[7]
        dgl.capture_file.parent.mkdir(parents=True)
        dgl.capture_file.write_bytes(sample_pdf())
        calls = []
        w = Watcher(c, extract_text=lambda p, o: 'Packing Slip Delivery Number: 12345678',
                    submit_print=lambda *a: calls.append(a))
        with mock.patch.object(W, 'check_legacy_watcher'), mock.patch.object(W.time, 'sleep'):
            w.run(once=True)  # no credential, Truck Log unreachable, no cache: must not raise
            self.assertEqual(w.route_source, 'SAFE_DEFAULT')
            self.assertTrue(all(r.mode == 'TEST' and not r.upload_enabled for r in w.routes))
            w.observed[str(dgl.capture_file)].since -= 10
            capture_and_process(w)
        self.assertEqual(calls, [])
        self.assertEqual(len(list(dgl.needs_review.glob('*.pdf'))), 1)
        log = (c.state_dir / 'watcher.log').read_text()
        self.assertIn('SAFE DEFAULT', log)
        self.assertFalse((c.state_dir / 'route-config.json').exists())

    def test_legacy_ini_keys_refused_with_pointer_to_webpage(self):
        for extra in ({'ocr_enabled = no': 'ocr_enabled = no\nlive_print_armed = no'},
                      {'allow_http = no': 'allow_http = no\nenabled = yes'},
                      {'use_system_proxy = no': 'use_system_proxy = no\n[route8]\ntest_mode = no'},
                      {'use_system_proxy = no': 'use_system_proxy = no\n[route2]\nphysical_printer = x'}):
            with self.assertRaisesRegex(WatcherError, 'Truck Log > Admin > Printing'):
                load_config(self.localized_ini(extra))
        c = load_config(self.localized_ini({'use_system_proxy = no': 'use_system_proxy = no\n[route8]\n'
                                            'ready = ' + str(self.base / 'elsewhere')}))
        self.assertEqual(c.route_paths[7].ready, self.base / 'elsewhere')

    def test_max_pdf_default_and_cap(self):
        self.assertEqual(W.SERVER_MAX_PDF_BYTES, 25 * 1024 * 1024)
        p = self.localized_ini({'max_pdf_mb = 25': 'max_pdf_mb = 30'})
        with self.assertRaisesRegex(WatcherError, '25'):
            load_config(p)

    def test_token_and_plain_http_refused_in_ini(self):
        with self.assertRaisesRegex(WatcherError, 'must not be stored'):
            load_config(self.localized_ini({'allow_http = no': 'allow_http = no\ntoken = ' + TOKEN}))
        with self.assertRaisesRegex(WatcherError, 'http'):
            load_config(self.localized_ini({'https://trucklog.example': 'http://trucklog.example'}))
        c = load_config(self.localized_ini({'allow_http = no': 'allow_http = yes',
                                            'https://trucklog.example': 'http://trucklog.example'}))
        self.assertEqual(c.truck_log.api_base, 'http://trucklog.example/api/v1')


class LegacyProcessTests(unittest.TestCase):
    CMD = r'"C:\W\.venv\Scripts\python.exe" "C:\W\sap_capture_watcher.py" run --config "C:\W\watcher.ini"'

    def test_venv_launcher_parent_is_not_a_conflict(self):
        procs = [{'ProcessId': 100, 'ParentProcessId': 50, 'CommandLine': self.CMD},   # launcher
                 {'ProcessId': 200, 'ParentProcessId': 100, 'CommandLine': self.CMD}]  # us
        self.assertEqual(W.conflicting_watchers(procs, 200, 100), [])
        with mock.patch.object(W.os, 'getpid', return_value=200), mock.patch.object(W.os, 'getppid', return_value=100):
            W.check_legacy_watcher(lister=lambda: procs)  # no raise

    def test_grandparent_python_ancestors_skipped_but_other_watcher_found(self):
        procs = [{'ProcessId': 10, 'ParentProcessId': 1, 'CommandLine': 'py.exe -3 sap_capture_watcher.py run'},
                 {'ProcessId': 100, 'ParentProcessId': 10, 'CommandLine': self.CMD},
                 {'ProcessId': 200, 'ParentProcessId': 100, 'CommandLine': self.CMD},
                 {'ProcessId': 300, 'ParentProcessId': 299, 'CommandLine': self.CMD},
                 {'ProcessId': 400, 'ParentProcessId': 1, 'CommandLine': 'python truck_log_print_server.py'}]
        found = W.conflicting_watchers(procs, 200, 100)
        self.assertEqual(sorted(p['ProcessId'] for p in found), [300, 400])
        with mock.patch.object(W.os, 'getpid', return_value=200), mock.patch.object(W.os, 'getppid', return_value=100):
            with self.assertRaises(WatcherError):
                W.check_legacy_watcher(lister=lambda: procs)

    def test_parent_cycle_does_not_hang(self):
        procs = [{'ProcessId': 1, 'ParentProcessId': 2, 'CommandLine': 'x'},
                 {'ProcessId': 2, 'ParentProcessId': 1, 'CommandLine': 'x'}]
        self.assertEqual(W.conflicting_watchers(procs, 1, 2), [])


class ExtractionTests(Base):
    def test_ocr_runs_when_text_has_no_labelled_number(self):
        # Finding 5: text exists (marker only) -> OCR must still be tried.
        def layers(path, ocr):
            yield 'PYPDF_TEXT', 'PACKING SLIP  Ship to: Dock'
            yield 'PYMUPDF_TEXT', 'PACKING SLIP  Ship to: Dock'
            yield 'OCR', 'Packing Slip\nDelivery Number: 87654321'
        v = W.verify_layers(layers(None, True))
        self.assertTrue(v.ok)
        self.assertEqual((v.delivery_number, v.method), ('87654321', 'OCR'))

    def test_ocr_not_run_when_text_verifies_and_cannot_override_ambiguity(self):
        consumed = []

        def layers():
            for m, t in (('PYPDF_TEXT', 'Packing List Delivery No. 11112222'), ('OCR', 'x')):
                consumed.append(m)
                yield m, t
        self.assertEqual(W.verify_layers(layers()).method, 'PYPDF_TEXT')
        self.assertEqual(consumed, ['PYPDF_TEXT'])
        ambiguous = [('PYPDF_TEXT', 'Packing Slip Delivery Number: 11112222 Delivery Number: 33334444'),
                     ('OCR', 'Packing Slip Delivery Number: 11112222')]
        self.assertFalse(W.verify_layers(ambiguous).ok)

    def test_real_extractor_chain_falls_back_to_ocr(self):
        page = types.SimpleNamespace(extract_text=lambda: 'Packing Slip (no number in text layer)')
        fake_pypdf = types.SimpleNamespace(PdfReader=lambda *a, **k: types.SimpleNamespace(pages=[page]))
        pix = types.SimpleNamespace(width=1, height=1, samples=b'\0\0\0')
        fpage = types.SimpleNamespace(get_text=lambda: 'Packing Slip', get_pixmap=lambda **k: pix)

        class Doc(list):
            def __enter__(self):
                return self

            def __exit__(self, *a):
                return False
        fake_fitz = types.SimpleNamespace(open=lambda p: Doc([fpage]), Matrix=lambda a, b: None)
        ocr_calls = []

        def ocr(im, timeout):
            ocr_calls.append(im)
            return 'PACKING SLIP\nDelivery Number: 55556666'
        fake_tess = types.SimpleNamespace(image_to_string=ocr)
        fake_pil = types.ModuleType('PIL')
        fake_pil.Image = types.SimpleNamespace(frombytes=lambda *a: 'img')
        mods = {'pypdf': fake_pypdf, 'fitz': fake_fitz, 'pytesseract': fake_tess, 'PIL': fake_pil}
        with mock.patch.dict(sys.modules, mods):
            v = W.verify_layers(W.pdf_text_layers(Path('x.pdf'), True))
            self.assertEqual((v.ok, v.delivery_number, v.method), (True, '55556666', 'OCR'))
            self.assertEqual(len(ocr_calls), 1)
            off = W.verify_layers(W.pdf_text_layers(Path('x.pdf'), False))
            self.assertFalse(off.ok)


class MetadataTests(Base):
    def build(self, **kw):
        v = W.Verification(True, '12345678', 'PYMUPDF_TEXT', ('Packing Slip',))
        args = dict(source_capture_id='TESTPC.route8.' + 'a' * 32, verification=v, route=self.route,
                    output_printer='TEST_MODE_NO_PRINT', captured_at=W.iso_utc_ms(), print_status='SKIPPED',
                    sha256='0' * 64)
        args.update(kw)
        return W.build_packing_slip_metadata(**args)

    def test_metadata_matches_server_dto_exactly(self):
        md = self.build()
        self.assertTrue(SERVER_REQUIRED_FIELDS <= set(md) <= SERVER_ALLOWED_FIELDS)
        self.assertEqual(set(W.METADATA_FIELDS), SERVER_ALLOWED_FIELDS)
        self.assertEqual(md['documentType'], 'PACKING_SLIP')
        self.assertEqual(md['identifierCandidates'], ['12345678'])
        self.assertEqual(md['sapDocumentId'], '12345678')
        self.assertEqual(md['positiveMarkersFound'], ['Packing Slip'])
        self.assertIn(md['detectionMethod'], ('PYPDF_TEXT', 'PYMUPDF_TEXT', 'OCR'))
        self.assertIn(md['printStatus'], ('PENDING', 'PRINTED', 'FAILED', 'SKIPPED'))
        self.assertRegex(md['sourceCaptureId'], r'^[A-Za-z0-9][A-Za-z0-9._:-]{2,119}$')
        self.assertRegex(md['capturedAt'], r'^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$')
        self.assertNotIn('printError', md)
        self.assertNotIn('confidence', md)
        failed = self.build(print_status='FAILED', print_error='SumatraPDF exit=1 ' + TOKEN)
        self.assertNotIn(TOKEN, failed['printError'])

    @unittest.skipUnless(DTO_TS.is_file(), 'Truck Log source not present')
    def test_field_names_against_typescript_dto(self):
        ts = DTO_TS.read_text()
        block = re.search(r'allowedFields = new Set\(\[(.*?)\]\)', ts, re.S).group(1)
        self.assertEqual(set(re.findall(r"'([A-Za-z0-9]+)'", block)), SERVER_ALLOWED_FIELDS)
        methods = re.search(r'DETECTION_METHODS = \[(.*?)\]', ts, re.S).group(1)
        self.assertEqual(set(re.findall(r"'([A-Z_]+)'", methods)), set(W.DETECTION_METHODS))

    def test_invalid_metadata_rejected_client_side(self):
        with self.assertRaises(WatcherError):
            self.build(verification=W.Verification(False, reason='x'))
        with self.assertRaises(WatcherError):
            self.build(print_status='PRINTED_MAYBE')
        md = self.build()
        md['identifierCandidates'] = ['12345678', '87654321']
        with self.assertRaises(WatcherError):
            W.validate_packing_slip_metadata(md)

    def test_idempotency_key_stable_per_capture(self):
        cid = 'f' * 32
        self.assertEqual(W.idempotency_key_for(cid), W.idempotency_key_for(cid))
        self.assertRegex(W.idempotency_key_for(cid), r'^[A-Za-z0-9][A-Za-z0-9._:-]{15,127}$')
        self.assertNotEqual(W.idempotency_key_for(cid), W.idempotency_key_for('e' * 32))

    def test_watcher_queues_verified_slip_with_detection_method(self):
        outbox = self.make_outbox()
        self.make_capture()
        w, _ = self.make_watcher(outbox=outbox, extract=lambda p, o: [('PYPDF_TEXT', 'nothing'),
                                                                      ('OCR', 'Packing List Delivery #: 12345678')])
        w.prepare_dirs()
        record = w._process(self.route)
        [entry] = self.pending(outbox)
        md = entry['metadata']
        self.assertEqual(md['detectionMethod'], 'OCR')
        self.assertEqual(md['outputPrinter'], 'TEST_MODE_NO_PRINT')
        self.assertEqual(md['printStatus'], 'SKIPPED')
        self.assertEqual(md['route'], 'DGL')
        self.assertEqual(md['sourceQueue'], 'SAP-Capture-route8')
        self.assertEqual(md['clientReportedSha256'], hashlib.sha256(sample_pdf()).hexdigest())
        self.assertEqual(entry['pdfPath'], record['stored_file'])
        self.assertTrue(md['sourceCaptureId'].endswith(record['id']))
        self.assertEqual(entry['idempotencyKey'], 'sapw-' + record['id'])

    def test_unverified_pdf_never_queued(self):
        outbox = self.make_outbox()
        self.make_capture()
        w, _ = self.make_watcher(outbox=outbox, text='Invoice 12345678')
        w.prepare_dirs()
        w._process(self.route)
        self.assertEqual(self.pending(outbox), [])

    def test_live_print_failure_uploads_failed_status(self):
        outbox = self.make_outbox()
        self.make_capture()

        def fail(*_):
            raise WatcherError('SumatraPDF submission exit=3')
        w, _ = self.make_watcher(self.live_route(), printer=fail, outbox=outbox)
        w.prepare_dirs()
        w._process(self.live_route())
        [entry] = self.pending(outbox)
        self.assertEqual(entry['metadata']['printStatus'], 'FAILED')
        self.assertIn('exit=3', entry['metadata']['printError'])
        self.assertEqual(entry['metadata']['outputPrinter'], 'Fake-DGL-Printer')


class OverwriteTests(Base):
    def test_overwrite_during_settle_recovers_first_print(self):
        # Finding 3: a second print replacing capture.pdf before it is filed must not silently lose the first.
        outbox = self.make_outbox()
        self.make_capture(sample_pdf(b'% job A'))
        texts = {}
        w, calls = self.make_watcher(outbox=outbox,
                                     extract=lambda p, o: texts.get(hashlib.sha256(p.read_bytes()).hexdigest(), ''))
        a = sample_pdf(b'% job A')
        b = sample_pdf(b'% job B is longer')
        texts[hashlib.sha256(a).hexdigest()] = 'Packing Slip Delivery Number: 11111111'
        texts[hashlib.sha256(b).hexdigest()] = 'Packing Slip Delivery Number: 22222222'
        w.prepare_dirs()
        capture_and_process(w)  # sees A, snapshots it
        self.route.capture_file.write_bytes(b)  # B overwrites A within the settle window
        self.assertEqual(capture_and_process(w), 1)  # A recovered
        recovered = list(self.route.needs_review.glob('*.pdf'))
        self.assertEqual(len(recovered), 1)
        self.assertEqual(recovered[0].read_bytes(), a)
        time.sleep(.55)
        self.assertEqual(capture_and_process(w), 1)  # B filed normally
        self.assertEqual([p.read_bytes() for p in self.route.ready.glob('*.pdf')], [b])
        self.assertEqual(calls, [])
        mds = {e['metadata']['sapDocumentId']: e['metadata'] for e in self.pending(outbox)}
        self.assertEqual(mds['11111111']['outputPrinter'], W.RECOVERED_PRINTER)
        self.assertIn('reviewReason', mds['11111111'])
        self.assertNotIn('reviewReason', mds['22222222'])
        self.assertEqual(list((self.base / 'state' / 'snapshots').glob('*')), [])

    def test_same_job_growing_is_not_an_overwrite(self):
        first = sample_pdf()
        self.make_capture(first)
        w, _ = self.make_watcher()
        w.prepare_dirs()
        capture_and_process(w)
        self.route.capture_file.write_bytes(first + b'1 0 obj << >> endobj\n%%EOF\n')  # appended update
        self.assertEqual(capture_and_process(w), 0)
        self.assertEqual(list(self.route.needs_review.glob('*.pdf')), [])


class FakeTruckLog(http.server.BaseHTTPRequestHandler):
    responses = []
    requests = []

    def log_message(self, *a):
        pass

    def _reply(self):
        length = int(self.headers.get('Content-Length') or 0)
        body = self.rfile.read(length) if length else b''
        FakeTruckLog.requests.append((self.command, self.path, dict(self.headers), body))
        status, payload, extra = FakeTruckLog.responses.pop(0) if FakeTruckLog.responses else (500, {}, {})
        data = json.dumps(payload).encode()
        self.send_response(status)
        for k, v in extra.items():
            self.send_header(k, v)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    do_POST = _reply
    do_GET = _reply


class OutboxHttpTests(Base):
    def setUp(self):
        super().setUp()
        FakeTruckLog.responses = []
        FakeTruckLog.requests = []
        self.server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), FakeTruckLog)
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        self.addCleanup(self.server.server_close)
        self.addCleanup(self.server.shutdown)
        self.api = f'http://127.0.0.1:{self.server.server_port}/api/v1'
        self.now = [1000.0]

    def outbox(self, api=None):
        return self.make_outbox(http=W.http_request, tl=self.tl_settings(api or self.api), clock=lambda: self.now[0])

    def queue_one(self, outbox, delivery='12345678'):
        pdf = self.base / 'ready' / f'slip-{delivery}.pdf'
        pdf.parent.mkdir(parents=True, exist_ok=True)
        pdf.write_bytes(sample_pdf(delivery.encode()))
        sha = hashlib.sha256(pdf.read_bytes()).hexdigest()
        cid = hashlib.md5(delivery.encode()).hexdigest()
        md = W.build_packing_slip_metadata(
            source_capture_id='TESTPC.route8.' + cid, verification=W.Verification(True, delivery, 'PYPDF_TEXT', ('Packing Slip',)),
            route=self.route, output_printer='TEST_MODE_NO_PRINT', captured_at=W.iso_utc_ms(),
            print_status='SKIPPED', sha256=sha)
        outbox.enqueue(capture_id=cid, metadata=md, pdf_path=pdf, sha256=sha)
        return pdf, md, cid

    def test_retry_then_success_same_idempotency_key_and_exact_multipart(self):
        ob = self.outbox()
        pdf, md, cid = self.queue_one(ob)
        FakeTruckLog.responses = [(503, {'message': 'down'}, {}),
                                  (200, {'accepted': True, 'duplicate': False, 'documentId': 'doc-1',
                                         'validationStatus': 'VALIDATED'}, {})]
        self.assertEqual(ob.process_due(), {'sent': 0, 'failed': 0, 'retry': 1})
        [entry] = self.pending(ob)
        self.assertGreater(entry['nextAttemptAt'], self.now[0])
        self.assertEqual(ob.process_due(), {'sent': 0, 'failed': 0, 'retry': 0})  # backoff respected
        self.now[0] += 10000
        ob2 = self.outbox()  # simulated restart: new instance, same disk state
        self.assertEqual(ob2.process_due()['sent'], 1)
        self.assertEqual(ob2.counts(), {'pending': 0, 'sent': 1, 'failed': 0})
        self.assertTrue(pdf.exists())
        (m1, p1, h1, b1), (m2, p2, h2, b2) = FakeTruckLog.requests
        self.assertEqual((m1, p1), ('POST', '/api/v1/print-agents/documents/packing-slip'))
        self.assertEqual(h1['X-Idempotency-Key'], h2['X-Idempotency-Key'])
        self.assertEqual(h1['X-Idempotency-Key'], 'sapw-' + cid)
        self.assertEqual(h1['Authorization'], 'Bearer ' + TOKEN)
        msg = email.parser.BytesParser(policy=email.policy.HTTP).parsebytes(
            b'Content-Type: ' + h2['Content-Type'].encode() + b'\r\n\r\n' + b2)
        parts = {p.get_param('name', header='content-disposition'): p for p in msg.iter_parts()}
        self.assertEqual(set(parts), {'metadata', 'file'})
        self.assertEqual(json.loads(parts['metadata'].get_content()), md)
        self.assertEqual(parts['file'].get_content(), pdf.read_bytes())
        self.assertEqual(parts['file'].get_content_type(), 'application/pdf')

    def test_validation_error_is_permanent_and_pdf_kept(self):
        ob = self.outbox()
        pdf, _, _ = self.queue_one(ob)
        FakeTruckLog.responses = [(422, {'message': 'Packing Slip ingestion requires a positive marker.'}, {})]
        self.assertEqual(ob.process_due()['failed'], 1)
        self.assertEqual(ob.counts(), {'pending': 0, 'sent': 0, 'failed': 1})
        self.assertTrue(pdf.exists())
        listing = (ob.root / 'UPLOAD-FAILED.txt').read_text()
        self.assertIn('HTTP 422', listing)
        self.assertIn('positive marker', listing)
        self.now[0] += 10 ** 6
        self.assertEqual(ob.process_due()['sent'], 0)
        self.assertEqual(len(FakeTruckLog.requests), 1)  # never retried
        self.assertEqual(ob.requeue_failed(), 1)

    def test_network_down_keeps_pending_and_stops_round(self):
        ob = self.outbox(api='http://127.0.0.1:9/api/v1')  # discard port: connection refused
        self.queue_one(ob, '11111111')
        self.queue_one(ob, '22222222')
        result = ob.process_due()
        self.assertEqual(result['retry'], 1)  # second one not hammered while server is down
        self.assertEqual(ob.counts()['pending'], 2)

    def test_redirect_refused_and_not_followed(self):
        ob = self.outbox()
        self.queue_one(ob)
        FakeTruckLog.responses = [(307, {}, {'Location': self.api + '/elsewhere'})]
        self.assertEqual(ob.process_due()['retry'], 1)
        self.assertEqual(len(FakeTruckLog.requests), 1)
        self.assertIn('redirect refused', self.pending(ob)[0]['lastError'])

    def test_changed_pdf_is_never_sent(self):
        ob = self.outbox()
        pdf, _, _ = self.queue_one(ob)
        pdf.write_bytes(sample_pdf(b'tampered'))
        self.assertEqual(ob.process_due()['failed'], 1)
        self.assertEqual(FakeTruckLog.requests, [])

    def test_token_redacted_from_logs_and_stored_errors(self):
        ob = self.outbox()
        self.queue_one(ob)
        FakeTruckLog.responses = [(401, {'message': 'bad Authorization: Bearer ' + TOKEN}, {})]
        ob.process_due()
        stored = json.dumps(self.pending(ob))
        self.assertNotIn(TOKEN, stored)
        self.assertNotIn('ab' * 32, stored)
        self.assertNotIn(TOKEN, repr(self.logs))
        self.assertIn('tlpa_0123456789abcdef_[REDACTED]', W.redact('x ' + TOKEN))
        self.assertNotIn('secretvalue', W.redact('Authorization: Bearer secretvalue'))
        w, _ = self.make_watcher()
        w.log('INFO', 'token ' + TOKEN)
        self.assertNotIn(TOKEN, (self.base / 'state' / 'watcher.log').read_text())

    def test_setup_check_confirms_agent_id(self):
        FakeTruckLog.responses = [(200, {'accepted': True, 'agentId': 'trucklog-print-pc-01'}, {}),
                                  (200, {'accepted': True, 'agentId': 'trucklog-sap-watcher-01'}, {})]
        tl = self.tl_settings(self.api)
        ok, msg = W.setup_check(tl, TOKEN)
        self.assertFalse(ok)
        self.assertIn('trucklog-print-pc-01', msg)
        self.assertTrue(W.setup_check(tl, TOKEN)[0])
        self.assertEqual(FakeTruckLog.requests[0][1], '/api/v1/print-agents/setup-check')

    def test_credential_file_roundtrip(self):
        tl = self.tl_settings()
        W.store_token(tl, TOKEN)
        self.assertEqual(W.load_token(tl), TOKEN)
        with self.assertRaises(WatcherError):
            W.store_token(tl, 'not-a-token')

# ---------------------------------------------------------------------------
# Route settings from Truck Log (watcher-config-contract.md)
# ---------------------------------------------------------------------------

def route_doc(version=7, per_route=None):
    """Contract-shaped document; per_route={8: {'mode': 'LIVE'}} overrides fields of one route."""
    routes = []
    for n in range(1, 9):
        r = {'route': n, 'name': W.default_route_name(n), 'sourceQueue': f'SAP-Capture-route{n}',
             'outputPrinter': '\\\\USFTWPLVPS03\\USFTWP_Route%d_Ricoh' % n, 'mode': 'TEST', 'uploadEnabled': False}
        r.update((per_route or {}).get(n, {}))
        routes.append(r)
    return {'version': version, 'updatedAt': '2026-10-28T15:40:00.000Z', 'updatedBy': 'mlopez', 'routes': routes}


class RouteDocumentTests(unittest.TestCase):
    def test_contract_example_is_valid(self):
        doc = route_doc()
        doc['routes'][7].update(outputPrinter='\\\\USFTWPLVPS03\\USFTWP_DGL_Ricoh', mode='LIVE', uploadEnabled=True)
        self.assertIs(W.validate_route_document(doc), doc)
        doc['routes'][0]['outputPrinter'] = ''          # empty allowed unless LIVE
        doc['routes'][1]['mode'] = 'OFF'
        doc['routes'][2]['sourceQueue'] = 'SAP-Capture-route2'  # duplicate of an OFF route is fine
        doc['routes'][3]['outputPrinter'] = '\\\\srv.example-1\\Queue name with spaces'
        W.validate_route_document(doc)

    def test_each_violation_rejects_whole_document(self):
        def bad(mutate):
            doc = route_doc()
            mutate(doc)
            with self.assertRaises(WatcherError, msg=repr(doc)):
                W.validate_route_document(doc)
        bad(lambda d: d.update(version=0))
        bad(lambda d: d.update(version=True))
        bad(lambda d: d.update(version='7'))
        bad(lambda d: d['routes'].pop())
        bad(lambda d: d['routes'].reverse())
        bad(lambda d: d['routes'][0].update(route=2))
        bad(lambda d: d['routes'][0].update(name=''))
        bad(lambda d: d['routes'][0].update(name='   '))
        bad(lambda d: d['routes'][0].update(name='x' * 61))
        bad(lambda d: d['routes'][0].update(name='West\nDock'))
        bad(lambda d: d['routes'][0].update(sourceQueue=''))
        bad(lambda d: d['routes'][0].update(sourceQueue='q' * 121))
        bad(lambda d: d['routes'][0].update(sourceQueue='SAP-Capture-route2'))   # duplicate, both not OFF
        bad(lambda d: d['routes'][0].update(mode='live'))
        bad(lambda d: d['routes'][0].update(mode='ARMED'))
        bad(lambda d: d['routes'][0].update(uploadEnabled='yes'))
        bad(lambda d: d['routes'][0].pop('uploadEnabled'))
        bad(lambda d: d['routes'][0].update(outputPrinter='USFTWP_DGL_Ricoh'))
        bad(lambda d: d['routes'][0].update(outputPrinter='\\\\srv\\a\\b'))
        bad(lambda d: d['routes'][0].update(outputPrinter='\\\\srv\\queue\n'))
        bad(lambda d: d['routes'][0].update(outputPrinter='\\\\srv\\que:ue'))
        bad(lambda d: d['routes'][0].update(outputPrinter='', mode='LIVE'))
        bad(lambda d: d.update(updatedBy='m\x07lopez'))
        bad(lambda d: d.update(routes='nope'))
        with self.assertRaises(WatcherError):
            W.validate_route_document([])

    def test_safe_default_is_all_test_upload_off_and_valid_shape(self):
        doc = W.safe_default_document()
        self.assertEqual([r['mode'] for r in doc['routes']], ['TEST'] * 8)
        self.assertFalse(any(r['uploadEnabled'] for r in doc['routes']))
        self.assertEqual(doc['routes'][7]['name'], 'DGL')
        self.assertEqual(doc['routes'][5]['name'], 'North Shipping Dock')

    def test_live_into_capture_queue_is_downgraded_locally(self):
        paths = [W.RoutePaths(n, Path(f'/c/{n}/capture.pdf'), Path(f'/p/{n}/in'), Path(f'/p/{n}/r'), Path(f'/p/{n}/n'))
                 for n in range(1, 9)]
        doc = route_doc(7, {8: {'mode': 'LIVE', 'outputPrinter': '\\\\USFTWLDAPP\\SAP-Capture-route1'},
                           7: {'mode': 'LIVE', 'outputPrinter': '\\\\srv\\Microsoft Print to PDF'},
                           6: {'mode': 'LIVE'}})
        routes, warnings = W.build_routes(W.validate_route_document(doc), paths)
        self.assertEqual([r.mode for r in routes[5:]], ['LIVE', 'TEST', 'TEST'])
        self.assertEqual(len(warnings), 2)


class RouteConfigTests(Base):
    """Fetch / 304 / cache / offline / invalid document / safe default, over a real local HTTP server."""

    def setUp(self):
        super().setUp()
        FakeTruckLog.responses = []
        FakeTruckLog.requests = []
        self.server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), FakeTruckLog)
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        self.addCleanup(self.server.server_close)
        self.addCleanup(self.server.shutdown)
        self.api = f'http://127.0.0.1:{self.server.server_port}/api/v1'
        self.state = self.base / 'state'
        self.paths = tuple(W.RoutePaths(n, self.base / f'stage{n}' / 'capture.pdf', self.base / f'r{n}' / 'in',
                                        self.base / f'r{n}' / 'ready', self.base / f'r{n}' / 'review')
                           for n in range(1, 9))

    def settings(self, api=None):
        return Settings(self.paths, self.state, self.base / 'SumatraPDF.exe', .5, .5, False, 1024 * 1024,
                        self.tl_settings(api or self.api))

    def watcher(self, api=None, token=lambda: TOKEN, **kw):
        c = self.settings(api)
        calls = []
        w = Watcher(c, extract_text=kw.pop('extract', lambda p, o: 'Packing Slip Delivery Number: 12345678'),
                    submit_print=lambda src, dest: calls.append((src, dest)), **kw)
        w._get_token = token
        w.config_client.token_provider = token
        w.log = lambda level, msg: self.logs.append((level, W.redact(msg)))
        w.config_client.log = w.log
        return w, calls

    def ok(self, doc):
        return (200, doc, {'ETag': '"%d"' % doc['version']})

    def test_fetch_on_start_caches_atomically_and_sends_token(self):
        FakeTruckLog.responses = [self.ok(route_doc(7, {8: {'mode': 'LIVE', 'uploadEnabled': True}}))]
        w, _ = self.watcher()
        w.initial_route_config()
        self.assertEqual(w.route_source, 'TRUCK_LOG')
        self.assertEqual(w.routes[7].mode, 'LIVE')
        self.assertTrue(w.routes[7].upload_enabled)
        method, path, headers, _ = FakeTruckLog.requests[0]
        self.assertEqual((method, path), ('GET', '/api/v1/print-agents/packing-slip-routes'))
        self.assertEqual(headers['Authorization'], 'Bearer ' + TOKEN)
        self.assertNotIn('If-None-Match', headers)
        cache = json.loads((self.state / 'route-config.json').read_text())
        self.assertEqual(cache['format'], W.ROUTE_CONFIG_CACHE_FORMAT)
        self.assertEqual(cache['document']['version'], 7)
        self.assertEqual(sorted(p.name for p in self.state.iterdir()), ['capture-provenance.json', 'route-config.json'])  # no temp files left
        text = repr(self.logs)
        self.assertIn('version 7 by mlopez', text)
        self.assertIn('route 8 DGL: LIVE', text)
        self.assertNotIn(TOKEN, text)

    def test_304_keeps_settings_and_sends_if_none_match(self):
        FakeTruckLog.responses = [self.ok(route_doc(7)), (304, {}, {})]
        w, _ = self.watcher()
        w.initial_route_config()
        before = w.routes
        res = w.config_client.refresh(w.route_doc)
        self.assertEqual(res.outcome, 'not_modified')
        self.assertEqual(FakeTruckLog.requests[1][2]['If-None-Match'], '"7"')
        w.apply_pending_config()
        self.assertIs(w.routes, before)

    def test_offline_keeps_cache_and_logs_once_per_outage(self):
        FakeTruckLog.responses = [self.ok(route_doc(5, {2: {'mode': 'OFF'}}))]
        w, _ = self.watcher()
        w.initial_route_config()
        # restart while Truck Log is down: cached copy is used
        w2, _ = self.watcher(api='http://127.0.0.1:9/api/v1')
        w2.initial_route_config()
        self.assertEqual(w2.route_source, 'CACHE')
        self.assertEqual(w2.routes[1].mode, 'OFF')
        for _ in range(3):
            self.assertEqual(w2.config_client.refresh(w2.route_doc).outcome, 'unreachable')
        offline = [m for lvl, m in self.logs if lvl == 'CONFIG-OFFLINE']
        self.assertEqual(len(offline), 1)
        self.assertEqual(w2.routes[1].mode, 'OFF')

    def test_reconnect_logged_and_new_version_applied(self):
        w, _ = self.watcher()
        FakeTruckLog.responses = [(503, {'message': 'down'}, {})]
        w.initial_route_config()
        self.assertEqual(w.route_source, 'SAFE_DEFAULT')
        FakeTruckLog.responses = [self.ok(route_doc(9, {8: {'mode': 'LIVE'}}))]
        w.config_client.refresh(w.route_doc)
        self.assertIn('reachable again', repr(self.logs))
        w.apply_pending_config()
        self.assertEqual(w.routes[7].mode, 'LIVE')
        self.assertIn('route 8 DGL: TEST -> LIVE (version 9 by mlopez)', [m for _, m in self.logs])

    def test_invalid_document_rejected_whole_and_cache_untouched(self):
        FakeTruckLog.responses = [self.ok(route_doc(7))]
        w, _ = self.watcher()
        w.initial_route_config()
        cache_before = (self.state / 'route-config.json').read_bytes()
        broken = route_doc(8, {8: {'mode': 'LIVE', 'outputPrinter': ''}, 1: {'mode': 'LIVE'}})
        FakeTruckLog.responses = [self.ok(broken), self.ok(broken), (200, {'not': 'json-list'}, {})]
        self.assertEqual(w.config_client.refresh(w.route_doc).outcome, 'rejected')
        self.assertEqual(w.config_client.refresh(w.route_doc).outcome, 'rejected')
        w.apply_pending_config()
        self.assertEqual(w.route_doc['version'], 7)
        self.assertEqual([r.mode for r in w.routes], ['TEST'] * 8)  # route 1 did NOT go LIVE
        self.assertEqual((self.state / 'route-config.json').read_bytes(), cache_before)
        self.assertEqual(len([1 for lvl, _ in self.logs if lvl == 'CONFIG-REJECT']), 1)  # same problem logged once
        self.assertEqual(w.config_client.refresh(w.route_doc).outcome, 'rejected')

    def test_no_cache_and_no_server_is_safe_default(self):
        w, _ = self.watcher(api='http://127.0.0.1:9/api/v1')
        w.initial_route_config()
        self.assertEqual(w.route_source, 'SAFE_DEFAULT')
        self.assertTrue(all(r.mode == 'TEST' and not r.upload_enabled for r in w.routes))
        self.assertFalse((self.state / 'route-config.json').exists())

    def test_corrupt_cache_ignored(self):
        self.state.mkdir(parents=True)
        (self.state / 'route-config.json').write_text('{"format": "truck-log-packing-slip-routes-cache-v1", '
                                                      '"document": {"version": 3, "routes": []}}')
        w, _ = self.watcher(api='http://127.0.0.1:9/api/v1')
        w.initial_route_config()
        self.assertEqual(w.route_source, 'SAFE_DEFAULT')

    def test_missing_credential_is_offline_not_fatal_and_retried(self):
        state = {'token': None}

        def token():
            if not state['token']:
                raise WatcherError('Truck Log credential not found')
            return state['token']
        w, _ = self.watcher(token=token)
        w.initial_route_config()
        self.assertEqual(w.route_source, 'SAFE_DEFAULT')
        self.assertEqual(FakeTruckLog.requests, [])
        state['token'] = TOKEN   # SETUP-TRUCK-LOG-UPLOAD.cmd run while the service keeps going
        FakeTruckLog.responses = [self.ok(route_doc(2))]
        self.assertEqual(w.config_client.refresh(w.route_doc).outcome, 'updated')

    def test_404_401_and_redirect_messages(self):
        forgot = []
        w, _ = self.watcher()
        w.config_client.on_auth_failure = lambda: forgot.append(1)
        FakeTruckLog.responses = [(404, {'message': 'Cannot GET'}, {})]
        self.assertIn('migration 0004', w.config_client.request(None).message)
        FakeTruckLog.responses = [(401, {'message': 'Bearer ' + TOKEN}, {})]
        msg = w.config_client.request(None).message
        self.assertIn('SETUP-TRUCK-LOG-UPLOAD', msg)
        self.assertNotIn(TOKEN, msg)
        self.assertEqual(forgot, [1])
        FakeTruckLog.responses = [(302, {}, {'Location': 'http://127.0.0.1:9/x'})]
        self.assertIn('redirect refused', w.config_client.request(None).message)
        self.assertEqual(len(FakeTruckLog.requests), 3)

    def test_check_is_read_only_and_reports_everything(self):
        FakeTruckLog.responses = [self.ok(route_doc(4))]
        w, _ = self.watcher()
        w.initial_route_config()                           # cache = version 4
        cred = self.tl_settings(self.api).credential_file
        cred.write_text(TOKEN + '\n')
        FakeTruckLog.responses = [self.ok(route_doc(6, {8: {'mode': 'LIVE', 'uploadEnabled': True}})),
                                  (200, {'accepted': True, 'agentId': 'trucklog-sap-watcher-01'}, {})]
        cache_before = (self.state / 'route-config.json').read_bytes()
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            W.check_command(self.settings(), online=True)
        text = out.getvalue()
        self.assertIn('REACHABLE, version 6 by mlopez', text)
        self.assertIn('Cached route settings: version 4', text)
        self.assertIn('route8 DGL: LIVE, upload ON, printer \\\\USFTWPLVPS03\\USFTWP_Route8_Ricoh', text)
        self.assertIn('route1 West Dock: TEST, upload off', text)
        self.assertEqual((self.state / 'route-config.json').read_bytes(), cache_before)
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            W.check_command(self.settings(api='http://127.0.0.1:9/api/v1'), online=True)
        self.assertIn('NOT REACHABLE', out.getvalue())
        self.assertIn('Effective route settings from CACHE', out.getvalue())


class ModeTests(Base):
    """OFF / TEST / LIVE behaviour, per-route upload, changes applied between captures."""

    def setUp(self):
        super().setUp()
        self.outbox = self.make_outbox()

    def with_mode(self, mode, upload=True, printer='Fake-DGL-Printer'):
        return Route(8, 'DGL', self.route.capture_file, self.route.incoming, self.route.ready,
                     self.route.needs_review, printer, mode, upload, 'SAP-Capture-route8')

    def settle(self, w):
        capture_and_process(w)
        w.observed[str(self.route.capture_file)].since -= 10
        return capture_and_process(w)

    def test_off_route_capture_not_read(self):
        self.make_capture()
        w, calls = self.make_watcher(self.with_mode('OFF'), outbox=self.outbox)
        w.prepare_dirs()
        for _ in range(3):
            self.assertEqual(capture_and_process(w), 0)
        self.assertTrue(self.route.capture_file.exists())
        self.assertEqual(w.observed, {})
        self.assertEqual((calls, self.pending(self.outbox)), ([], []))

    def test_test_mode_never_prints_even_with_printer(self):
        self.make_capture()
        w, calls = self.make_watcher(self.with_mode('TEST', printer='\\\\srv\\RealPrinter'), outbox=self.outbox)
        w.prepare_dirs()
        self.assertEqual(self.settle(w), 1)
        self.assertEqual(calls, [])
        [entry] = self.pending(self.outbox)
        self.assertEqual((entry['metadata']['printStatus'], entry['metadata']['outputPrinter']),
                         ('SKIPPED', 'TEST_MODE_NO_PRINT'))

    def test_live_prints_only_verified(self):
        self.make_capture()
        w, calls = self.make_watcher(self.with_mode('LIVE'), outbox=self.outbox)
        w.prepare_dirs()
        self.assertEqual(self.settle(w), 1)
        self.assertEqual(len(calls), 1)
        self.assertEqual(calls[0][1], 'Fake-DGL-Printer')
        self.assertEqual(self.pending(self.outbox)[0]['metadata']['printStatus'], 'PRINTED')
        self.make_capture(sample_pdf(b'second'))
        w.extract_text = lambda p, o: 'Packing Slip Delivery Number: 1234'   # unverified
        self.assertEqual(self.settle(w), 1)
        self.assertEqual(len(calls), 1)                                        # not printed
        self.assertEqual(len(list(self.route.needs_review.glob('*.pdf'))), 1)
        self.assertEqual(len(self.pending(self.outbox)), 1)                    # not uploaded

    def test_upload_flag_is_per_route(self):
        self.make_capture()
        w, _ = self.make_watcher(self.with_mode('LIVE', upload=False), outbox=self.outbox)
        w.prepare_dirs()
        self.settle(w)
        self.assertEqual(self.pending(self.outbox), [])
        record = json.loads(next((self.base / 'state' / 'journal').glob('*.json')).read_text())
        self.assertEqual(record['upload'], 'OFF_FOR_ROUTE')
        self.assertEqual(record['status'], 'PRINT_SUBMITTED_PAPER_UNVERIFIED')

    def config_watcher(self, docs):
        """Watcher on route 8 whose Truck Log answers come from `docs` (a list, consumed in order)."""
        paths = tuple(W.RoutePaths(n, self.base / f'stage{n}' / 'capture.pdf', self.base / f'r{n}' / 'in',
                                   self.base / f'r{n}' / 'ready', self.base / f'r{n}' / 'review') for n in range(1, 8)) + \
            (self.route.paths,)
        c = Settings(paths, self.base / 'state', self.base / 'SumatraPDF.exe', .5, .5, False, 1024 * 1024,
                     self.tl_settings())

        def http(method, url, **kw):
            return W.HttpResult(200, json.dumps(docs.pop(0)).encode()) if docs else W.HttpResult(304)
        calls = []
        w = Watcher(c, submit_print=lambda src, dest: calls.append(dest), outbox=self.outbox,
                    extract_text=lambda p, o: 'Packing Slip Delivery Number: 12345678')
        w.config_client.http = http
        w._get_token = w.config_client.token_provider = lambda: TOKEN
        w.log = w.config_client.log = lambda level, msg: self.logs.append((level, msg))
        return w, calls

    def test_change_applies_between_captures_never_mid_file(self):
        w, calls = self.config_watcher([route_doc(1)])
        w.initial_route_config()
        w.prepare_dirs()
        live = route_doc(2, {8: {'mode': 'LIVE', 'uploadEnabled': True}})

        def extract(path, ocr):
            # Truck Log switches DGL to LIVE while this file is being verified.
            w.config_client.http = lambda *a, **k: W.HttpResult(200, json.dumps(live).encode())
            w.config_client.refresh(w.route_doc)
            return 'Packing Slip Delivery Number: 12345678'
        w.extract_text = extract
        self.make_capture()
        self.assertEqual(self.settle(w), 1)
        self.assertEqual(calls, [])                      # the file in progress stayed TEST
        self.assertEqual(w.routes[7].mode, 'TEST')
        self.assertEqual(self.pending(self.outbox), [])  # and upload stayed off for it
        w.apply_pending_config()                         # run loop: between captures
        self.assertEqual(w.routes[7].mode, 'LIVE')
        w.extract_text = lambda p, o: 'Packing Slip Delivery Number: 87654321'
        self.make_capture(sample_pdf(b'next'))
        self.assertEqual(self.settle(w), 1)
        self.assertEqual(calls, ['\\\\USFTWPLVPS03\\USFTWP_Route8_Ricoh'])
        self.assertEqual(len(self.pending(self.outbox)), 1)
        self.assertIn('route 8 DGL: TEST -> LIVE (version 2 by mlopez)', [m for _, m in self.logs])
        self.assertIn('route 8 DGL: upload off -> on (version 2 by mlopez)', [m for _, m in self.logs])

    def test_run_loop_applies_pending_config_and_stops_on_stop_file(self):
        w, calls = self.config_watcher([route_doc(1)])
        stop = self.base / 'state' / 'service-stop.request'
        w.stop_file, w.run_id = stop, 'run-1234-abcd'
        loops = []
        live = route_doc(2, {8: {'mode': 'LIVE'}})
        real_scan = w.scan

        def scan():
            loops.append([r.mode for r in w.routes][7])
            if len(loops) == 1:
                w.config_client._pending = live       # arrives from the poller thread
            if len(loops) == 2:
                stop.write_text('run-1234-abcd')
            return real_scan()
        w.scan = scan
        with mock.patch.object(W, 'check_legacy_watcher'), mock.patch.object(W.time, 'sleep'):
            w.run(service=True)
        self.assertEqual(loops, ['TEST', 'LIVE'])
        self.assertIn('service stop requested', repr(self.logs))

    def test_wrong_run_id_in_stop_file_is_ignored(self):
        w, _ = self.make_watcher()
        w.stop_file, w.run_id = self.base / 'stop', 'abc-12345678'
        w.stop_file.write_text('other-run')
        self.assertFalse(w.stop_requested())
        w.stop_file.write_text('abc-12345678\r\n')
        self.assertTrue(w.stop_requested())

    def test_file_left_while_off_is_not_printed_after_switching_live(self):
        w, calls = self.config_watcher([route_doc(1, {8: {'mode': 'OFF'}})])
        w.initial_route_config()
        w.prepare_dirs()
        self.make_capture()
        self.assertEqual(capture_and_process(w), 0)                    # OFF: not read
        w.config_client.http = lambda *a, **k: W.HttpResult(200, json.dumps(
            route_doc(2, {8: {'mode': 'LIVE', 'uploadEnabled': True}})).encode())
        w.config_client.refresh(w.route_doc)
        w.apply_pending_config()
        self.assertEqual(self.settle(w), 1)
        self.assertEqual(calls, [])
        self.assertEqual(len(list(self.route.needs_review.glob('*.pdf'))), 1)
        [entry] = self.pending(self.outbox)
        self.assertEqual(entry['metadata']['outputPrinter'], W.CAPTURED_WHILE_OFF_PRINTER)
        self.assertIn('OFF', entry['metadata']['reviewReason'])
        self.make_capture(sample_pdf(b'fresh'))          # a new print after the switch does print
        self.assertEqual(self.settle(w), 1)
        self.assertEqual(len(calls), 1)


class TokenPasteTests(unittest.TestCase):
    TOKEN = "tlpa_" + "0a" * 8 + "_" + "1b" * 32

    def test_token_found_in_label_control_characters_and_wrapped_lines(self):
        t = self.TOKEN
        for text in (t, "  " + t + "\r\n", "Bearer token (shown once): " + t, "\x16" + t,
                     t[:40] + "\r\n" + t[40:], "Key ID: 0a0a0a0a0a0a0a0a\nBearer token (shown once): " + t + "\n"):
            self.assertEqual(W.extract_token(text), t)
        for text in ("", "\x16", t[:-1], t + "0", "tlpa_short", t + " tlpa_" + "ff" * 8 + "_" + "ee" * 32):
            self.assertIsNone(W.extract_token(text))

    def test_rejected_paste_is_described_without_revealing_it(self):
        self.assertIn("nothing was received", W.describe_bad_token_input("\x16"))
        self.assertIn("do not contain tlpa_", W.describe_bad_token_input("hello"))
        text = W.describe_bad_token_input(self.TOKEN[:50])
        self.assertIn("50 characters", text)
        self.assertNotIn(self.TOKEN[:20], text)

    def test_setup_uses_clipboard_when_hidden_paste_fails(self):
        import getpass
        from unittest import mock
        settings = mock.Mock()
        settings.truck_log = mock.Mock(api_base="http://x/api/v1", credential_file="f", credential_format="dpapi", dpapi_scope="LocalMachine")
        stored = []
        with mock.patch.object(getpass, "getpass", return_value="\x16"), \
                mock.patch.object(W, "store_token", side_effect=lambda tl, token: stored.append(token)), \
                mock.patch.object(W, "load_token", side_effect=lambda tl: stored[-1]), \
                mock.patch.object(W, "setup_check", return_value=(True, "ok")), \
                mock.patch("builtins.print"):
            self.assertEqual(W.setup_upload_command(settings, clipboard=lambda: "Bearer token (shown once): " + self.TOKEN), 0)
            self.assertEqual(stored, [self.TOKEN])
            with self.assertRaises(W.WatcherError) as raised:
                W.setup_upload_command(settings, clipboard=lambda: "")
            self.assertIn("nothing was received", str(raised.exception))
            self.assertEqual(stored, [self.TOKEN])


class CredentialTests(Base):
    def test_file_credential_is_owner_only(self):
        tl = self.tl_settings()
        W.store_token(tl, TOKEN)
        self.assertEqual(tl.credential_file.stat().st_mode & 0o777, 0o600)
        self.assertEqual([p.name for p in tl.credential_file.parent.iterdir()], ['cred'])

    def test_acl_command_on_windows(self):
        seen = []

        def runner(cmd, **kw):
            seen.append(cmd)
            return types.SimpleNamespace(returncode=0)
        target = self.base / 'cred'
        with mock.patch.object(W.os, 'name', 'nt'), mock.patch.dict(W.os.environ, {'SystemRoot': 'C:\\Windows'}):
            W.protect_credential_acl(target, runner=runner)
        self.assertEqual(seen[0][1:], [str(target), '/inheritance:r', '/grant:r', '*S-1-5-18:F', '*S-1-5-32-544:F'])
        self.assertTrue(seen[0][0].endswith('icacls.exe'))

        def failing(cmd, **kw):
            return types.SimpleNamespace(returncode=5)
        with mock.patch.object(W.os, 'name', 'nt'), self.assertRaisesRegex(WatcherError, 'Administrator'):
            W.protect_credential_acl(target, runner=failing)

    def test_current_user_credential_migrated_to_local_machine(self):
        def fake_dpapi(data, protect, local_machine):
            return (b'LM:' if local_machine else b'CU:') + data if protect else data[3:]
        tl = self.tl_settings(credential_format='dpapi', dpapi_scope='LocalMachine')
        with mock.patch.object(W, '_dpapi', fake_dpapi):
            W.store_token(tl, TOKEN, scope='CurrentUser')
            self.assertEqual(W.credential_protection(tl), 'dpapi-CurrentUser')
            W.migrate_credential(tl)
            self.assertEqual(W.credential_protection(tl), 'dpapi-LocalMachine')
            self.assertEqual(W.load_token(tl), TOKEN)
            doc = json.loads(tl.credential_file.read_text())
            self.assertTrue(base64.b64decode(doc['data']).startswith(b'LM:'))
            self.assertNotIn(TOKEN, tl.credential_file.read_text())

    def test_unreadable_credential_message(self):
        tl = self.tl_settings()
        W.store_token(tl, TOKEN)
        with mock.patch.object(Path, 'read_text', side_effect=PermissionError(13, 'denied')):
            with self.assertRaisesRegex(WatcherError, 'Administrators'):
                W.load_token(tl)


class ServiceTests(Base):
    """The C# host starts `run --service --stop-file ... --run-id ...`; check the Python side and the sources."""

    def ini(self):
        text = (HERE / 'watcher.ini').read_text(encoding='utf-8')
        root = str(self.base / 'TL').replace('\\', '/')
        text = text.replace('C:\\TruckLog\\', root + '/').replace('\\', '/')
        text = text.replace('https://trucklog.example', 'http://127.0.0.1:9').replace('allow_http = no', 'allow_http = yes')
        p = self.base / 'watcher.ini'
        p.write_text(text, encoding='utf-8')
        return p

    def test_service_arguments_validated(self):
        for argv in (['run', '--service'], ['run', '--service', '--stop-file', 'x'],
                     ['check', '--service', '--stop-file', 'x', '--run-id', 'abcdefgh-1'],
                     ['run', '--stop-file', 'x'], ['run', '--run-id', 'abcdefgh-1'],
                     ['run', '--service', '--stop-file', 'x', '--run-id', 'bad id;']):
            with self.assertRaises(SystemExit) as cm, contextlib.redirect_stderr(io.StringIO()):
                W.main(argv + ['--config', 'nowhere.ini'])
            self.assertEqual(cm.exception.code, 2, argv)

    def test_service_run_until_stop_file(self):
        cfg = self.ini()
        state = self.base / 'TL' / 'SAPWatcherState'
        stop = state / 'service-stop.request'
        run_id = '0123abcd-4567-89ef'

        def stopper():
            for _ in range(200):
                if (state / 'watcher.log').exists() and 'START' in (state / 'watcher.log').read_text():
                    break
                time.sleep(.05)
            stop.write_text(run_id)
        threading.Thread(target=stopper, daemon=True).start()
        saved = sys.stdout, sys.stderr
        try:
            with mock.patch.dict(W.os.environ, {'TRUCK_LOG_WATCHER_SIMULATION': '1'}), \
                    mock.patch.object(W, 'check_legacy_watcher'):
                rc = W.main(['run', '--service', '--config', str(cfg), '--stop-file', str(stop), '--run-id', run_id])
            console = sys.stdout
        finally:
            sys.stdout, sys.stderr = saved
        console.close()
        self.assertEqual(rc, 0)
        log = (state / 'watcher.log').read_text()
        self.assertIn('service polling', log)
        self.assertIn('SAFE_DEFAULT', log)
        self.assertIn('service stop requested', log)
        self.assertTrue((state / 'watcher-service-console.log').exists())

    def test_service_mode_config_error_goes_to_console_log_with_exit_2(self):
        bad = self.base / 'bad.ini'
        bad.write_text('[watcher]\nlive_print_armed = yes\n')
        stop = self.base / 'st' / 'service-stop.request'
        saved = sys.stdout, sys.stderr
        try:
            rc = W.main(['run', '--service', '--config', str(bad), '--stop-file', str(stop), '--run-id', 'abcdefgh-12'])
            sys.stderr.close()
        finally:
            sys.stdout, sys.stderr = saved
        self.assertEqual(rc, 2)
        self.assertIn('live_print_armed', (self.base / 'st' / 'watcher-service-console.log').read_text())

    def test_conflicts_command_exit_codes(self):
        cmd = r'"C:\W\.venv\Scripts\python.exe" "C:\W\sap_capture_watcher.py" run'
        with contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(W.conflicts_command(lambda: [{'ProcessId': 99999, 'ParentProcessId': 1, 'CommandLine': cmd}]), 3)
            self.assertEqual(W.conflicts_command(lambda: []), 0)

    def test_csharp_host_source(self):
        cs = (HERE / 'WatcherServiceHost.cs').read_text()
        self.assertIn('"TruckLogPackingSlipWatcher"', cs)
        self.assertIn('0x2000; // KILL_ON_JOB_CLOSE', cs)
        self.assertIn('"-I -u " + Quote(script) + " run --service --config " + Quote(config)', cs)
        self.assertIn('" --stop-file " + Quote(StopFile) + " --run-id " + runId', cs)
        # host joins the job BEFORE starting the venv launcher (its child must inherit the job)
        self.assertLess(cs.index('AssignProcessToJobObject(job, Process.GetCurrentProcess().Handle)'),
                        cs.index('worker.Start()'))
        self.assertIn('Environment.Exit(1)', cs)          # unexpected exit -> SCM restart
        self.assertIn('service-stop.request', cs)
        self.assertIn('service-host.log', cs)
        self.assertEqual(cs.count('{'), cs.count('}'))
        self.assertEqual(cs.count('('), cs.count(')'))
        ps1 = (HERE / 'INSTALL-WATCHER-SERVICE.ps1').read_text()
        for needle in ("'delayed-auto'", "'obj=', 'LocalSystem'", 'restart/10000/restart/30000/restart/60000',
                       "'failureflag'", '*S-1-5-18:F', '*S-1-5-32-544:F', 'migrate-credential', ' conflicts',
                       "'/reference:System.ServiceProcess.dll'", 'Framework64\\v4.0.30319\\csc.exe',
                       'TruckLogSAPCaptureWatcher-Restored', '-DependsOn \'Spooler\''):
            self.assertIn(needle, ps1)
        self.assertNotIn('--service', W.Path(HERE / 'START-WATCHER.cmd').read_text())

    def test_scripts_have_crlf_and_old_logon_installer_gone(self):
        self.assertFalse((HERE / 'INSTALL-USER-LOGON-TASK.ps1').exists())
        for name in ('INSTALL-WATCHER-SERVICE', 'REMOVE-WATCHER-SERVICE', 'STATUS-WATCHER-SERVICE'):
            for ext in ('.cmd', '.ps1'):
                self.assertTrue((HERE / (name + ext)).is_file(), name + ext)
        for path in list(HERE.glob('*.cmd')) + list(HERE.glob('*.ps1')):
            data = path.read_bytes()
            self.assertEqual(data.count(b'\n'), data.count(b'\r\n'), path.name)
            data.decode('ascii')


if __name__ == '__main__':
    unittest.main()
