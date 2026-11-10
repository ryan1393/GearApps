import ctypes
import unittest
from decimal import Decimal

from lapper_read.fanuc import Fanuc
from lapper_read.focas import IODBPMC, ODBPM, scale
from tests.fakes import FakeApi, FakeTransport

CYCLE = {"id": "cycle-1", "machine_id": "machine-1", "gearset_id": "gs-373"}


class FocasBindingTests(unittest.TestCase):
    def test_structures_follow_the_c_header_layout(self):
        long = ctypes.sizeof(ctypes.c_long)
        self.assertEqual(ODBPM.mcr_val.offset, 2 * long if long == 8 else 8)
        self.assertEqual(IODBPMC.u.offset, 8)

    def test_macro_scaling_matches_the_csharp_worker(self):
        self.assertEqual(scale(18005, 1), Decimal("1800.5"))
        self.assertEqual(scale(42, 0), Decimal(42))
        self.assertEqual(scale(5, -2), Decimal(500))


class FanucTests(unittest.TestCase):
    def setUp(self):
        self.transport, self.api = FakeTransport(), FakeApi()
        self.fanuc = Fanuc(self.transport, "10.0.0.1", 3000, self.api)
        self.fanuc.initialize()

    def test_missing_macro_is_skipped_not_sent_as_zero(self):
        self.transport.macros[11006] = Decimal("1800")
        values = self.fanuc.capture_macros()
        self.assertNotIn("m-missing", values)
        self.assertEqual(values["m-rpm"], Decimal("1800"))

    def test_only_changed_macros_are_posted(self):
        self.api.summary = [{"macro_id": "m-rpm", "value": 1800}]
        written = self.fanuc.persist_macros(CYCLE, {"m-rpm": Decimal(1800), "m-consec": Decimal(2)}, "req")
        self.assertEqual(written, 1)
        self.assertEqual([c[2] for c in self.api.calls if c[0] == "macro"], ["m-consec"])

    def test_failed_macro_write_is_retried_before_the_baseline_advances(self):
        self.api.fail_macro = {"m-rpm"}
        with self.assertRaises(IOError):
            self.fanuc.persist_macros(CYCLE, {"m-rpm": Decimal(1900)}, "req")
        self.fanuc.persist_macros(CYCLE, {"m-rpm": Decimal(1900)}, "req")
        self.assertIn("req:m-rpm", self.api.macro_logs)

    def test_gearsets_have_independent_baselines(self):
        self.fanuc.persist_macros(CYCLE, {"m-rpm": Decimal(1900)}, "a")
        self.fanuc.persist_macros({**CYCLE, "gearset_id": "gs-410"}, {"m-rpm": Decimal(1900)}, "b")
        self.assertEqual(len(self.api.macro_logs), 2)

    def test_pmc_failure_raises_and_reconnects_instead_of_reporting_false(self):
        self.transport.fail_pmc = True
        with self.assertRaises(IOError):
            self.fanuc.read_state()
        self.transport.fail_pmc = False
        self.fanuc.read_state()
        self.assertEqual(self.transport.opens, 2)
        self.assertEqual(self.transport.closes, 1)

    def test_zero_or_fractional_counter_is_rejected(self):
        self.transport.macros[10032] = Decimal(0)
        with self.assertRaises(IOError):
            self.fanuc.read_state()
        self.transport.macros[10032] = Decimal("2.5")
        with self.assertRaises(IOError):
            self.fanuc.read_state()


if __name__ == "__main__":
    unittest.main()
