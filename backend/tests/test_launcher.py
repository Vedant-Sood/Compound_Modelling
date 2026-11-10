"""Desktop launcher: argument handling and parent-exit detection."""

import io
import os
import threading

import pytest

from chemmodel import launcher


def test_defaults_bind_loopback():
    args = launcher.parse_args([])
    assert args.port == 8000
    assert args.frontend is None
    assert not args.watch_stdin
    assert launcher.HOST == "127.0.0.1"


def test_port_range_checked():
    with pytest.raises(SystemExit):
        launcher.parse_args(["--port", "0"])
    with pytest.raises(SystemExit):
        launcher.parse_args(["--port", "70000"])


def test_watch_stdin_fires_on_eof():
    fired = threading.Event()
    t = launcher.watch_stdin(io.BytesIO(b"ignored input"), fired.set)
    t.join(timeout=2)
    assert fired.is_set()


def test_watch_stdin_waits_while_pipe_open():
    r, w = os.pipe()
    fired = threading.Event()
    with os.fdopen(r, "rb", buffering=0) as stream:
        launcher.watch_stdin(stream, fired.set)
        assert not fired.wait(0.2)
        os.close(w)
        assert fired.wait(2)
