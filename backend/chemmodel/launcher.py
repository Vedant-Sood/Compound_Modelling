"""Backend entry point used by the desktop shell.

    python -m chemmodel.launcher --port 8765 --frontend /path/to/dist --watch-stdin

Differences from plain `uvicorn chemmodel.api.main:app`:

- always binds to the loopback interface (the desktop app never exposes the API on the network);
- sets ``CHEMMODEL_FRONTEND`` before the app is imported, so the packaged UI is served from the
  given directory instead of the repository checkout;
- with ``--watch-stdin`` the process exits as soon as its standard input reaches EOF. The desktop
  shell keeps a pipe open to the backend and closes it on quit; this also works through
  ``wsl.exe`` on Windows, where killing the Windows-side process would not stop the Linux one.
"""

from __future__ import annotations

import argparse
import os
import sys
import threading
from pathlib import Path
from typing import BinaryIO, Callable

HOST = "127.0.0.1"


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    p = argparse.ArgumentParser(prog="python -m chemmodel.launcher", description=__doc__.splitlines()[0])
    p.add_argument("--port", type=int, default=8000, help="TCP port on 127.0.0.1 (default 8000)")
    p.add_argument("--frontend", type=Path, default=None, help="directory containing the built UI (index.html)")
    p.add_argument("--watch-stdin", action="store_true", help="exit when standard input is closed")
    p.add_argument("--log-level", default="info", choices=["critical", "error", "warning", "info", "debug"])
    args = p.parse_args(argv)
    if not 0 < args.port < 65536:
        p.error(f"port out of range: {args.port}")
    return args


def watch_stdin(stream: BinaryIO, on_eof: Callable[[], None]) -> threading.Thread:
    """Call `on_eof` once `stream` is exhausted (parent closed the pipe or exited)."""

    def run() -> None:
        try:
            while stream.read(4096):
                pass
        except (OSError, ValueError):
            pass
        on_eof()

    t = threading.Thread(target=run, name="stdin-watch", daemon=True)
    t.start()
    return t


def main(argv: list[str] | None = None) -> None:
    args = parse_args(argv)
    if args.frontend is not None:
        if not (args.frontend / "index.html").is_file():
            print(f"warning: no index.html in {args.frontend}; serving API only", file=sys.stderr)
        os.environ["CHEMMODEL_FRONTEND"] = str(args.frontend.resolve())

    if args.watch_stdin:
        # os._exit: job worker threads/processes must not keep the backend alive after the UI quits.
        watch_stdin(sys.stdin.buffer, lambda: os._exit(0))

    import uvicorn

    from chemmodel.api.main import app

    print(f"CHEMMODEL_LISTENING http://{HOST}:{args.port}", flush=True)
    uvicorn.run(app, host=HOST, port=args.port, log_level=args.log_level)


if __name__ == "__main__":
    main()
