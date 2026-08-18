from __future__ import annotations
import asyncio
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable, Sequence

from server.infra.logger import log


@dataclass
class CompletedProcess:
    cmd: list[str]
    returncode: int
    stdout: str
    stderr: str
    execution_ms: int
    timed_out: bool = False


async def run(
    cmd: Sequence[str],
    work_dir: Path,
    timeout_sec: int = 120,
    on_stdout: Callable[[str], None] | None = None,
    on_stderr: Callable[[str], None] | None = None,
) -> CompletedProcess:
    import time
    t0 = time.perf_counter()
    work_dir = Path(work_dir)
    work_dir.mkdir(parents=True, exist_ok=True)
    try:
        proc = await asyncio.create_subprocess_exec(
            *list(cmd),
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            cwd=str(work_dir),
        )
    except FileNotFoundError as e:
        dt_ms = int((time.perf_counter() - t0) * 1000)
        return CompletedProcess(list(cmd), 127, "", f"Executable not found: {e}", dt_ms, False)

    assert proc.stdout and proc.stderr
    out_lines: list[str] = []
    err_lines: list[str] = []

    async def _read_pipe(stream, out_list: list[str], callback):
        while True:
            line_bytes = await stream.readline()
            if not line_bytes:
                break
            try:
                line = line_bytes.decode("utf-8", errors="replace").rstrip("\r\n")
            except Exception:
                line = repr(line_bytes)
            out_list.append(line)
            if callback:
                try:
                    callback(line)
                except Exception:
                    pass

    timed_out = False
    try:
        await asyncio.wait_for(
            asyncio.gather(
                _read_pipe(proc.stdout, out_lines, on_stdout),
                _read_pipe(proc.stderr, err_lines, on_stderr),
            ),
            timeout=timeout_sec,
        )
        rc = await proc.wait()
    except asyncio.TimeoutError:
        timed_out = True
        try:
            proc.terminate()
            await asyncio.wait_for(proc.wait(), timeout=2)
        except Exception:
            try:
                proc.kill()
                await asyncio.wait_for(proc.wait(), timeout=2)
            except Exception:
                pass
        rc = -1
        err_lines.append(f"[HARNESS] process timed out after {timeout_sec}s")
        log.warn("process_runner.timeout", cmd=list(cmd), timeout=timeout_sec)

    dt_ms = int((time.perf_counter() - t0) * 1000)
    return CompletedProcess(
        cmd=list(cmd),
        returncode=rc,
        stdout="\n".join(out_lines),
        stderr="\n".join(err_lines),
        execution_ms=dt_ms,
        timed_out=timed_out,
    )
