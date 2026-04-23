from __future__ import annotations

import shutil
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Optional, Sequence


@dataclass(frozen=True)
class CodexRunResult:
    """Structured result from a non-interactive Codex execution."""

    command: tuple[str, ...]
    stdout: str
    stderr: str
    returncode: int


class CodexRunnerError(RuntimeError):
    """Raised when the Codex CLI invocation fails."""

    def __init__(self, message: str, result: Optional[CodexRunResult] = None) -> None:
        super().__init__(message)
        self.result = result


def _find_codex_executable() -> str:
    exe = shutil.which("codex")
    if exe:
        return exe
    raise CodexRunnerError(
        "The `codex` CLI was not found in PATH. Install it first, for example with `npm i -g @openai/codex`."
    )


def _format_command(command: Sequence[str]) -> str:
    return subprocess.list2cmdline(list(command))


def _format_failure(result: CodexRunResult) -> str:
    return "\n".join(
        [
            "Codex execution failed.",
            f"Command: {_format_command(result.command)}",
            f"Exit code: {result.returncode}",
            "STDOUT:",
            result.stdout.rstrip(),
            "STDERR:",
            result.stderr.rstrip(),
        ]
    )


def _is_git_repo(path: str | Path) -> bool:
    current = Path(path).resolve()
    for candidate in (current, *current.parents):
        if (candidate / ".git").exists():
            return True
    return False


def run_codex(
    prompt: str,
    cwd: str | Path = ".",
    model: Optional[str] = None,
    sandbox: Optional[str] = None,
    approval: Optional[str] = None,
    output_last_message: Optional[str | Path] = None,
    json_mode: bool = False,
    extra_args: Optional[list[str]] = None,
    check: bool = True,
) -> CodexRunResult:
    """Run Codex in non-interactive mode and return the process result."""

    exe = _find_codex_executable()
    cmd: list[str] = [
        exe,
        "exec",
        "--cd",
        str(Path(cwd).resolve()),
    ]

    if not _is_git_repo(cwd):
        cmd.append("--skip-git-repo-check")

    if model:
        cmd += ["--model", model]

    if sandbox:
        cmd += ["--sandbox", sandbox]

    if approval:
        cmd += ["-c", f'approval_policy="{approval}"']

    if json_mode:
        cmd.append("--json")

    if output_last_message:
        cmd += ["--output-last-message", str(output_last_message)]

    if extra_args:
        cmd += extra_args

    cmd.append("-")

    completed = subprocess.run(
        cmd,
        input=prompt,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        check=False,
    )
    result = CodexRunResult(
        command=tuple(cmd),
        stdout=completed.stdout,
        stderr=completed.stderr,
        returncode=completed.returncode,
    )

    if check and result.returncode != 0:
        raise CodexRunnerError(_format_failure(result), result=result)

    return result
