from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
import tempfile
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Optional, TextIO
from urllib.error import HTTPError, URLError
from urllib.request import urlopen

try:
    from .codex_runner import CodexRunResult, CodexRunnerError, run_codex
except ImportError:
    from codex_runner import CodexRunResult, CodexRunnerError, run_codex


ROOT = Path(__file__).resolve().parents[1]
SPECS_DIR = ROOT / "specs"
SPRINTS_DIR = ROOT / "sprints"
EVALS_DIR = ROOT / "evaluations"
BUILD_DIR = ROOT / "build"


class HarnessError(RuntimeError):
    """Raised when the local automation harness detects invalid artifacts."""


@dataclass
class DevServerHandle:
    process: subprocess.Popen[str]
    log_file: TextIO


def latest_json(path: Path, pattern: str) -> Optional[Path]:
    items = sorted(path.glob(pattern))
    return items[-1] if items else None


def ensure_pipeline_dirs() -> None:
    SPECS_DIR.mkdir(parents=True, exist_ok=True)
    SPRINTS_DIR.mkdir(parents=True, exist_ok=True)
    EVALS_DIR.mkdir(parents=True, exist_ok=True)


def spec_path() -> Path:
    return SPECS_DIR / "spec.json"


def sprint_eval_path(sprint: int) -> Path:
    return SPRINTS_DIR / f"sprint_{sprint}_eval.json"


def evaluation_report_path(sprint: int) -> Path:
    return EVALS_DIR / f"sprint_{sprint}_report.json"


def _write_stream(content: str, *, stream: Any) -> None:
    if not content:
        return
    stream.write(content)
    if not content.endswith("\n"):
        stream.write("\n")


def print_run_result(result: CodexRunResult) -> None:
    _write_stream(result.stdout, stream=sys.stdout)
    _write_stream(result.stderr, stream=sys.stderr)


def _build_plan_prompt(description: str) -> str:
    return f"""
This is an automated harness invocation.
Read AGENTS.md and use the planner skill.
Work non-interactively in a single run.
Do not ask follow-up questions.
Treat the request below as complete and final.
Actually write specs/spec.json before finishing.
Do not reply with a request for more input or a plan-only note.
Create or overwrite specs/spec.json for this request:

{description}

Requirements:
- produce a browser-demoable product plan
- make acceptance criteria concrete
- save to specs/spec.json
- do not implement application code
- if any detail is missing, make reasonable assumptions and record them in the spec
""".strip()


def _build_generate_prompt(sprint: int, failure_feedback: Optional[dict[str, Any]] = None) -> str:
    feedback_section = ""
    if failure_feedback is not None:
        feedback_json = json.dumps(failure_feedback, indent=2, ensure_ascii=False)
        feedback_section = f"""

Use the latest evaluation report below as the authoritative failure feedback.
Do not change specs/spec.json.
Fix build/ only.

Latest evaluation report:
```json
{feedback_json}
```
""".rstrip()

    return f"""
This is an automated harness invocation.
Read AGENTS.md and use the generator skill.
Read specs/spec.json before making changes.
Work non-interactively in a single run.
Do not ask follow-up questions.
Do not ask for the sprint number again.
Actually modify files in build/ and write sprints/sprint_{sprint}_eval.json before finishing.
Do not stop at analysis, a plan, or a readiness note.
Implement sprint {sprint} in this repository.{feedback_section}

Requirements:
- update code in build/
- preserve existing working behavior unless the spec requires changes
- update build/README.md if setup or run steps changed
- write sprints/sprint_{sprint}_eval.json with an honest self-evaluation
- run the smallest relevant validation before finishing
- write sprints/sprint_{sprint}_eval.json as valid JSON with this minimum shape:
  {{
    "sprint": {sprint},
    "implemented": ["..."],
    "known_issues": ["..."],
    "run_instructions": {{
      "install": "npm install",
      "dev": "npm run dev"
    }}
  }}
""".strip()


