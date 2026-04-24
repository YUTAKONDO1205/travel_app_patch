from __future__ import annotations

import argparse
import base64
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Optional, TextIO
from urllib.parse import quote
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

try:
    from .codex_runner import CodexRunResult, CodexRunnerError, run_codex
except ImportError:
    from codex_runner import CodexRunResult, CodexRunnerError, run_codex


ROOT = Path(__file__).resolve().parents[1]
SPECS_DIR = ROOT / "specs"
SPRINTS_DIR = ROOT / "sprints"
EVALS_DIR = ROOT / "evaluations"
BUILD_DIR = ROOT / "build"
SKILLS_DIR = ROOT / ".agents" / "skills"
PLANNER_SKILL_PATH = SKILLS_DIR / "planner" / "SKILL.md"
GENERATOR_SKILL_PATH = SKILLS_DIR / "generator" / "SKILL.md"
EVALUATOR_SKILL_PATH = SKILLS_DIR / "evaluator" / "SKILL.md"
GITHUB_TOKEN_ENV_CANDIDATES = ("GITHUB_TOKEN", "GH_TOKEN")
GITHUB_OWNER_ENV = "GITHUB_OWNER"
GITHUB_REPO_ENV = "GITHUB_REPO"
GITHUB_BRANCH_ENV = "GITHUB_SYNC_BRANCH"
GITHUB_BASE_BRANCH_ENV = "GITHUB_BASE_BRANCH"


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


def _summarize_failure_feedback(report: dict[str, Any]) -> str:
    lines: list[str] = []

    failed_checks = []
    for item in report.get("checks", []):
        if isinstance(item, dict) and item.get("result") == "FAIL":
            name = item.get("name")
            if isinstance(name, str) and name.strip():
                failed_checks.append(name.strip())

    if failed_checks:
        lines.append("Failed checks:")
        lines.extend(f"- {name}" for name in failed_checks[:5])

    bugs = []
    for item in report.get("bugs", []):
        if isinstance(item, dict):
            bug_id = item.get("bug_id")
            title = item.get("title") or item.get("summary") or item.get("name")
            bug_label = None
            if isinstance(bug_id, str) and bug_id.strip() and isinstance(title, str) and title.strip():
                bug_label = f"{bug_id.strip()}: {title.strip()}"
            elif isinstance(bug_id, str) and bug_id.strip():
                bug_label = bug_id.strip()
            elif isinstance(title, str) and title.strip():
                bug_label = title.strip()

            if bug_label is not None:
                bugs.append(bug_label)

    if bugs:
        lines.append("Bugs:")
        lines.extend(f"- {bug}" for bug in bugs[:5])

    next_actions = []
    for item in report.get("next_actions", []):
        if isinstance(item, str) and item.strip():
            next_actions.append(item.strip())

    if next_actions:
        lines.append("Next actions:")
        lines.extend(f"- {action}" for action in next_actions[:5])

    return "\n".join(lines)


def _build_plan_prompt(description: str) -> str:
    return f"""
This is an automated harness invocation.
You are the Planner sub-agent.
Read AGENTS.md and use the planner skill.
Work non-interactively in a single run.
Do not ask follow-up questions.
Treat the request below as complete and final.
Actually write specs/spec.json before finishing.
Do not reply with a request for more input or a plan-only note.
Create or overwrite specs/spec.json for this request:

{description}

Requirements:
- expand a short request into a detailed browser-demoable product specification
- produce a browser-demoable product plan
- make acceptance criteria concrete
- save to specs/spec.json
- do not implement application code
- focus on what to build, not low-level implementation details
- if any detail is missing, make reasonable assumptions and record them in the spec
- include a clear feature list, top-level acceptance criteria, and a multi-sprint roadmap
""".strip()


def _build_generate_prompt(sprint: int, failure_feedback: Optional[dict[str, Any]] = None) -> str:
    feedback_section = ""
    if failure_feedback is not None:
        feedback_json = json.dumps(failure_feedback, indent=2, ensure_ascii=False)
        feedback_summary = _summarize_failure_feedback(failure_feedback)
        summary_section = ""
        if feedback_summary:
            summary_section = f"""

Failure highlights:
{feedback_summary}
""".rstrip()
        feedback_section = f"""

Use the latest evaluation report below as the authoritative failure feedback.
Do not change specs/spec.json.
Fix build/ only.
{summary_section}

Latest evaluation report:
```json
{feedback_json}
```
""".rstrip()

    return f"""
This is an automated harness invocation.
You are the Generator sub-agent.
Read AGENTS.md and use the generator skill.
Read specs/spec.json before making changes.
Work non-interactively in a single run.
Do not ask follow-up questions.
Do not ask for the sprint number again.
Actually modify files in build/ and write sprints/sprint_{sprint}_eval.json before finishing.
Do not stop at analysis, a plan, or a readiness note.
Implement sprint {sprint} in this repository.{feedback_section}

Requirements:
- implement one sprint at a time from the current spec
- treat specs/spec.json as a read-only input for this run
- update code in build/
- write build/ and sprints/sprint_{sprint}_eval.json only
- preserve existing working behavior unless the spec requires changes
- update build/README.md if setup or run steps changed
- write sprints/sprint_{sprint}_eval.json with an honest self-evaluation for the sprint you implemented
- if the latest evaluator feedback contains bug_id values, copy that exact set into source_bug_ids and classify every source bug id exactly once in addressed_bug_ids or unresolved_bug_ids
- run the smallest relevant validation before finishing
- write sprints/sprint_{sprint}_eval.json as valid JSON with this minimum shape:
  {{
    "sprint": {sprint},
    "implemented": ["..."],
    "known_issues": ["..."],
    "source_bug_ids": [],
    "addressed_bug_ids": [],
    "unresolved_bug_ids": [],
    "run_instructions": {{
      "install": "npm install",
      "dev": "npm run dev"
    }},
    "validation": [
      {{
        "command": "npm run typecheck",
        "result": "passed"
      }}
    ]
  }}
""".strip()


