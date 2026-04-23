from __future__ import annotations

import importlib
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

from agents.codex_runner import CodexRunResult


orchestrator = importlib.import_module("agents.orchestrator_codex")


def make_codex_result(stdout: str = "ok") -> CodexRunResult:
    return CodexRunResult(command=("codex", "exec"), stdout=stdout, stderr="", returncode=0)


class AutodevHarnessTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tempdir = tempfile.TemporaryDirectory()
        self.root = Path(self.tempdir.name)
        self.patches = [
            patch.object(orchestrator, "ROOT", self.root),
            patch.object(orchestrator, "SPECS_DIR", self.root / "specs"),
            patch.object(orchestrator, "SPRINTS_DIR", self.root / "sprints"),
            patch.object(orchestrator, "EVALS_DIR", self.root / "evaluations"),
            patch.object(orchestrator, "BUILD_DIR", self.root / "build"),
        ]
        for active_patch in self.patches:
            active_patch.start()
            self.addCleanup(active_patch.stop)
        self.addCleanup(self.tempdir.cleanup)

    def write_json(self, path: Path, payload: object) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")

    def fake_sprint_eval(self) -> dict[str, object]:
        return {
            "sprint": 1,
            "implemented": ["Created or updated the app."],
            "known_issues": [],
            "run_instructions": {
                "install": "npm install",
                "dev": "npm run dev",
            },
        }

    def test_autodev_passes_on_first_iteration(self) -> None:
        call_counts = {"planner": 0, "generator": 0, "evaluator": 0}

        def fake_run_codex(prompt: str, **_: object) -> CodexRunResult:
            if "planner skill" in prompt:
                call_counts["planner"] += 1
                self.write_json(orchestrator.spec_path(), {"product_name": "TripEntry", "features": [], "sprints": []})
            elif "generator skill" in prompt:
                call_counts["generator"] += 1
                orchestrator.BUILD_DIR.mkdir(parents=True, exist_ok=True)
                (orchestrator.BUILD_DIR / "package.json").write_text('{"name":"trip-app"}', encoding="utf-8")
                self.write_json(orchestrator.sprint_eval_path(1), self.fake_sprint_eval())
            elif "evaluator skill" in prompt:
                call_counts["evaluator"] += 1
                self.write_json(
                    orchestrator.evaluation_report_path(1),
                    {
                        "sprint": 1,
                        "target_url": "http://localhost:3000",
                        "status": "PASS",
                        "checks": ["Home page rendered."],
                        "bugs": [],
                        "next_actions": [],
                    },
                )
            return make_codex_result()

        stop_dev_server = Mock()
        with patch.object(orchestrator, "run_codex", side_effect=fake_run_codex), patch.object(
            orchestrator, "install_build_dependencies", return_value=True
        ), patch.object(
            orchestrator, "start_dev_server", return_value=None
        ), patch.object(
            orchestrator, "wait_for_url", return_value=True
        ), patch.object(
            orchestrator, "stop_dev_server", stop_dev_server
        ):
            exit_code = orchestrator.cmd_autodev(
                description="Build a web app that organizes travel options from user inputs.",
                sprint=1,
                max_iterations=3,
                url="http://localhost:3000",
                startup_timeout=1,
            )

        self.assertEqual(exit_code, 0)
        self.assertEqual(call_counts, {"planner": 1, "generator": 1, "evaluator": 1})
        stop_dev_server.assert_called_once()

    def test_autodev_retries_with_latest_failure_feedback(self) -> None:
        evaluator_calls = 0
        generator_prompts: list[str] = []

        def fake_run_codex(prompt: str, **_: object) -> CodexRunResult:
            nonlocal evaluator_calls

            if "planner skill" in prompt:
                self.write_json(orchestrator.spec_path(), {"product_name": "TripEntry", "features": [], "sprints": []})
            elif "generator skill" in prompt:
                generator_prompts.append(prompt)
                orchestrator.BUILD_DIR.mkdir(parents=True, exist_ok=True)
                (orchestrator.BUILD_DIR / "package.json").write_text('{"name":"trip-app"}', encoding="utf-8")
                self.write_json(orchestrator.sprint_eval_path(1), self.fake_sprint_eval())
            elif "evaluator skill" in prompt:
                evaluator_calls += 1
                status = "FAIL" if evaluator_calls == 1 else "PASS"
                bugs = [{"title": "Destination list did not render."}] if status == "FAIL" else []
                next_actions = ["Render the destination list before allowing submit."] if status == "FAIL" else []
                self.write_json(
                    orchestrator.evaluation_report_path(1),
                    {
                        "sprint": 1,
                        "target_url": "http://localhost:3000",
                        "status": status,
                        "checks": ["Planner flow can be opened."],
                        "bugs": bugs,
                        "next_actions": next_actions,
                    },
                )
            return make_codex_result()

        with patch.object(orchestrator, "run_codex", side_effect=fake_run_codex), patch.object(
            orchestrator, "install_build_dependencies", return_value=True
        ), patch.object(
            orchestrator, "start_dev_server", return_value=None
        ), patch.object(
            orchestrator, "wait_for_url", return_value=True
        ), patch.object(
            orchestrator, "stop_dev_server", Mock()
        ):
            exit_code = orchestrator.cmd_autodev(
                description="Build a web app that organizes travel options from user inputs.",
                sprint=1,
                max_iterations=3,
                url="http://localhost:3000",
                startup_timeout=1,
            )

        self.assertEqual(exit_code, 0)
        self.assertEqual(len(generator_prompts), 2)
        self.assertIn("Do not change specs/spec.json.", generator_prompts[1])
        self.assertIn("Destination list did not render.", generator_prompts[1])

    def test_autodev_records_failure_when_app_never_starts(self) -> None:
        evaluator_calls = 0
        stop_dev_server = Mock()

        def fake_run_codex(prompt: str, **_: object) -> CodexRunResult:
            nonlocal evaluator_calls

            if "planner skill" in prompt:
                self.write_json(orchestrator.spec_path(), {"product_name": "TripEntry", "features": [], "sprints": []})
            elif "generator skill" in prompt:
                orchestrator.BUILD_DIR.mkdir(parents=True, exist_ok=True)
                (orchestrator.BUILD_DIR / "package.json").write_text('{"name":"trip-app"}', encoding="utf-8")
                self.write_json(orchestrator.sprint_eval_path(1), self.fake_sprint_eval())
            elif "evaluator skill" in prompt:
                evaluator_calls += 1
                self.write_json(
                    orchestrator.evaluation_report_path(1),
                    {
                        "sprint": 1,
                        "target_url": "http://localhost:3000",
                        "status": "FAIL",
                        "checks": ["URL was unreachable during evaluation."],
                        "bugs": [{"title": "App server was unavailable."}],
                        "next_actions": ["Fix startup so the app is reachable before re-running evaluation."],
                    },
                )
            return make_codex_result()

        with patch.object(orchestrator, "run_codex", side_effect=fake_run_codex), patch.object(
            orchestrator, "install_build_dependencies", return_value=False
        ), patch.object(
            orchestrator, "start_dev_server", return_value=None
        ), patch.object(
            orchestrator, "wait_for_url", return_value=False
        ), patch.object(
            orchestrator, "stop_dev_server", stop_dev_server
        ):
            exit_code = orchestrator.cmd_autodev(
                description="Build a web app that organizes travel options from user inputs.",
                sprint=1,
                max_iterations=1,
                url="http://localhost:3000",
                startup_timeout=1,
            )

        self.assertEqual(exit_code, 1)
        self.assertEqual(evaluator_calls, 1)
        stop_dev_server.assert_called_once()

    def test_autodev_stops_on_invalid_evaluation_json(self) -> None:
        def fake_run_codex(prompt: str, **_: object) -> CodexRunResult:
            if "planner skill" in prompt:
                self.write_json(orchestrator.spec_path(), {"product_name": "TripEntry", "features": [], "sprints": []})
            elif "generator skill" in prompt:
                orchestrator.BUILD_DIR.mkdir(parents=True, exist_ok=True)
                (orchestrator.BUILD_DIR / "package.json").write_text('{"name":"trip-app"}', encoding="utf-8")
                self.write_json(orchestrator.sprint_eval_path(1), self.fake_sprint_eval())
            elif "evaluator skill" in prompt:
                orchestrator.evaluation_report_path(1).parent.mkdir(parents=True, exist_ok=True)
                orchestrator.evaluation_report_path(1).write_text("{not-valid-json", encoding="utf-8")
            return make_codex_result()

        with patch.object(orchestrator, "run_codex", side_effect=fake_run_codex), patch.object(
            orchestrator, "install_build_dependencies", return_value=True
        ), patch.object(
            orchestrator, "start_dev_server", return_value=None
        ), patch.object(
            orchestrator, "wait_for_url", return_value=True
        ), patch.object(
            orchestrator, "stop_dev_server", Mock()
        ):
            with self.assertRaises(orchestrator.HarnessError):
                orchestrator.cmd_autodev(
                    description="Build a web app that organizes travel options from user inputs.",
                    sprint=1,
                    max_iterations=1,
                    url="http://localhost:3000",
                    startup_timeout=1,
                )


if __name__ == "__main__":
    unittest.main()