def _build_evaluate_prompt(sprint: int, url: str) -> str:
    return f"""
This is an automated harness invocation.
Read AGENTS.md and use the evaluator skill.
Read specs/spec.json and sprints/sprint_{sprint}_eval.json.
Work non-interactively in a single run.
Do not ask follow-up questions.
Actually write evaluations/sprint_{sprint}_report.json before finishing.
Do not stop at analysis or a status note.
Evaluate sprint {sprint} for the app at {url}.

Requirements:
- prefer Playwright MCP if available
- if Playwright MCP is unavailable, say so explicitly and use the smallest honest fallback validation path
- write evaluations/sprint_{sprint}_report.json
- list concrete passes, failures, and next actions
- write evaluations/sprint_{sprint}_report.json as valid JSON with this minimum shape:
  {{
    "sprint": {sprint},
    "target_url": "{url}",
    "status": "PASS",
    "checks": [],
    "bugs": [],
    "next_actions": []
  }}
- the status field must be exactly "PASS" or "FAIL"
""".strip()


def run_plan(
    description: str,
    *,
    approval: Optional[str] = None,
    sandbox: Optional[str] = None,
) -> CodexRunResult:
    ensure_pipeline_dirs()
    return run_codex(
        _build_plan_prompt(description),
        cwd=ROOT,
        approval=approval,
        sandbox=sandbox,
    )


def run_generate(
    sprint: int,
    *,
    failure_feedback: Optional[dict[str, Any]] = None,
    approval: Optional[str] = None,
    sandbox: Optional[str] = None,
) -> CodexRunResult:
    ensure_pipeline_dirs()
    return run_codex(
        _build_generate_prompt(sprint, failure_feedback=failure_feedback),
        cwd=ROOT,
        approval=approval,
        sandbox=sandbox,
    )


def run_evaluate(
    sprint: int,
    url: str,
    *,
    approval: Optional[str] = None,
    sandbox: Optional[str] = None,
) -> CodexRunResult:
    ensure_pipeline_dirs()
    return run_codex(
        _build_evaluate_prompt(sprint, url),
        cwd=ROOT,
        approval=approval,
        sandbox=sandbox,
    )


def load_json_file(path: Path) -> Any:
    if not path.exists():
        raise HarnessError(f"Required JSON artifact was not created: {path}")

    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise HarnessError(f"Invalid JSON in {path}: {exc}") from exc


def validate_spec_file() -> dict[str, Any]:
    data = load_json_file(spec_path())
    if not isinstance(data, dict):
        raise HarnessError(f"Specification file must contain a JSON object: {spec_path()}")
    return data


def _require_string_list(value: Any, *, field_name: str, path: Path) -> list[str]:
    if not isinstance(value, list) or any(not isinstance(item, str) for item in value):
        raise HarnessError(f"{path} must define {field_name} as an array of strings.")
    return value


def _require_list(value: Any, *, field_name: str, path: Path) -> list[Any]:
    if not isinstance(value, list):
        raise HarnessError(f"{path} must define {field_name} as an array.")
    return value


def _require_non_empty_string(value: Any, *, field_name: str, path: Path) -> str:
    if not isinstance(value, str) or not value.strip():
        raise HarnessError(f"{path} must define {field_name} as a non-empty string.")
    return value


def validate_sprint_eval(sprint: int) -> dict[str, Any]:
    path = sprint_eval_path(sprint)
    data = load_json_file(path)
    if not isinstance(data, dict):
        raise HarnessError(f"Sprint self-evaluation must be a JSON object: {path}")

    if data.get("sprint") != sprint:
        raise HarnessError(f"{path} must define sprint={sprint}.")

    _require_string_list(data.get("implemented"), field_name="implemented", path=path)
    _require_string_list(data.get("known_issues"), field_name="known_issues", path=path)

    run_instructions = data.get("run_instructions")
    if not isinstance(run_instructions, dict):
        raise HarnessError(f"{path} must define run_instructions as a JSON object.")

    _require_non_empty_string(run_instructions.get("install"), field_name="run_instructions.install", path=path)
    _require_non_empty_string(run_instructions.get("dev"), field_name="run_instructions.dev", path=path)
    return data


def validate_evaluation_report(sprint: int, url: str) -> dict[str, Any]:
    path = evaluation_report_path(sprint)
    data = load_json_file(path)
    if not isinstance(data, dict):
        raise HarnessError(f"Evaluation report must be a JSON object: {path}")

    if data.get("sprint") != sprint:
        raise HarnessError(f"{path} must define sprint={sprint}.")

    if data.get("target_url") != url:
        raise HarnessError(f"{path} must define target_url={url!r}.")

    status = data.get("status")
    if status not in {"PASS", "FAIL"}:
        raise HarnessError(f"{path} must define status as PASS or FAIL.")

    _require_list(data.get("checks"), field_name="checks", path=path)
    _require_list(data.get("bugs"), field_name="bugs", path=path)
    _require_list(data.get("next_actions"), field_name="next_actions", path=path)
    return data