def _build_evaluate_prompt(sprint: int, url: str) -> str:
    return f"""
This is an automated harness invocation.
You are the Evaluator sub-agent.
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
- treat any unmet acceptance criterion as a FAIL for the sprint
- treat build/ as read-only during evaluation
- if evaluations/sprint_{sprint}_report.json already exists, preserve bug_id values for any bug that still reproduces when you can match it confidently
- write evaluations/sprint_{sprint}_report.json only
- write evaluations/sprint_{sprint}_report.json
- cover every acceptance criterion from the sprint spec exactly once in acceptance_criteria_results
- list concrete passes, failures, and next actions
- write evaluations/sprint_{sprint}_report.json as valid JSON with this minimum shape:
  {{
    "sprint": {sprint},
    "target_url": "{url}",
    "checked_at": "YYYY-MM-DD",
    "status": "PASS",
    "validation_method": {{
      "playwright_mcp_available": false,
      "agent_browser_available": false,
      "fallback_used": ["..."],
      "notes": "..."
    }},
    "checks": [
      {{
        "name": "...",
        "result": "PASS",
        "evidence": "..."
      }}
    ],
    "acceptance_criteria_results": [
      {{
        "criterion": "...",
        "status": "PASS",
        "evidence": "..."
      }}
    ],
    "bugs": [
      {{
        "bug_id": "B1",
        "title": "...",
        "severity": "P1",
        "evidence": "...",
        "repro": "..."
      }}
    ],
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

    path = spec_path()
    _require_non_empty_string(data.get("product_name"), field_name="product_name", path=path)
    _require_non_empty_string(data.get("summary"), field_name="summary", path=path)
    _require_non_empty_list(data.get("target_users"), field_name="target_users", path=path)
    _require_non_empty_list(data.get("assumptions"), field_name="assumptions", path=path)
    _require_non_empty_list(data.get("out_of_scope"), field_name="out_of_scope", path=path)
    _require_non_empty_list(data.get("acceptance_criteria"), field_name="acceptance_criteria", path=path)

    design_direction = _require_object(data.get("design_direction"), field_name="design_direction", path=path)
    _require_non_empty_list(design_direction.get("tone"), field_name="design_direction.tone", path=path)
    _require_non_empty_list(
        design_direction.get("layout_principles"),
        field_name="design_direction.layout_principles",
        path=path,
    )
    _require_non_empty_list(design_direction.get("motion"), field_name="design_direction.motion", path=path)

    features = _require_non_empty_list(data.get("features"), field_name="features", path=path)
    feature_ids: list[str] = []
    for index, item in enumerate(features):
        item_path = f"features[{index}]"
        item_obj = _require_object(item, field_name=item_path, path=path)
        feature_id = _require_non_empty_string(item_obj.get("id"), field_name=f"{item_path}.id", path=path)
        _require_non_empty_string(item_obj.get("name"), field_name=f"{item_path}.name", path=path)
        _require_non_empty_string(item_obj.get("description"), field_name=f"{item_path}.description", path=path)
        _require_non_empty_list(item_obj.get("must_have"), field_name=f"{item_path}.must_have", path=path)
        feature_ids.append(feature_id)

    if len(set(feature_ids)) != len(feature_ids):
        raise HarnessError(f"{path} must define unique feature ids.")

    sprints = _require_non_empty_list(data.get("sprints"), field_name="sprints", path=path)
    sprint_numbers: list[int] = []
    for index, item in enumerate(sprints):
        item_path = f"sprints[{index}]"
        item_obj = _require_object(item, field_name=item_path, path=path)
        sprint_number = item_obj.get("sprint")
        if not isinstance(sprint_number, int):
            raise HarnessError(f"{path} must define {item_path}.sprint as an integer.")
        _require_non_empty_string(item_obj.get("name"), field_name=f"{item_path}.name", path=path)
        _require_non_empty_string(item_obj.get("goal"), field_name=f"{item_path}.goal", path=path)
        _require_non_empty_list(item_obj.get("scope"), field_name=f"{item_path}.scope", path=path)
        _require_non_empty_list(
            item_obj.get("acceptance_criteria"),
            field_name=f"{item_path}.acceptance_criteria",
            path=path,
        )
        sprint_numbers.append(sprint_number)

    if len(set(sprint_numbers)) != len(sprint_numbers):
        raise HarnessError(f"{path} must define unique sprint numbers.")

    return data


def _find_sprint_spec(sprint: int) -> Optional[dict[str, Any]]:
    spec = validate_spec_file()
    sprints = spec.get("sprints")
    if not isinstance(sprints, list):
        return None

    for item in sprints:
        if isinstance(item, dict) and item.get("sprint") == sprint:
            return item

    return None


def _require_string_list(value: Any, *, field_name: str, path: Path) -> list[str]:
    if not isinstance(value, list) or any(not isinstance(item, str) for item in value):
        raise HarnessError(f"{path} must define {field_name} as an array of strings.")
    return value


def _require_list(value: Any, *, field_name: str, path: Path) -> list[Any]:
    if not isinstance(value, list):
        raise HarnessError(f"{path} must define {field_name} as an array.")
    return value


def _require_non_empty_list(value: Any, *, field_name: str, path: Path) -> list[Any]:
    items = _require_list(value, field_name=field_name, path=path)
    if not items:
        raise HarnessError(f"{path} must define {field_name} as a non-empty array.")
    return items


def _require_non_empty_string(value: Any, *, field_name: str, path: Path) -> str:
    if not isinstance(value, str) or not value.strip():
        raise HarnessError(f"{path} must define {field_name} as a non-empty string.")
    return value


def _require_bool(value: Any, *, field_name: str, path: Path) -> bool:
    if not isinstance(value, bool):
        raise HarnessError(f"{path} must define {field_name} as a boolean.")
    return value


def _require_object(value: Any, *, field_name: str, path: Path) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise HarnessError(f"{path} must define {field_name} as a JSON object.")
    return value


def _require_bug_list(value: Any, *, field_name: str, path: Path) -> list[dict[str, Any]]:
    bugs = _require_list(value, field_name=field_name, path=path)
    bug_ids: list[str] = []

    for index, item in enumerate(bugs):
        item_path = f"{field_name}[{index}]"
        item_obj = _require_object(item, field_name=item_path, path=path)
        bug_id = _require_non_empty_string(item_obj.get("bug_id"), field_name=f"{item_path}.bug_id", path=path)
        _require_non_empty_string(item_obj.get("title"), field_name=f"{item_path}.title", path=path)
        _require_non_empty_string(item_obj.get("severity"), field_name=f"{item_path}.severity", path=path)
        _require_non_empty_string(item_obj.get("evidence"), field_name=f"{item_path}.evidence", path=path)
        _require_non_empty_string(item_obj.get("repro"), field_name=f"{item_path}.repro", path=path)
        bug_ids.append(bug_id)

    if len(set(bug_ids)) != len(bug_ids):
        raise HarnessError(f"{path} must define unique bug_id values in {field_name}.")

    return bugs


def _extract_bug_ids(bugs: Any) -> list[str]:
    if not isinstance(bugs, list):
        return []

    bug_ids: list[str] = []
    for item in bugs:
        if not isinstance(item, dict):
            continue
        bug_id = item.get("bug_id")
        if isinstance(bug_id, str) and bug_id.strip():
            bug_ids.append(bug_id.strip())
    return bug_ids


def _normalize_bug_id_list(value: list[str]) -> list[str]:
    return [item.strip() for item in value if item.strip()]


def validate_sprint_eval(sprint: int) -> dict[str, Any]:
    path = sprint_eval_path(sprint)
    data = load_json_file(path)
    if not isinstance(data, dict):
        raise HarnessError(f"Sprint self-evaluation must be a JSON object: {path}")

    if data.get("sprint") != sprint:
        raise HarnessError(f"{path} must define sprint={sprint}.")

    if _find_sprint_spec(sprint) is None:
        raise HarnessError(f"{path} references sprint {sprint}, but that sprint is not defined in specs/spec.json.")

    implemented = _require_string_list(data.get("implemented"), field_name="implemented", path=path)
    if not implemented:
        raise HarnessError(f"{path} must define implemented as a non-empty array of strings.")
    if len(set(implemented)) != len(implemented):
        raise HarnessError(f"{path} must not repeat implemented items.")
    _require_string_list(data.get("known_issues"), field_name="known_issues", path=path)
    source_bug_ids = _normalize_bug_id_list(
        _require_string_list(data.get("source_bug_ids"), field_name="source_bug_ids", path=path)
    )
    addressed_bug_ids = _normalize_bug_id_list(
        _require_string_list(data.get("addressed_bug_ids"), field_name="addressed_bug_ids", path=path)
    )
    unresolved_bug_ids = _normalize_bug_id_list(
        _require_string_list(
        data.get("unresolved_bug_ids"),
        field_name="unresolved_bug_ids",
        path=path,
        )
    )
    if len(set(source_bug_ids)) != len(source_bug_ids):
        raise HarnessError(f"{path} must not repeat source_bug_ids.")
    if len(set(addressed_bug_ids)) != len(addressed_bug_ids):
        raise HarnessError(f"{path} must not repeat addressed_bug_ids.")
    if len(set(unresolved_bug_ids)) != len(unresolved_bug_ids):
        raise HarnessError(f"{path} must not repeat unresolved_bug_ids.")
    if set(addressed_bug_ids) & set(unresolved_bug_ids):
        raise HarnessError(f"{path} must not repeat the same bug id in addressed_bug_ids and unresolved_bug_ids.")
    classified_bug_ids = set(addressed_bug_ids) | set(unresolved_bug_ids)
    expected_bug_ids = set(source_bug_ids)
    if classified_bug_ids != expected_bug_ids:
        missing_bug_ids = sorted(expected_bug_ids - classified_bug_ids)
        unexpected_bug_ids = sorted(classified_bug_ids - expected_bug_ids)
        details: list[str] = []
        if missing_bug_ids:
            details.append(f"missing: {', '.join(missing_bug_ids)}")
        if unexpected_bug_ids:
            details.append(f"unexpected: {', '.join(unexpected_bug_ids)}")
        detail_suffix = f" ({'; '.join(details)})" if details else ""
        raise HarnessError(f"{path} must classify every source bug id exactly once{detail_suffix}.")

    run_instructions = data.get("run_instructions")
    if not isinstance(run_instructions, dict):
        raise HarnessError(f"{path} must define run_instructions as a JSON object.")

    _require_non_empty_string(run_instructions.get("install"), field_name="run_instructions.install", path=path)
    _require_non_empty_string(run_instructions.get("dev"), field_name="run_instructions.dev", path=path)

    validation = _require_non_empty_list(data.get("validation"), field_name="validation", path=path)
    for index, item in enumerate(validation):
        item_path = f"validation[{index}]"
        item_obj = _require_object(item, field_name=item_path, path=path)
        _require_non_empty_string(item_obj.get("command"), field_name=f"{item_path}.command", path=path)
        _require_non_empty_string(item_obj.get("result"), field_name=f"{item_path}.result", path=path)
    return data


def validate_retry_bug_linkage(sprint_eval: dict[str, Any], failure_feedback: Optional[dict[str, Any]], *, path: Path) -> None:
    source_bug_ids = sprint_eval.get("source_bug_ids")
    if not isinstance(source_bug_ids, list):
        raise HarnessError(f"{path} must define source_bug_ids as an array of strings.")

    normalized_source_bug_ids = _normalize_bug_id_list([item for item in source_bug_ids if isinstance(item, str)])
    if failure_feedback is None:
        if normalized_source_bug_ids:
            raise HarnessError(f"{path} must leave source_bug_ids empty when there is no prior evaluator failure feedback.")
        return

    feedback_bug_ids = sorted(set(_extract_bug_ids(failure_feedback.get("bugs"))))
    if sorted(set(normalized_source_bug_ids)) != feedback_bug_ids:
        raise HarnessError(
            f"{path} must copy the latest evaluator bug ids into source_bug_ids exactly: expected {feedback_bug_ids}, got {sorted(set(normalized_source_bug_ids))}."
        )


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

    _require_non_empty_string(data.get("checked_at"), field_name="checked_at", path=path)

    validation_method = _require_object(data.get("validation_method"), field_name="validation_method", path=path)
    _require_bool(
        validation_method.get("playwright_mcp_available"),
        field_name="validation_method.playwright_mcp_available",
        path=path,
    )
    _require_bool(
        validation_method.get("agent_browser_available"),
        field_name="validation_method.agent_browser_available",
        path=path,
    )
    _require_string_list(validation_method.get("fallback_used"), field_name="validation_method.fallback_used", path=path)
    _require_non_empty_string(validation_method.get("notes"), field_name="validation_method.notes", path=path)

    checks = _require_non_empty_list(data.get("checks"), field_name="checks", path=path)
    for index, item in enumerate(checks):
        item_path = f"checks[{index}]"
        item_obj = _require_object(item, field_name=item_path, path=path)
        _require_non_empty_string(item_obj.get("name"), field_name=f"{item_path}.name", path=path)
        result = _require_non_empty_string(item_obj.get("result"), field_name=f"{item_path}.result", path=path)
        if result not in {"PASS", "FAIL"}:
            raise HarnessError(f"{path} must define {item_path}.result as PASS or FAIL.")
        _require_non_empty_string(item_obj.get("evidence"), field_name=f"{item_path}.evidence", path=path)

    bugs = _require_bug_list(data.get("bugs"), field_name="bugs", path=path)
    next_actions = _require_string_list(data.get("next_actions"), field_name="next_actions", path=path)

    acceptance_results = _require_non_empty_list(
        data.get("acceptance_criteria_results"),
        field_name="acceptance_criteria_results",
        path=path,
    )
    sprint_spec = _find_sprint_spec(sprint)
    expected_criteria = []
    if sprint_spec is not None:
        criteria = sprint_spec.get("acceptance_criteria")
        if isinstance(criteria, list):
            expected_criteria = [item for item in criteria if isinstance(item, str)]

    seen_criteria: list[str] = []
    failed_criteria = 0
    for index, item in enumerate(acceptance_results):
        item_path = f"acceptance_criteria_results[{index}]"
        item_obj = _require_object(item, field_name=item_path, path=path)
        criterion = _require_non_empty_string(item_obj.get("criterion"), field_name=f"{item_path}.criterion", path=path)
        result = _require_non_empty_string(item_obj.get("status"), field_name=f"{item_path}.status", path=path)
        if result not in {"PASS", "FAIL"}:
            raise HarnessError(f"{path} must define {item_path}.status as PASS or FAIL.")
        if result == "FAIL":
            failed_criteria += 1
        _require_non_empty_string(item_obj.get("evidence"), field_name=f"{item_path}.evidence", path=path)
        seen_criteria.append(criterion)

    if len(set(seen_criteria)) != len(seen_criteria):
        raise HarnessError(f"{path} must not repeat acceptance criteria results.")

    if expected_criteria:
        if len(acceptance_results) != len(expected_criteria):
            raise HarnessError(
                f"{path} must report exactly {len(expected_criteria)} acceptance criteria results for sprint {sprint}."
            )
        if set(seen_criteria) != set(expected_criteria):
            raise HarnessError(
                f"{path} must cover every acceptance criterion defined for sprint {sprint} in specs/spec.json."
            )

    if status == "FAIL":
        if not bugs:
            raise HarnessError(f"{path} must define at least one bug when status is FAIL.")
        if not next_actions:
            raise HarnessError(f"{path} must define at least one next action when status is FAIL.")
        if failed_criteria == 0:
            raise HarnessError(f"{path} must mark at least one acceptance criterion as FAIL when status is FAIL.")
    elif failed_criteria != 0:
        raise HarnessError(f"{path} cannot contain failed acceptance criteria when status is PASS.")

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
    validate_spec_file()


def cmd_generate(sprint: int) -> None:
    validate_spec_file()
    result = run_generate(sprint)
    print_run_result(result)
    sprint_eval = validate_sprint_eval(sprint)
    validate_retry_bug_linkage(sprint_eval, None, path=sprint_eval_path(sprint))


def cmd_evaluate(sprint: int, url: str) -> None:
    validate_spec_file()
    validate_sprint_eval(sprint)
    result = run_evaluate(sprint, url)
    print_run_result(result)
    report = validate_evaluation_report(sprint, url)
    if report.get("status") == "FAIL":
        raise HarnessError(f"Evaluator reported FAIL for sprint {sprint}.")


def cmd_autodev(
    description: str,
    sprint: int,
    max_iterations: int,
    url: str,
    startup_timeout: int,
    replan: bool,
    auto_sync: bool,
) -> int:
    if max_iterations < 1:
        raise HarnessError("--max-iterations must be at least 1.")

    if startup_timeout < 1:
        raise HarnessError("--startup-timeout must be at least 1.")

    ensure_pipeline_dirs()

    baseline_pending_changes: list[dict[str, str]] = []
    auto_sync_allowed = auto_sync
    if auto_sync:
        baseline_pending_changes, _ = _read_pending_changes()
        if baseline_pending_changes:
            auto_sync_allowed = False
            preview = ", ".join(item["path"] for item in baseline_pending_changes[:5])
            print(
                "[autodev] Auto-sync is disabled for this run because the worktree already had pending changes "
                f"before generation: {preview}",
                file=sys.stderr,
            )

    if replan or not spec_path().exists():
        print(f"[autodev] Planning sprint {sprint}.")
        plan_result = run_plan(description, approval="never", sandbox="workspace-write")
        print_run_result(plan_result)
        validate_spec_file()
    else:
        print(f"[autodev] Reusing existing spec at {spec_path()}.")
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
        sprint_eval = validate_sprint_eval(sprint)
        validate_retry_bug_linkage(sprint_eval, failure_feedback, path=sprint_eval_path(sprint))

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
            if auto_sync:
                if auto_sync_allowed:
                    sync_message = f"autodev: sprint {sprint} attempt {attempt} PASS"
                    sync_result = sync_changes(sync_message, dry_run=False)
                    sync_outcome = sync_result.get("outcome")
                    if sync_outcome == "synced":
                        print(f"[autodev] Auto-sync completed via {sync_result.get('performed_via')}.")
                    elif sync_outcome == "noop":
                        print("[autodev] Auto-sync found no pending changes to publish.")
                    else:
                        blocker = sync_result.get("blocker") or "unknown"
                        if blocker == "local_git_https_credentials_missing" and sync_result.get("commit_created"):
                            head_sha = sync_result.get("head_sha")
                            suffix = f" {head_sha}" if isinstance(head_sha, str) and head_sha.strip() else ""
                            print(
                                f"[autodev] Auto-sync created local commit{suffix} but could not push it from this shell; run git push from a credentialed shell.",
                                file=sys.stderr,
                            )
                        elif blocker == "unpushed_commits_pending":
                            print(
                                "[autodev] Auto-sync detected unpushed commits already on this branch; run git push to publish them.",
                                file=sys.stderr,
                            )
                        else:
                            print(f"[autodev] Auto-sync could not publish this PASS run: {blocker}", file=sys.stderr)
                else:
                    print(
                        "[autodev] PASS was reached, but auto-sync was skipped to avoid committing pre-existing worktree changes.",
                        file=sys.stderr,
                    )
            print(f"[autodev] Sprint {sprint} passed on iteration {attempt}.")
            return 0

        failure_feedback = report
        if attempt < max_iterations:
            print(f"[autodev] Sprint {sprint} failed on iteration {attempt}; retrying with evaluator feedback.")

    print(f"[autodev] Reached the iteration limit ({max_iterations}) without a PASS report.")
    return 1


def _relative_display(path: Path) -> str:
    try:
        return str(path.relative_to(ROOT))
    except ValueError:
        return str(path)


def _artifact_summary(path: Path) -> dict[str, Any]:
    return {
        "path": _relative_display(path),
        "exists": path.exists(),
    }


def _latest_report_status() -> Optional[str]:
    latest_report = latest_json(EVALS_DIR, "sprint_*_report.json") if EVALS_DIR.exists() else None
    if latest_report is None or not latest_report.exists():
        return None

    try:
        report = json.loads(latest_report.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None

    status = report.get("status")
    return status if status in {"PASS", "FAIL"} else None


def _run_git_command(*args: str) -> Optional[subprocess.CompletedProcess[str]]:
    git = shutil.which("git")
    if not git:
        return None

    return subprocess.run(
        [git, *args],
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=False,
    )


def _extract_repo_slug(remote_url: str) -> Optional[str]:
    patterns = [
        r"github\.com[:/](?P<slug>[^/\s]+/[^/\s]+?)(?:\.git)?$",
        r"github\.com/(?P<slug>[^/\s]+/[^/\s]+?)(?:\.git)?$",
    ]
    for pattern in patterns:
        match = re.search(pattern, remote_url)
        if match:
            return match.group("slug")
    return None


def _git_error_text(result: Optional[subprocess.CompletedProcess[str]]) -> str:
    if result is None:
        return ""
    return "\n".join(part.strip() for part in (result.stdout, result.stderr) if part and part.strip())


def _is_index_lock_permission_denied(result: Optional[subprocess.CompletedProcess[str]]) -> bool:
    text = _git_error_text(result)
    return "index.lock" in text and "Permission denied" in text


def _is_git_https_credentials_missing(result: Optional[subprocess.CompletedProcess[str]]) -> bool:
    text = _git_error_text(result)
    return "SEC_E_NO_CREDENTIALS" in text or "AcquireCredentialsHandle failed" in text


def _parse_git_status_lines(output: str) -> list[dict[str, str]]:
    changes: list[dict[str, str]] = []
    for raw_line in output.splitlines():
        line = raw_line.rstrip()
        if not line:
            continue
        if line.startswith("?? "):
            path_text = line[3:].strip()
            if path_text:
                changes.append({"path": path_text, "change": "add"})
            continue

        if len(line) < 4:
            continue

        staged_marker = line[0]
        unstaged_marker = line[1]
        path_text = line[3:].strip()
        if " -> " in path_text and (staged_marker == "R" or unstaged_marker == "R"):
            old_path, new_path = [item.strip() for item in path_text.split(" -> ", 1)]
            if old_path:
                changes.append({"path": old_path, "change": "delete"})
            if new_path:
                changes.append({"path": new_path, "change": "add"})
            continue

        if not path_text:
            continue

        if staged_marker == "D" or unstaged_marker == "D":
            changes.append({"path": path_text, "change": "delete"})
        else:
            changes.append({"path": path_text, "change": "update"})

    return changes


def _read_pending_changes() -> tuple[list[dict[str, str]], list[str]]:
    result = _run_git_command("status", "--porcelain", "--untracked-files=normal")
    if result is None:
        return [], []

    warnings: list[str] = []
    if result.stderr.strip():
        warnings.append(result.stderr.strip())
    if result.returncode != 0:
        return [], warnings

    return _parse_git_status_lines(result.stdout), warnings


def _resolve_github_sync_context(branch: Optional[str], origin: dict[str, Any]) -> dict[str, Any]:
    token_env_name = next(
        (name for name in GITHUB_TOKEN_ENV_CANDIDATES if os.environ.get(name, "").strip()),
        None,
    )
    token = os.environ.get(token_env_name, "").strip() if token_env_name else ""
    repo_slug = origin.get("repo_slug") if isinstance(origin, dict) else None
    owner = os.environ.get(GITHUB_OWNER_ENV, "").strip()
    repo = os.environ.get(GITHUB_REPO_ENV, "").strip()
    if not owner and isinstance(repo_slug, str) and "/" in repo_slug:
        owner = repo_slug.split("/", 1)[0]
    if not repo and isinstance(repo_slug, str) and "/" in repo_slug:
        repo = repo_slug.split("/", 1)[1]
    sync_branch = os.environ.get(GITHUB_BRANCH_ENV, "").strip() or (branch or "")
    base_branch = os.environ.get(GITHUB_BASE_BRANCH_ENV, "").strip()

    missing_env_names: list[str] = []
    if not token:
        missing_env_names.extend(list(GITHUB_TOKEN_ENV_CANDIDATES))
    if not owner:
        missing_env_names.append(GITHUB_OWNER_ENV)
    if not repo:
        missing_env_names.append(GITHUB_REPO_ENV)
    if not sync_branch:
        missing_env_names.append(GITHUB_BRANCH_ENV)

    return {
        "token_env_name": token_env_name,
        "token": token,
        "owner": owner or None,
        "repo": repo or None,
        "branch": sync_branch or None,
        "base_branch": base_branch or None,
        "can_sync_without_git_index": bool(token and owner and repo and sync_branch),
        "missing_env_names": missing_env_names,
    }


def _git_sync_status() -> dict[str, Any]:
    status: dict[str, Any] = {
        "git_repo": False,
        "branch": None,
        "upstream": None,
        "head_sha": None,
        "mode": "local_git",
        "local_git_writable": None,
        "local_git_pushable": None,
        "blocker": None,
        "pending_changes_count": 0,
        "pending_changes_preview": [],
        "unpushed_commits_count": 0,
        "can_sync_without_git_index": False,
        "origin": {
            "present": False,
            "url": None,
            "github_like": False,
            "repo_slug": None,
        },
        "required_env_names": [],
        "manual_instructions": [],
        "upstream_detail": {
            "configured": False,
            "ahead": None,
            "behind": None,
        },
        "diagnostics": {
            "warnings": [],
            "network_used": False,
            "git_fetch_used": False,
            "github_api_used": False,
        },
    }

    inside_worktree = _run_git_command("rev-parse", "--is-inside-work-tree")
    if inside_worktree is None:
        status["blocker"] = "git_not_available"
        status["manual_instructions"] = [
            "Install git in PATH or run the sync step from a git-enabled shell.",
        ]
        return status

    if inside_worktree.returncode != 0 or inside_worktree.stdout.strip() != "true":
        status["blocker"] = "not_a_git_worktree"
        if inside_worktree.stderr.strip():
            status["diagnostics"]["warnings"].append(inside_worktree.stderr.strip())
        status["manual_instructions"] = [
            "Run the harness inside a cloned git repository before attempting sync.",
        ]
        return status

    status["git_repo"] = True

    branch = _run_git_command("branch", "--show-current")
    if branch and branch.returncode == 0:
        status["branch"] = branch.stdout.strip() or None
        if branch.stderr.strip():
            status["diagnostics"]["warnings"].append(branch.stderr.strip())

    head_sha = _run_git_command("rev-parse", "--short", "HEAD")
    if head_sha and head_sha.returncode == 0:
        status["head_sha"] = head_sha.stdout.strip() or None
        if head_sha.stderr.strip():
            status["diagnostics"]["warnings"].append(head_sha.stderr.strip())

    pending_changes, pending_warnings = _read_pending_changes()
    status["diagnostics"]["warnings"].extend(pending_warnings)
    status["pending_changes_count"] = len(pending_changes)
    status["pending_changes_preview"] = [item["path"] for item in pending_changes[:10]]

    upstream = _run_git_command("rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}")
    if upstream and upstream.returncode == 0:
        upstream_ref = upstream.stdout.strip() or None
        status["upstream"] = upstream_ref
        status["upstream_detail"]["configured"] = upstream_ref is not None
        if upstream.stderr.strip():
            status["diagnostics"]["warnings"].append(upstream.stderr.strip())

        ahead_behind = _run_git_command("rev-list", "--left-right", "--count", "HEAD...@{u}")
        if ahead_behind and ahead_behind.returncode == 0:
            counts = ahead_behind.stdout.strip().split()
            if len(counts) == 2:
                try:
                    status["upstream_detail"]["ahead"] = int(counts[0])
                    status["upstream_detail"]["behind"] = int(counts[1])
                    status["unpushed_commits_count"] = status["upstream_detail"]["ahead"] or 0
                except ValueError:
                    pass
            if ahead_behind.stderr.strip():
                status["diagnostics"]["warnings"].append(ahead_behind.stderr.strip())
        elif ahead_behind and ahead_behind.stderr.strip():
            status["diagnostics"]["warnings"].append(ahead_behind.stderr.strip())
    elif upstream and upstream.stderr.strip():
        status["diagnostics"]["warnings"].append(upstream.stderr.strip())

    origin = _run_git_command("remote", "get-url", "origin")
    if origin and origin.returncode == 0:
        remote_url = origin.stdout.strip() or None
        repo_slug = _extract_repo_slug(remote_url) if remote_url else None
        status["origin"] = {
            "present": remote_url is not None,
            "url": remote_url,
            "github_like": repo_slug is not None,
            "repo_slug": repo_slug,
        }
        if origin.stderr.strip():
            status["diagnostics"]["warnings"].append(origin.stderr.strip())
    elif origin and origin.stderr.strip():
        status["diagnostics"]["warnings"].append(origin.stderr.strip())

    add_probe = _run_git_command("add", "-A", "--dry-run")
    if add_probe is not None:
        if add_probe.returncode == 0:
            status["local_git_writable"] = True
        elif _is_index_lock_permission_denied(add_probe):
            status["local_git_writable"] = False
            status["mode"] = "github_api_required"
            status["blocker"] = "local_git_index_lock_permission_denied"
        else:
            status["local_git_writable"] = False
            status["blocker"] = "local_git_probe_failed"
            error_text = _git_error_text(add_probe)
            if error_text:
                status["diagnostics"]["warnings"].append(error_text)

    if (
        (status["pending_changes_count"] > 0 or status["unpushed_commits_count"] > 0)
        and status["local_git_writable"] is True
        and isinstance(status["branch"], str)
        and status["branch"].strip()
        and status["origin"]["present"]
    ):
        push_probe = _run_git_command(
            "push",
            "--dry-run",
            "origin",
            f"HEAD:refs/heads/{status['branch']}",
        )
        status["diagnostics"]["network_used"] = True
        if push_probe is not None:
            if push_probe.returncode == 0:
                status["local_git_pushable"] = True
            elif _is_git_https_credentials_missing(push_probe):
                status["local_git_pushable"] = False
                status["blocker"] = "local_git_https_credentials_missing"
            else:
                status["local_git_pushable"] = False
                error_text = _git_error_text(push_probe)
                if error_text:
                    status["diagnostics"]["warnings"].append(error_text)

    github_context = _resolve_github_sync_context(status["branch"], status["origin"])
    status["can_sync_without_git_index"] = github_context["can_sync_without_git_index"]
    status["required_env_names"] = github_context["missing_env_names"]

    if status["mode"] != "github_api_required":
        if status["local_git_writable"] is True and status["local_git_pushable"] is not False:
            status["mode"] = "local_git"
        elif status["can_sync_without_git_index"]:
            status["mode"] = "github_api"
        else:
            if status["local_git_writable"] is False or status["local_git_pushable"] is False:
                status["mode"] = "github_api_required"
            else:
                status["mode"] = "local_git"

    if status["pending_changes_count"] == 0 and status["unpushed_commits_count"] > 0:
        if status["blocker"] is None:
            status["blocker"] = "unpushed_commits_pending"
    elif status["pending_changes_count"] == 0:
        status["blocker"] = "no_pending_changes"
    elif (
        status["blocker"] != "local_git_https_credentials_missing"
        and status["mode"] in {"github_api", "github_api_required"}
        and not status["can_sync_without_git_index"]
    ):
        status["blocker"] = "github_api_credentials_missing"

    if status["blocker"] is None:
        if not status["origin"]["present"]:
            status["blocker"] = "origin_remote_missing"
        elif not status["origin"]["github_like"]:
            status["blocker"] = "origin_not_github"
        elif not status["upstream_detail"]["configured"]:
            status["blocker"] = "upstream_missing"
        elif (
            isinstance(status["upstream_detail"]["behind"], int)
            and status["upstream_detail"]["behind"] > 0
        ):
            status["blocker"] = "branch_behind_upstream"

    status["manual_instructions"] = [
        "1. If local git works, run: git add -A && git commit -m \"<message>\" && git push",
        "2. If local git push is blocked by HTTPS credentials, use a shell where git push already works or export the GitHub API env vars and run: python agents/orchestrator_codex.py sync \"<message>\"",
        "3. If API sync still cannot run, create the commit manually from the same branch and push it.",
    ]
    return status


def _github_api_request(method: str, path: str, token: str, payload: Optional[dict[str, Any]] = None) -> Any:
    url = f"https://api.github.com{path}"
    headers = {
        "Accept": "application/vnd.github+json",
        "Authorization": f"Bearer {token}",
        "User-Agent": "codex-autodev-harness",
    }
    body = json.dumps(payload).encode("utf-8") if payload is not None else None
    request = Request(url, data=body, headers=headers, method=method)
    try:
        with urlopen(request, timeout=30) as response:
            raw = response.read()
    except HTTPError as exc:
        error_body = exc.read().decode("utf-8", errors="replace")
        raise HarnessError(f"GitHub API {method} {path} failed: {exc.code} {error_body}") from exc
    except URLError as exc:
        raise HarnessError(f"GitHub API {method} {path} failed: {exc}") from exc

    if not raw:
        return None
    return json.loads(raw.decode("utf-8"))


def _github_branch_ref_path(branch: str) -> str:
    return quote(f"heads/{branch}", safe="")


def _github_get_head_sha(owner: str, repo: str, branch: str, token: str) -> str:
    ref_payload = _github_api_request("GET", f"/repos/{owner}/{repo}/git/ref/{_github_branch_ref_path(branch)}", token)
    sha = ref_payload.get("object", {}).get("sha") if isinstance(ref_payload, dict) else None
    if not isinstance(sha, str) or not sha.strip():
        raise HarnessError(f"Could not resolve head sha for {owner}/{repo}:{branch}.")
    return sha


def _github_get_tree_sha(owner: str, repo: str, commit_sha: str, token: str) -> str:
    commit_payload = _github_api_request("GET", f"/repos/{owner}/{repo}/git/commits/{commit_sha}", token)
    tree_sha = commit_payload.get("tree", {}).get("sha") if isinstance(commit_payload, dict) else None
    if not isinstance(tree_sha, str) or not tree_sha.strip():
        raise HarnessError(f"Could not resolve tree sha for commit {commit_sha}.")
    return tree_sha


def _github_create_blob(owner: str, repo: str, path: str, token: str) -> str:
    file_path = ROOT / path
    content = file_path.read_bytes()
    payload = {
        "content": base64.b64encode(content).decode("ascii"),
        "encoding": "base64",
    }
    blob_payload = _github_api_request("POST", f"/repos/{owner}/{repo}/git/blobs", token, payload)
    blob_sha = blob_payload.get("sha") if isinstance(blob_payload, dict) else None
    if not isinstance(blob_sha, str) or not blob_sha.strip():
        raise HarnessError(f"Could not create blob for {path}.")
    return blob_sha


def _github_create_tree(
    owner: str,
    repo: str,
    base_tree_sha: str,
    entries: list[dict[str, Any]],
    token: str,
) -> str:
    tree_payload = _github_api_request(
        "POST",
        f"/repos/{owner}/{repo}/git/trees",
        token,
        {"base_tree": base_tree_sha, "tree": entries},
    )
    tree_sha = tree_payload.get("sha") if isinstance(tree_payload, dict) else None
    if not isinstance(tree_sha, str) or not tree_sha.strip():
        raise HarnessError("Could not create git tree through the GitHub API.")
    return tree_sha


def _github_create_commit(owner: str, repo: str, message: str, tree_sha: str, parent_sha: str, token: str) -> str:
    commit_payload = _github_api_request(
        "POST",
        f"/repos/{owner}/{repo}/git/commits",
        token,
        {"message": message, "tree": tree_sha, "parents": [parent_sha]},
    )
    commit_sha = commit_payload.get("sha") if isinstance(commit_payload, dict) else None
    if not isinstance(commit_sha, str) or not commit_sha.strip():
        raise HarnessError("Could not create commit through the GitHub API.")
    return commit_sha


def _github_update_ref(owner: str, repo: str, branch: str, commit_sha: str, token: str) -> None:
    _github_api_request(
        "PATCH",
        f"/repos/{owner}/{repo}/git/refs/{_github_branch_ref_path(branch)}",
        token,
        {"sha": commit_sha, "force": False},
    )


def _github_create_ref(owner: str, repo: str, branch: str, commit_sha: str, token: str) -> None:
    _github_api_request(
        "POST",
        f"/repos/{owner}/{repo}/git/refs",
        token,
        {"ref": f"refs/heads/{branch}", "sha": commit_sha},
    )


def _github_get_repo_metadata(owner: str, repo: str, token: str) -> dict[str, Any]:
    payload = _github_api_request("GET", f"/repos/{owner}/{repo}", token)
    if not isinstance(payload, dict):
        raise HarnessError(f"Could not read repository metadata for {owner}/{repo}.")
    return payload


def _github_create_pull_request(
    owner: str,
    repo: str,
    *,
    title: str,
    body: str,
    head: str,
    base: str,
    token: str,
) -> str:
    payload = _github_api_request(
        "POST",
        f"/repos/{owner}/{repo}/pulls",
        token,
        {"title": title, "body": body, "head": head, "base": base, "draft": True},
    )
    html_url = payload.get("html_url") if isinstance(payload, dict) else None
    if not isinstance(html_url, str) or not html_url.strip():
        raise HarnessError("Could not create pull request through the GitHub API.")
    return html_url


def _build_github_tree_entries(owner: str, repo: str, changes: list[dict[str, str]], token: str) -> list[dict[str, Any]]:
    entries: list[dict[str, Any]] = []
    for item in changes:
        path = item["path"].replace("\\", "/")
        change_type = item["change"]
        if change_type == "delete":
            entries.append({"path": path, "mode": "100644", "type": "blob", "sha": None})
            continue

        blob_sha = _github_create_blob(owner, repo, path, token)
        entries.append({"path": path, "mode": "100644", "type": "blob", "sha": blob_sha})
    return entries


def _sync_with_github_direct_commit(sync_status: dict[str, Any], *, message: str, dry_run: bool) -> dict[str, Any]:
    github_context = _resolve_github_sync_context(sync_status.get("branch"), sync_status.get("origin", {}))
    result = {
        "mode": "github_api",
        "blocker": None,
        "dry_run": dry_run,
        "performed_via": "github_api_direct_commit",
        "actions": ["github_api_direct_commit"],
        "commit_sha": None,
        "pr_url": None,
        "manual_instructions": sync_status.get("manual_instructions", []),
    }
    if not github_context["can_sync_without_git_index"]:
        result["blocker"] = "github_api_credentials_missing"
        result["required_env_names"] = github_context["missing_env_names"]
        return result

    owner = github_context["owner"]
    repo = github_context["repo"]
    branch = github_context["branch"]
    token = github_context["token"]
    pending_changes, _ = _read_pending_changes()
    if dry_run:
        result["planned_change_count"] = len(pending_changes)
        result["planned_paths"] = [item["path"] for item in pending_changes[:10]]
        return result

    parent_sha = _github_get_head_sha(owner, repo, branch, token)
    base_tree_sha = _github_get_tree_sha(owner, repo, parent_sha, token)
    tree_entries = _build_github_tree_entries(owner, repo, pending_changes, token)
    new_tree_sha = _github_create_tree(owner, repo, base_tree_sha, tree_entries, token)
    new_commit_sha = _github_create_commit(owner, repo, message, new_tree_sha, parent_sha, token)
    _github_update_ref(owner, repo, branch, new_commit_sha, token)
    result["commit_sha"] = new_commit_sha
    return result


def _sync_with_github_pr(sync_status: dict[str, Any], *, message: str, dry_run: bool) -> dict[str, Any]:
    github_context = _resolve_github_sync_context(sync_status.get("branch"), sync_status.get("origin", {}))
    result = {
        "mode": "github_api",
        "blocker": None,
        "dry_run": dry_run,
        "performed_via": "github_api_pr",
        "actions": ["github_api_pr"],
        "commit_sha": None,
        "pr_url": None,
        "manual_instructions": sync_status.get("manual_instructions", []),
    }
    if not github_context["can_sync_without_git_index"]:
        result["blocker"] = "github_api_credentials_missing"
        result["required_env_names"] = github_context["missing_env_names"]
        return result

    owner = github_context["owner"]
    repo = github_context["repo"]
    base_branch = github_context["base_branch"]
    current_branch = github_context["branch"]
    token = github_context["token"]
    pending_changes, _ = _read_pending_changes()
    pr_branch = f"{current_branch}-codex-sync-{int(time.time())}"
    if dry_run:
        result["planned_change_count"] = len(pending_changes)
        result["planned_paths"] = [item["path"] for item in pending_changes[:10]]
        result["planned_pr_branch"] = pr_branch
        return result

    if not base_branch:
        repo_metadata = _github_get_repo_metadata(owner, repo, token)
        base_branch = repo_metadata.get("default_branch") if isinstance(repo_metadata.get("default_branch"), str) else current_branch

    base_sha = _github_get_head_sha(owner, repo, current_branch, token)
    _github_create_ref(owner, repo, pr_branch, base_sha, token)
    base_tree_sha = _github_get_tree_sha(owner, repo, base_sha, token)
    tree_entries = _build_github_tree_entries(owner, repo, pending_changes, token)
    new_tree_sha = _github_create_tree(owner, repo, base_tree_sha, tree_entries, token)
    new_commit_sha = _github_create_commit(owner, repo, message, new_tree_sha, base_sha, token)
    _github_update_ref(owner, repo, pr_branch, new_commit_sha, token)
    pr_url = _github_create_pull_request(
        owner,
        repo,
        title=message,
        body="Automated fallback PR created by the Codex harness because direct local git sync was unavailable.",
        head=pr_branch,
        base=base_branch,
        token=token,
    )
    result["commit_sha"] = new_commit_sha
    result["pr_url"] = pr_url
    return result


def sync_changes(message: str, *, dry_run: bool = False) -> dict[str, Any]:
    sync_status = _git_sync_status()
    result: dict[str, Any] = {
        "branch": sync_status.get("branch"),
        "upstream": sync_status.get("upstream"),
        "head_sha": sync_status.get("head_sha"),
        "mode": sync_status.get("mode"),
        "local_git_writable": sync_status.get("local_git_writable"),
        "blocker": sync_status.get("blocker"),
        "pending_changes_count": sync_status.get("pending_changes_count"),
        "pending_changes_preview": sync_status.get("pending_changes_preview"),
        "unpushed_commits_count": sync_status.get("unpushed_commits_count"),
        "can_sync_without_git_index": sync_status.get("can_sync_without_git_index"),
        "dry_run": dry_run,
        "performed_via": None,
        "commit_created": False,
        "manual_instructions": sync_status.get("manual_instructions", []),
    }

    has_unpushed_commits = isinstance(result["unpushed_commits_count"], int) and result["unpushed_commits_count"] > 0

    if result["pending_changes_count"] == 0 and not has_unpushed_commits:
        result["outcome"] = "noop"
        return result

    if sync_status.get("mode") == "local_git":
        if result["pending_changes_count"] == 0 and has_unpushed_commits:
            if dry_run:
                result["outcome"] = "dry_run"
                result["performed_via"] = "local_git"
                result["planned_commands"] = ["git push"]
                return result

            push_result = _run_git_command("push")
            if push_result is None:
                raise HarnessError("git is not available in PATH.")
            if push_result.returncode != 0:
                if _is_git_https_credentials_missing(push_result):
                    result["mode"] = "github_api_required"
                    result["blocker"] = "local_git_https_credentials_missing"
                    result["performed_via"] = "local_git"
                    result["outcome"] = "blocked"
                    return result
                raise HarnessError(_git_error_text(push_result) or "git push failed.")

            result["outcome"] = "synced"
            result["performed_via"] = "local_git"
            result["mode"] = "local_git"
            return result

        if dry_run:
            result["outcome"] = "dry_run"
            result["performed_via"] = "local_git"
            result["planned_commands"] = ["git add -A", f'git commit -m "{message}"', "git push"]
            return result

        add_result = _run_git_command("add", "-A")
        if add_result is None:
            raise HarnessError("git is not available in PATH.")
        if add_result.returncode != 0:
            if _is_index_lock_permission_denied(add_result):
                result["mode"] = "github_api_required"
                result["blocker"] = "local_git_index_lock_permission_denied"
            else:
                raise HarnessError(_git_error_text(add_result) or "git add -A failed.")
        else:
            commit_result = _run_git_command("commit", "-m", message)
            if commit_result is None:
                raise HarnessError("git is not available in PATH.")
            if commit_result.returncode != 0:
                commit_error = _git_error_text(commit_result)
                if "nothing to commit" in commit_error:
                    result["outcome"] = "noop"
                    result["performed_via"] = "local_git"
                    return result
                raise HarnessError(commit_error or "git commit failed.")
            result["commit_created"] = True

            refreshed_head_sha = _run_git_command("rev-parse", "--short", "HEAD")
            if refreshed_head_sha and refreshed_head_sha.returncode == 0:
                result["head_sha"] = refreshed_head_sha.stdout.strip() or result["head_sha"]

            push_result = _run_git_command("push")
            if push_result is None:
                raise HarnessError("git is not available in PATH.")
            if push_result.returncode != 0:
                if _is_git_https_credentials_missing(push_result):
                    result["mode"] = "github_api_required"
                    result["blocker"] = "local_git_https_credentials_missing"
                    result["performed_via"] = "local_git"
                    result["outcome"] = "blocked"
                    return result
                raise HarnessError(_git_error_text(push_result) or "git push failed.")

            result["outcome"] = "synced"
            result["performed_via"] = "local_git"
            result["mode"] = "local_git"
            return result

    if result["mode"] in {"github_api", "github_api_required"}:
        try:
            direct_result = _sync_with_github_direct_commit(sync_status, message=message, dry_run=dry_run)
        except HarnessError as exc:
            direct_result = {
                "mode": "github_api",
                "blocker": "github_api_direct_commit_failed",
                "error": str(exc),
            }
        if direct_result.get("blocker") is None:
            result.update(direct_result)
            result["outcome"] = "dry_run" if dry_run else "synced"
            return result

        if direct_result.get("blocker") == "github_api_credentials_missing":
            result.update(direct_result)
            result["outcome"] = "blocked"
            return result

        try:
            pr_result = _sync_with_github_pr(sync_status, message=message, dry_run=dry_run)
        except HarnessError as exc:
            pr_result = {
                "mode": "github_api",
                "blocker": "manual_sync_required",
                "error": str(exc),
            }
        if pr_result.get("blocker") is None:
            result.update(pr_result)
            result["outcome"] = "dry_run" if dry_run else "synced"
            return result

        result.update(pr_result)
        result["outcome"] = "blocked"
        return result

    result["outcome"] = "blocked"
    return result


def _safe_validation_snapshot(kind: str, path: Optional[Path]) -> dict[str, Any]:
    snapshot: dict[str, Any] = {
        "kind": kind,
        "path": _relative_display(path) if path else None,
        "valid": False,
        "error": None,
        "summary": {},
    }

    if path is None or not path.exists():
        snapshot["error"] = "missing"
        return snapshot

    try:
        if kind == "spec":
            spec = validate_spec_file()
            sprint_numbers = []
            for item in spec.get("sprints", []):
                if isinstance(item, dict) and isinstance(item.get("sprint"), int):
                    sprint_numbers.append(item["sprint"])
            snapshot["summary"] = {
                "product_name": spec.get("product_name"),
                "feature_count": len(spec.get("features", [])) if isinstance(spec.get("features"), list) else None,
                "acceptance_criteria_count": len(spec.get("acceptance_criteria", []))
                if isinstance(spec.get("acceptance_criteria"), list)
                else None,
                "sprint_count": len(spec.get("sprints", [])) if isinstance(spec.get("sprints"), list) else None,
                "latest_defined_sprint": max(sprint_numbers) if sprint_numbers else None,
            }
        elif kind == "sprint_eval":
            data = load_json_file(path)
            sprint = data.get("sprint") if isinstance(data, dict) else None
            if not isinstance(sprint, int):
                raise HarnessError(f"{path} must define sprint as an integer.")
            validate_sprint_eval(sprint)
            snapshot["summary"] = {
                "sprint": sprint,
                "implemented_count": len(data.get("implemented", [])),
                "source_bug_count": len(data.get("source_bug_ids", [])),
                "addressed_bug_count": len(data.get("addressed_bug_ids", [])),
                "unresolved_bug_count": len(data.get("unresolved_bug_ids", [])),
                "validation_count": len(data.get("validation", [])),
            }
        elif kind == "evaluation_report":
            data = load_json_file(path)
            sprint = data.get("sprint") if isinstance(data, dict) else None
            target_url = data.get("target_url") if isinstance(data, dict) else None
            if not isinstance(sprint, int):
                raise HarnessError(f"{path} must define sprint as an integer.")
            if not isinstance(target_url, str) or not target_url.strip():
                raise HarnessError(f"{path} must define target_url as a non-empty string.")
            validate_evaluation_report(sprint, target_url)
            snapshot["summary"] = {
                "sprint": sprint,
                "status": data.get("status"),
                "checked_at": data.get("checked_at"),
                "check_count": len(data.get("checks", [])),
                "bug_count": len(data.get("bugs", [])),
                "bug_ids": _extract_bug_ids(data.get("bugs")),
                "acceptance_criteria_count": len(data.get("acceptance_criteria_results", [])),
                "failed_acceptance_criteria_count": len(
                    [
                        item
                        for item in data.get("acceptance_criteria_results", [])
                        if isinstance(item, dict) and item.get("status") == "FAIL"
                    ]
                ),
            }
        else:
            raise HarnessError(f"Unknown validation kind: {kind}")
    except HarnessError as exc:
        snapshot["error"] = str(exc)
        return snapshot

    snapshot["valid"] = True
    return snapshot


def _best_effort_bug_tracking_summary(
    latest_sprint_eval: Optional[Path],
    latest_evaluation_report: Optional[Path],
) -> dict[str, Any]:
    summary = {
        "sprint_match": None,
        "current_report_status": None,
        "report_bug_ids": [],
        "generator_source_bug_ids": [],
        "generator_addressed_bug_ids": [],
        "generator_unresolved_bug_ids": [],
        "generator_classification_complete": None,
        "current_fail_report_matches_source": None,
    }
    report_sprint: Optional[int] = None
    generator_sprint: Optional[int] = None

    if latest_evaluation_report and latest_evaluation_report.exists():
        try:
            report_data = load_json_file(latest_evaluation_report)
            if isinstance(report_data, dict):
                if isinstance(report_data.get("sprint"), int):
                    report_sprint = report_data.get("sprint")
                report_status = report_data.get("status")
                if isinstance(report_status, str):
                    summary["current_report_status"] = report_status
                summary["report_bug_ids"] = _extract_bug_ids(report_data.get("bugs"))
        except HarnessError:
            pass

    if latest_sprint_eval and latest_sprint_eval.exists():
        try:
            sprint_eval_data = load_json_file(latest_sprint_eval)
            if isinstance(sprint_eval_data, dict):
                if isinstance(sprint_eval_data.get("sprint"), int):
                    generator_sprint = sprint_eval_data.get("sprint")
                source_bug_ids = sprint_eval_data.get("source_bug_ids")
                addressed = sprint_eval_data.get("addressed_bug_ids")
                unresolved = sprint_eval_data.get("unresolved_bug_ids")
                if isinstance(source_bug_ids, list):
                    summary["generator_source_bug_ids"] = [
                        item.strip() for item in source_bug_ids if isinstance(item, str) and item.strip()
                    ]
                if isinstance(addressed, list):
                    summary["generator_addressed_bug_ids"] = [
                        item.strip() for item in addressed if isinstance(item, str) and item.strip()
                    ]
                if isinstance(unresolved, list):
                    summary["generator_unresolved_bug_ids"] = [
                        item.strip() for item in unresolved if isinstance(item, str) and item.strip()
                    ]
        except HarnessError:
            pass

    if report_sprint is not None and generator_sprint is not None:
        summary["sprint_match"] = report_sprint == generator_sprint
    elif report_sprint is None and generator_sprint is None:
        summary["sprint_match"] = None
    else:
        summary["sprint_match"] = False

    generator_source_bug_ids = set(summary["generator_source_bug_ids"])
    classified_bug_ids = set(summary["generator_addressed_bug_ids"]) | set(summary["generator_unresolved_bug_ids"])
    summary["generator_classification_complete"] = generator_source_bug_ids == classified_bug_ids

    if summary["sprint_match"] and summary["current_report_status"] == "FAIL":
        summary["current_fail_report_matches_source"] = set(summary["report_bug_ids"]) == generator_source_bug_ids
    return summary


def cmd_status() -> None:
    latest_sprint_eval = latest_json(SPRINTS_DIR, "sprint_*_eval.json") if SPRINTS_DIR.exists() else None
    latest_evaluation_report = latest_json(EVALS_DIR, "sprint_*_report.json") if EVALS_DIR.exists() else None
    sync = _git_sync_status()
    status = {
        "branch": sync.get("branch"),
        "upstream": sync.get("upstream"),
        "head_sha": sync.get("head_sha"),
        "pipeline": {
            "spec_exists": spec_path().exists(),
            "build_exists": BUILD_DIR.exists(),
            "build_readme_exists": (BUILD_DIR / "README.md").exists(),
            "latest_sprint_eval": _relative_display(latest_sprint_eval) if latest_sprint_eval else None,
            "latest_evaluation_report": _relative_display(latest_evaluation_report) if latest_evaluation_report else None,
            "latest_evaluation_status": _latest_report_status(),
        },
        "contracts": {
            "planner": {
                "reads": ["prompt", "AGENTS.md"],
                "writes": ["specs/spec.json"],
            },
            "generator": {
                "reads": ["specs/spec.json", "sprint number", "latest evaluation report on retry including bug IDs"],
                "writes": ["build/", "sprints/sprint_N_eval.json with source_bug_ids, addressed_bug_ids, and unresolved_bug_ids"],
            },
            "evaluator": {
                "reads": [
                    "specs/spec.json",
                    "sprints/sprint_N_eval.json",
                    "target URL",
                    "previous evaluations/sprint_N_report.json when preserving bug IDs",
                ],
                "writes": ["evaluations/sprint_N_report.json with structured bugs[].bug_id entries"],
            },
        },
        "validation": {
            "spec": _safe_validation_snapshot("spec", spec_path()),
            "latest_sprint_eval": _safe_validation_snapshot("sprint_eval", latest_sprint_eval),
            "latest_evaluation_report": _safe_validation_snapshot("evaluation_report", latest_evaluation_report),
        },
        "sync": sync,
        "bug_tracking": _best_effort_bug_tracking_summary(latest_sprint_eval, latest_evaluation_report),
        "agents": {
            "planner": {
                "role": "Expand a short product prompt into specs/spec.json.",
                "skill": _artifact_summary(PLANNER_SKILL_PATH),
                "artifact": _artifact_summary(spec_path()),
            },
            "generator": {
                "role": "Implement one sprint at a time in build/, then classify source evaluator bug ids as addressed or unresolved.",
                "skill": _artifact_summary(GENERATOR_SKILL_PATH),
                "artifact_dir": _artifact_summary(SPRINTS_DIR),
                "latest_artifact": _relative_display(latest_sprint_eval) if latest_sprint_eval else None,
            },
            "evaluator": {
                "role": "Test the sprint against the spec and write PASS/FAIL feedback with structured bug IDs.",
                "skill": _artifact_summary(EVALUATOR_SKILL_PATH),
                "artifact_dir": _artifact_summary(EVALS_DIR),
                "latest_artifact": _relative_display(latest_evaluation_report) if latest_evaluation_report else None,
                "latest_status": _latest_report_status(),
            },
        },
        "autodev": {
            "entrypoint": "python agents/orchestrator_codex.py autodev \"<description>\" --sprint 1 --max-iterations 3 [--replan]",
            "replans_by_default": False,
            "loop": ["planner", "generator", "npm install", "npm run dev", "evaluator"],
            "auto_sync_supported": True,
            "auto_sync_trigger": "pass_only_when_worktree_started_clean",
            "auto_sync_flag": "--auto-sync",
        },
    }
    print(json.dumps(status, indent=2, ensure_ascii=False))


def cmd_sync(message: str, *, dry_run: bool) -> None:
    result = sync_changes(message, dry_run=dry_run)
    print(json.dumps(result, indent=2, ensure_ascii=False))
    if result.get("outcome") == "blocked" and not dry_run:
        blocker = result.get("blocker") or "sync_blocked"
        raise HarnessError(f"Sync blocked: {blocker}")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Codex-backed orchestrator for the Travel App pipeline")
    subparsers = parser.add_subparsers(dest="command", required=True)

    plan_parser = subparsers.add_parser("plan", help="Planner: create or update specs/spec.json")
    plan_parser.add_argument("description", help="Product description")

    gen_parser = subparsers.add_parser("generate", help="Generator: update build/ and write sprints/sprint_N_eval.json")
    gen_parser.add_argument("sprint", type=int, help="Sprint number to implement")

    eval_parser = subparsers.add_parser("evaluate", help="Evaluator: read the sprint and write evaluations/sprint_N_report.json")
    eval_parser.add_argument("sprint", type=int, help="Sprint number to evaluate")
    eval_parser.add_argument("url", nargs="?", default="http://localhost:3000", help="App URL")

    autodev_parser = subparsers.add_parser("autodev", help="Run planner/generator/evaluator in a local loop")
    autodev_parser.add_argument("description", help="Product description")
    autodev_parser.add_argument("--sprint", type=int, default=1, help="Sprint number to implement and evaluate")
    autodev_parser.add_argument("--max-iterations", type=int, default=3, help="Maximum number of generate/evaluate loops")
    autodev_parser.add_argument("--url", default="http://localhost:3000", help="App URL to evaluate")
    autodev_parser.add_argument(
        "--replan",
        action="store_true",
        help="Run the planner even when specs/spec.json already exists",
    )
    autodev_parser.add_argument(
        "--startup-timeout",
        type=int,
        default=120,
        help="Seconds to wait for the local dev server before continuing to evaluation",
    )
    autodev_parser.add_argument(
        "--auto-sync",
        action="store_true",
        help="After a PASS report, attempt to sync the resulting changes if the worktree was clean at the start of the run",
    )

    sync_parser = subparsers.add_parser("sync", help="Sync pending changes via local git or GitHub API fallback")
    sync_parser.add_argument("message", help="Commit or PR title/message")
    sync_parser.add_argument("--dry-run", action="store_true", help="Show the planned sync path without mutating git or GitHub")

    subparsers.add_parser("status", help="Show agent-centric pipeline status")
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
                replan=args.replan,
                auto_sync=args.auto_sync,
            )
        elif args.command == "sync":
            cmd_sync(args.message, dry_run=args.dry_run)
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
