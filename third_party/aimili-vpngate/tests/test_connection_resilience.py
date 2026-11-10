import os
import sys
import tempfile
import threading
import unittest
from unittest.mock import patch


DATA_DIR = tempfile.TemporaryDirectory(prefix="aimili-test-")
os.environ["VPNGATE_DATA_DIR"] = DATA_DIR.name
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

import vpngate_manager as manager  # noqa: E402


class ConnectionResilienceTests(unittest.TestCase):
    def tearDown(self):
        manager.active_connection_cancel_event = None
        manager.pending_openvpn_process = None
        manager.background_refill_thread = None
        manager.background_refill_cancel_event.clear()

    def test_cancel_pending_connection_signals_and_stops_process(self):
        cancel_event = threading.Event()
        process = object()
        manager.active_connection_cancel_event = cancel_event
        manager.pending_openvpn_process = process

        with patch.object(manager, "stop_process") as stop_process:
            manager.cancel_pending_connection_attempt()

        self.assertTrue(cancel_event.is_set())
        self.assertIsNone(manager.pending_openvpn_process)
        stop_process.assert_called_once_with(process)

    def test_background_refill_does_not_start_duplicate_worker(self):
        class RunningThread:
            @staticmethod
            def is_alive():
                return True

        manager.background_refill_thread = RunningThread()
        with patch.object(manager.threading, "Thread") as thread_factory:
            self.assertFalse(manager.schedule_background_refill())
        thread_factory.assert_not_called()

    def test_unhealthy_proxy_is_not_reported_as_connected(self):
        self.assertIsNone(manager.proxy_health_error({"ok": True}))
        self.assertIn(
            "代理出口不可用",
            manager.proxy_health_error({"ok": False, "error": "出口超时"}),
        )


if __name__ == "__main__":
    unittest.main()