def _find_npm_executable() -> Optional[str]:
    for candidate in ("npm.cmd", "npm"):
        exe = shutil.which(candidate)
        if exe:
            return exe
    return None


def install_build_dependencies(build_dir: Path) -> bool:
    npm = _find_npm_executable()
    if not npm:
        print("[autodev] npm was not found in PATH; skipping install and continuing to evaluation.", file=sys.stderr)
        return False

    result = subprocess.run(
        [npm, "install"],
        cwd=build_dir,
        capture_output=True,
        text=True,
        check=False,
    )
    _write_stream(result.stdout, stream=sys.stdout)
    _write_stream(result.stderr, stream=sys.stderr)
    if result.returncode != 0:
        print("[autodev] npm install failed; attempting evaluation anyway.", file=sys.stderr)
        return False
    return True


def start_dev_server(build_dir: Path) -> Optional[DevServerHandle]:
    npm = _find_npm_executable()
    if not npm:
        print("[autodev] npm was not found in PATH; cannot start the dev server.", file=sys.stderr)
        return None

    log_file = tempfile.TemporaryFile(mode="w+", encoding="utf-8")
    creationflags = getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0)
    try:
        process = subprocess.Popen(
            [npm, "run", "dev"],
            cwd=build_dir,
            stdout=log_file,
            stderr=log_file,
            text=True,
            creationflags=creationflags,
        )
    except OSError as exc:
        log_file.close()
        print(f"[autodev] Failed to start the dev server: {exc}", file=sys.stderr)
        return None

    return DevServerHandle(process=process, log_file=log_file)


def _dev_server_log_excerpt(handle: Optional[DevServerHandle], *, max_chars: int = 1200) -> str:
    if handle is None:
        return ""

    handle.log_file.flush()
    handle.log_file.seek(0)
    content = handle.log_file.read()
    if len(content) <= max_chars:
        return content
    return content[-max_chars:]


def wait_for_url(url: str, startup_timeout: int, handle: Optional[DevServerHandle]) -> bool:
    if handle is None:
        return False

    deadline = time.monotonic() + startup_timeout
    while time.monotonic() < deadline:
        if handle.process.poll() is not None:
            return False

        try:
            with urlopen(url, timeout=5):
                return True
        except HTTPError:
            return True
        except (URLError, OSError, ValueError):
            time.sleep(1)

    return False


def stop_dev_server(handle: Optional[DevServerHandle]) -> None:
    if handle is None:
        return

    try:
        if handle.process.poll() is None:
            if sys.platform == "win32":
                subprocess.run(
                    ["taskkill", "/PID", str(handle.process.pid), "/T", "/F"],
                    capture_output=True,
                    text=True,
                    check=False,
                )
                try:
                    handle.process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    pass
            else:
                handle.process.terminate()
                try:
                    handle.process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    handle.process.kill()
                    handle.process.wait(timeout=5)
    finally:
        handle.log_file.close()


def cmd_plan(description: str) -> None:
    result = run_plan(description)
    print_run_result(result)


def cmd_generate(sprint: int) -> None:
    result = run_generate(sprint)
    print_run_result(result)


def cmd_evaluate(sprint: int, url: str) -> None:
    result = run_evaluate(sprint, url)
    print_run_result(result)


