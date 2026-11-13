"""Behavioral regressions for the W3 durable capture queue; no Windows/printer/network calls."""
import json
import sys
import tempfile
import threading
import time
import unittest
from dataclasses import replace
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import sap_capture_watcher as W


def pdf(delivery):
    return f'%PDF-1.4\nPacking Slip Delivery Number: {delivery}\n%%EOF\n'.encode()


class CaptureQueueTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.routes = tuple(W.Route(n, f'Route {n}', self.root / f'stage{n}' / 'capture.pdf',
            self.root / f'route{n}' / 'Incoming', self.root / f'route{n}' / 'Ready',
            self.root / f'route{n}' / 'NeedsReview', r'\\server\Paper', 'LIVE', False, f'SAP-Queue-{n}')
            for n in (1, 2))
        self.config = W.Settings(tuple(r.paths for r in self.routes), self.root / 'state',
                                self.root / 'SumatraPDF.exe', .01, 0, False, 1024 * 1024)
        self.printed = []
        self.logs = []
        self.w = self.watcher()
        self.w.prepare_dirs()

    def watcher(self):
        w = W.Watcher(self.config, routes=self.routes, extract_text=lambda p, _: p.read_text(),
                      submit_print=lambda p, dest: self.printed.append(p.read_text()))
        w.log = lambda level, msg: self.logs.append((level, msg))
        return w

    def stage(self, route, delivery):
        route.capture_file.write_bytes(pdf(delivery))
        self.w.scan()
        self.assertEqual(self.w.scan(), 1)

    def records(self):
        return [json.loads(p.read_text()) for p in (self.root / 'state' / 'journal').glob('*.json')]

    def wait_for(self, predicate):
        deadline = time.monotonic() + 2
        while not predicate() and time.monotonic() < deadline:
            time.sleep(.01)
        self.assertTrue(predicate())

    def exercise_slow_processing(self, block_extraction):
        started, release = threading.Event(), threading.Event()
        extract, submit = self.w.extract_text, self.w.submit_print
        def blocking_extract(p, ocr):
            if '11111111' in p.read_text():
                started.set()
                release.wait(2)
            return extract(p, ocr)
        def blocking_submit(p, dest):
            if '11111111' in p.read_text():
                started.set()
                release.wait(2)
            submit(p, dest)
        if block_extraction:
            self.w.extract_text = blocking_extract
        else:
            self.w.submit_print = blocking_submit
        worker = W.CaptureWorker(self.w)
        worker.start()
        try:
            self.stage(self.routes[0], '11111111')
            self.assertTrue(started.wait(1))
            # These arrivals are each scanned/committed while the slow job is still blocked.
            self.stage(self.routes[1], '22222222')
            self.stage(self.routes[1], '33333333')
            self.assertFalse(self.routes[1].capture_file.exists())
            self.assertEqual(len(list(self.w.capture_queue.glob('*.json'))), 2)
            self.assertEqual(len(self.records()), 3)
            release.set()
            self.wait_for(lambda: len(self.printed) == 3)
            self.assertEqual([text.split(': ')[1].split()[0] for text in self.printed],
                             ['11111111', '22222222', '33333333'])
            self.wait_for(lambda: not list(self.w.capture_queue.glob('*.active')))
        finally:
            release.set()
            worker.stop()
            worker.join(2)
        self.assertFalse(worker.is_alive())

    def test_slow_renderer_does_not_block_other_captures_and_keeps_fifo(self):
        self.exercise_slow_processing(False)

    def test_slow_pdf_extraction_does_not_block_other_captures(self):
        self.exercise_slow_processing(True)

    def test_ready_capture_survives_restart_and_prints_once(self):
        self.stage(self.routes[0], '12345678')
        restarted = self.watcher()
        restarted.prepare_dirs()
        restarted.reconcile_startup()
        self.assertEqual(restarted.process_pending(), 1)
        self.assertEqual(len(self.printed), 1)
        again = self.watcher()
        again.prepare_dirs()
        again.reconcile_startup()
        self.assertEqual(again.process_pending(), 0)
        self.assertEqual(len(self.printed), 1)

    def test_interrupted_active_capture_requires_review_without_reprint(self):
        self.stage(self.routes[0], '12345678')
        queued = next(self.w.capture_queue.glob('*.json'))
        queued.rename(queued.with_suffix('.active'))
        restarted = self.watcher()
        restarted.prepare_dirs()
        restarted.reconcile_startup()
        self.assertEqual(restarted.process_pending(), 0)
        self.assertEqual(self.printed, [])
        self.assertEqual(len(list(self.routes[0].needs_review.glob('*.pdf'))), 1)
        self.assertEqual(self.records()[0]['status'], 'RESTART_REQUIRES_REVIEW_DO_NOT_REPRINT')

    def test_crash_after_submission_before_queue_cleanup_does_not_reprint(self):
        self.stage(self.routes[0], '12345678')
        queued = next(self.w.capture_queue.glob('*.json'))
        entry = json.loads(queued.read_text())
        queued.rename(queued.with_suffix('.active'))
        r, record = self.w._decode_capture(entry)
        self.w._process_record(r, record)  # Simulate a crash before active descriptor is removed.
        restarted = self.watcher()
        restarted.prepare_dirs()
        restarted.reconcile_startup()
        restarted.process_pending()
        self.assertEqual(len(self.printed), 1)
        self.assertEqual(len(list(restarted.capture_queue.glob('review/*.active'))), 1)

    def test_preexisting_staging_capture_is_quarantined_after_off_to_live_restart(self):
        # Capture was written with the service down/OFF. Current LIVE settings cannot prove its provenance.
        self.routes[0].capture_file.write_bytes(pdf('12345678'))
        restarted = self.watcher()
        restarted.prepare_dirs()
        restarted.reconcile_startup()
        self.w = restarted
        self.w.scan()
        self.w.scan()
        self.w.process_pending()
        self.assertEqual(self.printed, [])
        self.assertEqual(len(list(self.routes[0].needs_review.glob('*.pdf'))), 1)
        self.assertIn('startup', self.records()[0]['stale_reason'])
        self.assertTrue(self.w.provenance_file.is_file())

    def test_orphan_incoming_file_is_preserved_for_review(self):
        orphan = self.routes[0].incoming / 'unqueued.pdf'
        orphan.write_bytes(pdf('12345678'))
        self.w.reconcile_startup()
        self.assertFalse(orphan.exists())
        self.assertEqual((self.routes[0].needs_review / orphan.name).read_bytes(), pdf('12345678'))
        self.assertEqual(self.printed, [])

    def test_bounded_queue_retains_staging_and_resumes_when_capacity_frees(self):
        self.w.c = replace(self.config, max_pending_captures=1)
        self.stage(self.routes[0], '11111111')
        self.routes[1].capture_file.write_bytes(pdf('22222222'))
        self.w.scan()
        self.assertEqual(self.w.scan(), 0)
        self.assertEqual(self.w.scan(), 0)
        self.assertTrue(self.routes[1].capture_file.exists())
        self.assertEqual(sum(level == 'QUEUE-FULL' for level, _ in self.logs), 1)
        self.w.process_pending()
        self.assertEqual(self.w.scan(), 1)
        self.w.process_pending()
        self.assertEqual(len(self.printed), 2)

    def test_print_renderer_cancels_on_stop_and_is_marked_uncertain(self):
        self.config.sumatra.touch()
        entered = threading.Event()
        class Renderer:
            def __init__(self): self.killed = False
            def __enter__(self): return self
            def __exit__(self, *_): pass
            def poll(self): entered.set(); return None
            def kill(self): self.killed = True
            def wait(self, **_): return 0
        renderer = Renderer()
        self.w.submit_print = self.w._submit_pdf
        self.stage(self.routes[0], '12345678')
        worker = W.CaptureWorker(self.w)
        with mock.patch.object(W.subprocess, 'Popen', return_value=renderer):
            worker.start()
            self.assertTrue(entered.wait(1))
            worker.stop()
            worker.join(2)
        self.assertFalse(worker.is_alive())
        self.assertTrue(renderer.killed)
        self.assertEqual(self.records()[0]['status'], 'UNCERTAIN_PRINT_DO_NOT_AUTO_RETRY')
        self.assertEqual(len(list(self.routes[0].needs_review.glob('*.pdf'))), 1)

    def test_frozen_test_mode_does_not_become_live_while_queued(self):
        self.w.routes = (replace(self.routes[0], mode='TEST'), self.routes[1])
        self.stage(self.routes[0], '12345678')
        self.w.routes = self.routes
        self.w.process_pending()
        self.assertEqual(self.printed, [])
        self.assertEqual(self.records()[0]['status'], 'TEST_MODE_READY_NOT_PRINTED')


    def test_changed_queued_pdf_is_not_printed(self):
        self.stage(self.routes[0], '12345678')
        incoming = next(self.routes[0].incoming.glob('*.pdf'))
        incoming.write_bytes(pdf('87654321'))
        self.w.process_pending()
        self.assertEqual(self.printed, [])
        self.assertEqual(len(list(self.routes[0].needs_review.glob('*.pdf'))), 1)
        self.assertIn('changed after capture', self.records()[0]['error'])

    def test_queue_commit_failure_leaves_pdf_for_startup_review(self):
        self.routes[0].capture_file.write_bytes(pdf('12345678'))
        self.w.scan()
        write = W.write_json_atomic
        def fail_commit(path, record):
            if path.parent == self.w.capture_queue:
                raise OSError('simulated failed queue commit')
            return write(path, record)
        with mock.patch.object(W, 'write_json_atomic', side_effect=fail_commit):
            with self.assertRaisesRegex(OSError, 'failed queue commit'):
                self.w.scan()
        self.assertEqual(len(list(self.routes[0].incoming.glob('*.pdf'))), 1)
        restarted = self.watcher()
        restarted.prepare_dirs()
        restarted.reconcile_startup()
        self.assertEqual(len(list(self.routes[0].needs_review.glob('*.pdf'))), 1)
        self.assertEqual(self.printed, [])

    def test_full_queue_retains_overwrite_snapshot_until_capacity_frees(self):
        self.w.c = replace(self.config, max_pending_captures=1)
        self.stage(self.routes[0], '11111111')
        self.routes[1].capture_file.write_bytes(pdf('22222222'))
        self.w.scan()  # Snapshot A while queue is full.
        self.routes[1].capture_file.write_bytes(pdf('33333333'))
        self.w.scan()  # Cannot recover A yet; its durable snapshot must stay tracked.
        self.assertTrue(self.w.observed[str(self.routes[1].capture_file)].snapshot.is_file())
        self.w.process_pending()
        self.w.scan()
        self.w.process_pending()
        self.w.scan()
        self.w.process_pending()
        self.assertEqual(sorted(r.get('delivery_number') for r in self.records()),
                         ['11111111', '22222222', '33333333'])
        self.assertEqual(len(self.printed), 2)  # Recovered A is for review only.
        self.assertEqual(len(list(self.routes[1].needs_review.glob('*.pdf'))), 1)

    def test_turning_route_off_revokes_queued_live_prints(self):
        self.stage(self.routes[0], '12345678')
        self.w.routes = (replace(self.routes[0], mode='OFF'), self.routes[1])
        self.w.process_pending()
        self.assertEqual(self.printed, [])
        self.assertEqual(len(list(self.routes[0].needs_review.glob('*.pdf'))), 1)
        self.assertIn('authorization changed', self.records()[0]['stale_reason'])


    def test_service_run_captures_while_renderer_blocks(self):
        running, printing, release = threading.Event(), threading.Event(), threading.Event()
        self.w.stop_file, self.w.run_id = self.root / 'state' / 'stop', 'w3-test-run'
        self.w.log = lambda level, msg: running.set() if level == 'START' else None
        def submit(path, printer):
            if '11111111' in path.read_text():
                printing.set()
                release.wait(2)
            self.printed.append(path.read_text())
        self.w.submit_print = submit
        errors = []
        def service():
            try:
                self.w.run(service=True)
            except Exception as error:
                errors.append(error)
        thread = threading.Thread(target=service, daemon=True)
        with mock.patch.object(W, 'check_legacy_watcher'):
            thread.start()
            try:
                self.assertTrue(running.wait(1))
                self.routes[0].capture_file.write_bytes(pdf('11111111'))
                self.assertTrue(printing.wait(1))
                self.routes[1].capture_file.write_bytes(pdf('22222222'))
                self.wait_for(lambda: len(self.records()) == 2)
                self.routes[1].capture_file.write_bytes(pdf('33333333'))
                self.wait_for(lambda: len(self.records()) == 3)
                release.set()
                self.wait_for(lambda: len(self.printed) == 3)
            finally:
                release.set()
                self.w.stop_file.write_text(self.w.run_id)
                thread.join(2)
        self.assertFalse(thread.is_alive())
        self.assertEqual(errors, [])
        self.assertEqual(len(self.printed), 3)


    def test_disabling_live_route_during_extraction_refuses_submission(self):
        self.stage(self.routes[0], '12345678')
        def extraction(path, _):
            self.w.routes = (replace(self.routes[0], mode='OFF'), self.routes[1])
            return path.read_text()
        self.w.extract_text = extraction
        self.w.process_pending()
        self.assertEqual(self.printed, [])
        self.assertEqual(len(list(self.routes[0].needs_review.glob('*.pdf'))), 1)
        self.assertEqual(self.records()[0]['status'], 'CAPTURE_PROVENANCE_REVIEW_NOT_PRINTED')

    def test_final_rename_race_snapshot_survives_full_queue(self):
        self.w.c = replace(self.config, max_pending_captures=1)
        r = self.routes[0]
        r.capture_file.write_bytes(pdf('11111111'))
        self.w.scan()  # Snapshot A.
        enqueue = self.w._enqueue_capture
        def replace_during_handoff(route, **kw):
            if kw.get('src') is None:
                r.capture_file.write_bytes(pdf('22222222'))  # Swap to B after scan's final hash check.
            return enqueue(route, **kw)
        with mock.patch.object(self.w, '_enqueue_capture', side_effect=replace_during_handoff):
            self.assertEqual(self.w.scan(), 1)
        self.assertTrue(self.w.observed[str(r.capture_file)].snapshot.is_file())
        self.w.process_pending()  # B is accepted and printed once.
        self.w.scan()             # Missing staging file; now recover retained A.
        self.w.process_pending()
        self.assertEqual(sorted(record['delivery_number'] for record in self.records()),
                         ['11111111', '22222222'])
        self.assertEqual(len(self.printed), 1)
        self.assertEqual(len(list(r.needs_review.glob('*.pdf'))), 1)
        self.assertEqual(list((self.config.state_dir / 'snapshots').glob('*.pdf')), [])


    def test_service_shutdown_preserves_unqueued_overwrite_snapshot(self):
        # Model the scanner's durable snapshot while queue saturation defers recovery.
        snapshot = self.config.state_dir / 'snapshots' / 'unqueued.pdf'
        self.w.stop_file, self.w.run_id = self.config.state_dir / 'stop', 'snapshot-stop'
        def last_scan():
            snapshot.write_bytes(pdf('12345678'))
            obs = W.Observation(snapshot.stat().st_size, snapshot.stat().st_mtime_ns, time.monotonic())
            obs.snapshot = snapshot
            self.w.observed[str(self.routes[0].capture_file)] = obs
            self.w.stop_file.write_text(self.w.run_id)
            return 0
        self.w.scan = last_scan
        with mock.patch.object(W, 'check_legacy_watcher'):
            self.w.run(service=True)
        self.assertEqual(snapshot.read_bytes(), pdf('12345678'))
        self.assertTrue(any('Preserved 1 staging snapshot' in message for _, message in self.logs))


if __name__ == '__main__':
    unittest.main()
