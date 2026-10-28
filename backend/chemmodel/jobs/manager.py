"""Background calculation jobs.

Each job runs in its own process so long calculations never block the API,
and can be cancelled by terminating that process. Results are cached on
disk under a hash of (task, parameters, code version), which also makes the
job id reproducible: submitting identical settings returns the cached result.
"""

from __future__ import annotations

import hashlib
import json
import multiprocessing as mp
import os
import threading
import time
import traceback
from pathlib import Path
from typing import Any, Callable

from chemmodel import __version__

CACHE_DIR = Path(os.environ.get("CHEMMODEL_CACHE", Path.home() / ".chemmodel" / "cache"))

# Bump when a task's result schema or numerics change, so stale cached results are not reused.
CACHE_SCHEMA = 2

TaskFn = Callable[[dict, Callable[[str], None], Path], dict]


def _registry() -> dict[str, TaskFn]:
    from chemmodel.jobs import tasks

    return tasks.TASKS


def job_key(kind: str, params: dict) -> str:
    blob = json.dumps({"kind": kind, "params": params, "version": __version__, "schema": CACHE_SCHEMA}, sort_keys=True)
    return hashlib.sha256(blob.encode()).hexdigest()[:24]


def job_dir(job_id: str) -> Path:
    return CACHE_DIR / job_id


def _worker(kind: str, params: dict, workdir: str, queue) -> None:
    def log(msg: str) -> None:
        queue.put(("log", msg))

    try:
        result = _registry()[kind](params, log, Path(workdir))
        # write-then-rename so a cancelled or crashed job never leaves a truncated
        # result.json that later loads as a "cached" result
        tmp = Path(workdir, "result.json.tmp")
        tmp.write_text(json.dumps(result))
        os.replace(tmp, Path(workdir, "result.json"))
        queue.put(("done", None))
    except Exception as exc:  # reported to the client, not swallowed
        queue.put(("error", f"{type(exc).__name__}: {exc}\n{traceback.format_exc(limit=4)}"))


class Job:
    def __init__(self, job_id: str, kind: str, params: dict):
        self.id = job_id
        self.kind = kind
        self.params = params
        self.state = "queued"
        self.logs: list[dict] = []
        self.error: str | None = None
        self.created = time.time()
        self.finished: float | None = None
        self.process: mp.Process | None = None
        self.cached = False

    def add_log(self, msg: str) -> None:
        self.logs.append({"t": time.time() - self.created, "message": msg})

    def to_dict(self, include_result: bool = True) -> dict[str, Any]:
        out: dict[str, Any] = {
            "id": self.id,
            "kind": self.kind,
            "params": self.params,
            "state": self.state,
            "logs": self.logs,
            "error": self.error,
            "cached": self.cached,
            "elapsed_s": (self.finished or time.time()) - self.created,
        }
        if include_result and self.state == "done":
            out["result"] = json.loads((job_dir(self.id) / "result.json").read_text())
        return out


class JobManager:
    def __init__(self) -> None:
        self._jobs: dict[str, Job] = {}
        self._lock = threading.Lock()
        self._ctx = mp.get_context("spawn")  # same behaviour on Windows and Linux

    def submit(self, kind: str, params: dict) -> Job:
        if kind not in _registry():
            raise KeyError(f"unknown job kind {kind!r}")
        job_id = job_key(kind, params)
        with self._lock:
            existing = self._jobs.get(job_id)
            if existing and existing.state in ("queued", "running", "done"):
                return existing
            job = Job(job_id, kind, params)
            self._jobs[job_id] = job
        workdir = job_dir(job_id)
        if (workdir / "result.json").exists():
            job.state, job.cached, job.finished = "done", True, time.time()
            job.add_log("Loaded cached result (identical settings were run before).")
            return job
        workdir.mkdir(parents=True, exist_ok=True)
        (workdir / "params.json").write_text(json.dumps({"kind": kind, "params": params}))
        queue = self._ctx.Queue()
        job.process = self._ctx.Process(target=_worker, args=(kind, params, str(workdir), queue), daemon=True)
        job.state = "running"
        job.process.start()
        threading.Thread(target=self._drain, args=(job, queue), daemon=True).start()
        return job

    def _drain(self, job: Job, queue) -> None:
        while True:
            try:
                kind, payload = queue.get(timeout=0.5)
            except Exception:
                if job.process is not None and not job.process.is_alive():
                    if job.state == "running":
                        job.state = "error"
                        job.error = job.error or "calculation process exited unexpectedly"
                        job.finished = time.time()
                    return
                continue
            if kind == "log":
                job.add_log(payload)
            elif kind == "done":
                job.state, job.finished = "done", time.time()
                return
            elif kind == "error":
                job.state, job.error, job.finished = "error", payload, time.time()
                return

    def get(self, job_id: str) -> Job:
        with self._lock:
            job = self._jobs.get(job_id)
        if job is None:
            if (job_dir(job_id) / "result.json").exists():
                meta = json.loads((job_dir(job_id) / "params.json").read_text())
                job = Job(job_id, meta["kind"], meta["params"])
                job.state, job.cached, job.finished = "done", True, time.time()
                with self._lock:
                    self._jobs[job_id] = job
                return job
            raise KeyError(job_id)
        return job

    def cancel(self, job_id: str) -> Job:
        job = self.get(job_id)
        if job.state == "running" and job.process is not None:
            job.process.terminate()
            job.state, job.finished = "cancelled", time.time()
            job.add_log("Cancelled by user.")
        return job

    def list(self) -> list[dict]:
        with self._lock:
            return [j.to_dict(include_result=False) for j in self._jobs.values()]


manager = JobManager()