def cmd_autodev(
    description: str,
    sprint: int,
    max_iterations: int,
    url: str,
    startup_timeout: int,
) -> int:
    if max_iterations < 1:
        raise HarnessError("--max-iterations must be at least 1.")

    if startup_timeout < 1:
        raise HarnessError("--startup-timeout must be at least 1.")

    ensure_pipeline_dirs()

    print(f"[autodev] Planning sprint {sprint}.")
    plan_result = run_plan(description, approval="never", sandbox="workspace-write")
    print_run_result(plan_result)
    validate_spec_file()

    failure_feedback: Optional[dict[str, Any]] = None

    for attempt in range(1, max_iterations + 1):
        print(f"[autodev] Iteration {attempt}/{max_iterations}: generate.")
        generate_result = run_generate(
            sprint,
            failure_feedback=failure_feedback,
            approval="never",
            sandbox="workspace-write",
        )
        print_run_result(generate_result)
        validate_sprint_eval(sprint)

        dev_server_handle: Optional[DevServerHandle] = None
        package_json = BUILD_DIR / "package.json"

        try:
            if package_json.exists():
                print("[autodev] Installing build dependencies.")
                install_build_dependencies(BUILD_DIR)
                print("[autodev] Starting dev server.")
                dev_server_handle = start_dev_server(BUILD_DIR)
                if wait_for_url(url, startup_timeout, dev_server_handle):
                    print(f"[autodev] Dev server is reachable at {url}.")
                else:
                    print(f"[autodev] Dev server did not become reachable at {url}; continuing to evaluation.")
                    log_excerpt = _dev_server_log_excerpt(dev_server_handle)
                    if log_excerpt.strip():
                        print("[autodev] Dev server log excerpt:")
                        print(log_excerpt.rstrip())
            else:
                print("[autodev] build/package.json is missing; continuing to evaluation without local startup.")

            print(f"[autodev] Iteration {attempt}/{max_iterations}: evaluate.")
            evaluate_result = run_evaluate(
                sprint,
                url,
                approval="never",
                sandbox="workspace-write",
            )
            print_run_result(evaluate_result)
        finally:
            stop_dev_server(dev_server_handle)

        report = validate_evaluation_report(sprint, url)
        status = report["status"]
        if status == "PASS":
            print(f"[autodev] Sprint {sprint} passed on iteration {attempt}.")
            return 0

        failure_feedback = report
        if attempt < max_iterations:
            print(f"[autodev] Sprint {sprint} failed on iteration {attempt}; retrying with evaluator feedback.")

    print(f"[autodev] Reached the iteration limit ({max_iterations}) without a PASS report.")
    return 1


def cmd_status() -> None:
    status = {
        "spec_exists": spec_path().exists(),
        "latest_sprint_eval": str(latest_json(SPRINTS_DIR, "sprint_*_eval.json")) if SPRINTS_DIR.exists() else None,
        "latest_evaluation_report": str(latest_json(EVALS_DIR, "sprint_*_report.json")) if EVALS_DIR.exists() else None,
        "build_exists": BUILD_DIR.exists(),
        "build_readme_exists": (BUILD_DIR / "README.md").exists(),
    }
    print(json.dumps(status, indent=2, ensure_ascii=False))


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Codex-backed orchestrator for the Travel App pipeline")
    subparsers = parser.add_subparsers(dest="command", required=True)

    plan_parser = subparsers.add_parser("plan", help="Create or update specs/spec.json")
    plan_parser.add_argument("description", help="Product description")

    gen_parser = subparsers.add_parser("generate", help="Implement a sprint")
    gen_parser.add_argument("sprint", type=int, help="Sprint number to implement")

    eval_parser = subparsers.add_parser("evaluate", help="Evaluate a sprint")
    eval_parser.add_argument("sprint", type=int, help="Sprint number to evaluate")
    eval_parser.add_argument("url", nargs="?", default="http://localhost:3000", help="App URL")

    autodev_parser = subparsers.add_parser("autodev", help="Run plan/generate/evaluate in a local loop")
    autodev_parser.add_argument("description", help="Product description")
    autodev_parser.add_argument("--sprint", type=int, default=1, help="Sprint number to implement and evaluate")
    autodev_parser.add_argument("--max-iterations", type=int, default=3, help="Maximum number of generate/evaluate loops")
    autodev_parser.add_argument("--url", default="http://localhost:3000", help="App URL to evaluate")
    autodev_parser.add_argument(
        "--startup-timeout",
        type=int,
        default=120,
        help="Seconds to wait for the local dev server before continuing to evaluation",
    )

    subparsers.add_parser("status", help="Show pipeline status")
    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()

    try:
        if args.command == "plan":
            cmd_plan(args.description)
        elif args.command == "generate":
            cmd_generate(args.sprint)
        elif args.command == "evaluate":
            cmd_evaluate(args.sprint, args.url)
        elif args.command == "autodev":
            return cmd_autodev(
                description=args.description,
                sprint=args.sprint,
                max_iterations=args.max_iterations,
                url=args.url,
                startup_timeout=args.startup_timeout,
            )
        elif args.command == "status":
            cmd_status()
        else:
            parser.error(f"Unknown command: {args.command}")
    except (CodexRunnerError, HarnessError) as exc:
        print(str(exc))
        return 1

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
