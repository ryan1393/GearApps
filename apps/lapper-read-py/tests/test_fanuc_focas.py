import ctypes
import unittest
from decimal import Decimal

from lapper_read.fanuc import Fanuc
from lapper_read.focas import FOCAS_LONG, IODBPMC, ODBPM, scale
from tests.fakes import FakeApi, FakeTransport

CYCLE = {"id": "cycle-1", "machine_id": "machine-1", "gearset_id": "gs-373"}


class FocasBindingTests(unittest.TestCase):
    def test_structures_match_the_focas_library_layout(self):
        # FANUC's 64-bit Linux libfwlib32 (1.0.5) cnc_rdpmacro stores datano at byte 0,
        # mcr_val at byte 8 and dec_val at byte 12: FOCAS longs are 32-bit there too.
        # A platform C long (8 bytes on 64-bit Linux) put mcr_val at byte 16, so every
        # macro read as 0 and the controller looked unavailable.
        self.assertEqual(ctypes.sizeof(FOCAS_LONG), 4)
        self.assertEqual((ODBPM.datano.offset, ODBPM.mcr_val.offset, ODBPM.dec_val.offset), (0, 8, 12))
        self.assertEqual(IODBPMC.u.offset, 8)

    def test_macro_value_is_read_from_where_the_library_writes_it(self):
        data = ODBPM()
        raw = (ctypes.c_ubyte * ctypes.sizeof(ODBPM)).from_buffer(data)
        ctypes.memmove(ctypes.addressof(raw), (10020).to_bytes(4, "little"), 4)
        ctypes.memmove(ctypes.addressof(raw) + 8, (373).to_bytes(4, "little"), 4)
        ctypes.memmove(ctypes.addressof(raw) + 12, (0).to_bytes(2, "little"), 2)
        self.assertEqual((data.datano, scale(data.mcr_val, data.dec_val)), (10020, Decimal(373)))

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
