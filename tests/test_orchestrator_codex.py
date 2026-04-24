from __future__ import annotations

import importlib
import json
import shutil
import unittest
import uuid
from io import StringIO
from pathlib import Path
from unittest.mock import Mock, patch

from agents.codex_runner import CodexRunResult


orchestrator = importlib.import_module("agents.orchestrator_codex")


def make_codex_result(stdout: str = "ok") -> CodexRunResult:
    return CodexRunResult(command=("codex", "exec"), stdout=stdout, stderr="", returncode=0)


class OrchestratorCodexTestCase(unittest.TestCase):
    def setUp(self) -> None:
        sandbox_tmp = Path.cwd() / ".tmp-harness-tests"
        sandbox_tmp.mkdir(parents=True, exist_ok=True)
        self.root = sandbox_tmp / uuid.uuid4().hex
        self.root.mkdir(parents=True, exist_ok=True)
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
        self.addCleanup(lambda: shutil.rmtree(self.root, ignore_errors=True))

    def write_json(self, path: Path, payload: object) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")

    def valid_spec(self) -> dict[str, object]:
        return {
            "product_name": "TripEntry",
            "summary": "Premium travel planner for comparing long-haul route ideas.",
            "target_users": ["Travelers planning overseas trips."],
            "assumptions": ["Users compare airports before opening booking links."],
            "out_of_scope": ["Processing ticket purchases."],
            "acceptance_criteria": ["The planner can present a browser-demoable trip comparison flow."],
            "design_direction": {
                "tone": ["Calm", "Premium"],
                "layout_principles": ["Clear hierarchy", "Editorial spacing"],
                "motion": ["Subtle motion"],
            },
            "features": [
                {
                    "id": "travel-planner",
                    "name": "Travel Planner",
                    "description": "Collects trip inputs and compares routes.",
                    "must_have": ["Collect traveler inputs.", "Render trip recommendations."],
                }
            ],
            "sprints": [
                {
                    "sprint": 1,
                    "name": "Initial Planner",
                    "goal": "Create the first demoable planning flow.",
                    "scope": ["Render the home page.", "Collect planner inputs."],
                    "acceptance_criteria": [
                        "The home page renders.",
                        "The planner accepts traveler inputs.",
                    ],
                }
            ],
        }

    def valid_sprint_eval(
        self,
        *,
        source_bug_ids: list[str] | None = None,
        addressed_bug_ids: list[str] | None = None,
        unresolved_bug_ids: list[str] | None = None,
    ) -> dict[str, object]:
        return {
            "sprint": 1,
            "implemented": ["Created or updated the app."],
            "known_issues": [],
            "source_bug_ids": source_bug_ids or [],
            "addressed_bug_ids": addressed_bug_ids or [],
            "unresolved_bug_ids": unresolved_bug_ids or [],
            "run_instructions": {
                "install": "npm install",
                "dev": "npm run dev",
            },
            "validation": [
                {
                    "command": "npm run typecheck",
                    "result": "passed",
                }
            ],
        }

    def valid_report(
        self,
        *,
        status: str = "PASS",
        bug_ids: list[str] | None = None,
        target_url: str = "http://localhost:3000",
    ) -> dict[str, object]:
        criteria = self.valid_spec()["sprints"][0]["acceptance_criteria"]  # type: ignore[index]
        if status == "PASS":
            acceptance_results = [
                {
                    "criterion": criterion,
                    "status": "PASS",
                    "evidence": f"Verified: {criterion}",
                }
                for criterion in criteria
            ]
            bugs: list[dict[str, str]] = []
            next_actions: list[str] = []
            checks = [
                {
                    "name": "Planner flow can be opened.",
                    "result": "PASS",
                    "evidence": "The page rendered without issues.",
                }
            ]
        else:
            bug_id = (bug_ids or ["B1"])[0]
            acceptance_results = [
                {
                    "criterion": criteria[0],
                    "status": "FAIL",
                    "evidence": "The planner UI did not fully render.",
                },
                {
                    "criterion": criteria[1],
                    "status": "PASS",
                    "evidence": "Traveler inputs can still be entered.",
                },
            ]
            bugs = [
                {
                    "bug_id": bug_id,
                    "title": "Destination list did not render.",
                    "severity": "P1",
                    "evidence": "The destination area stayed empty after submit.",
                    "repro": "Open the planner and submit a trip request.",
                }
            ]
            next_actions = ["Render the destination list before allowing submit."]
            checks = [
                {
                    "name": "Planner flow can be opened.",
                    "result": "FAIL",
                    "evidence": "The core destination content did not appear.",
                }
            ]

        return {
            "sprint": 1,
            "target_url": target_url,
            "status": status,
            "checked_at": "2026-04-24",
            "validation_method": {
                "playwright_mcp_available": False,
                "agent_browser_available": False,
                "fallback_used": ["Unit test fallback"],
                "notes": "Validation used deterministic local test fixtures.",
            },
            "checks": checks,
            "acceptance_criteria_results": acceptance_results,
            "bugs": bugs,
            "next_actions": next_actions,
        }


class ContractValidationTests(OrchestratorCodexTestCase):
    def test_validate_sprint_eval_requires_exact_source_bug_classification(self) -> None:
        self.write_json(orchestrator.spec_path(), self.valid_spec())

        cases = [
            (
                "missing classification",
                self.valid_sprint_eval(source_bug_ids=["B1", "B2"], addressed_bug_ids=["B1"], unresolved_bug_ids=[]),
            ),
            (
                "unexpected bug id",
                self.valid_sprint_eval(source_bug_ids=["B1"], addressed_bug_ids=["B1", "B3"], unresolved_bug_ids=[]),
            ),
            (
                "same bug id in both arrays",
                self.valid_sprint_eval(source_bug_ids=["B1"], addressed_bug_ids=["B1"], unresolved_bug_ids=["B1"]),
            ),
        ]

        for label, payload in cases:
            with self.subTest(label=label):
                self.write_json(orchestrator.sprint_eval_path(1), payload)
                with self.assertRaises(orchestrator.HarnessError):
                    orchestrator.validate_sprint_eval(1)

    def test_validate_retry_bug_linkage_requires_exact_source_bug_copy(self) -> None:
        sprint_eval = self.valid_sprint_eval(source_bug_ids=["B2", "B1"], addressed_bug_ids=["B1"], unresolved_bug_ids=["B2"])
        failure_feedback = self.valid_report(status="FAIL", bug_ids=["B1"])
        failure_feedback["bugs"] = [
            {
                "bug_id": "B1",
                "title": "Primary bug",
                "severity": "P1",
                "evidence": "Evidence 1",
                "repro": "Repro 1",
            },
            {
                "bug_id": "B2",
                "title": "Secondary bug",
                "severity": "P2",
                "evidence": "Evidence 2",
                "repro": "Repro 2",
            },
        ]

        orchestrator.validate_retry_bug_linkage(
            sprint_eval,
            failure_feedback,
            path=orchestrator.sprint_eval_path(1),
        )

        bad_eval = self.valid_sprint_eval(source_bug_ids=["B1"], addressed_bug_ids=["B1"], unresolved_bug_ids=[])
        with self.assertRaises(orchestrator.HarnessError):
            orchestrator.validate_retry_bug_linkage(
                bad_eval,
                failure_feedback,
                path=orchestrator.sprint_eval_path(1),
            )

        with self.assertRaises(orchestrator.HarnessError):
            orchestrator.validate_retry_bug_linkage(
                self.valid_sprint_eval(source_bug_ids=["B1"], addressed_bug_ids=["B1"], unresolved_bug_ids=[]),
                None,
                path=orchestrator.sprint_eval_path(1),
            )

    def test_validate_evaluation_report_requires_structured_fail_bugs(self) -> None:
        self.write_json(orchestrator.spec_path(), self.valid_spec())

        bad_report = self.valid_report(status="FAIL")
        bad_report["bugs"] = [
            {
                "title": "Destination list did not render.",
                "severity": "P1",
                "evidence": "The planner stayed empty.",
                "repro": "Submit a trip request.",
            }
        ]
        self.write_json(orchestrator.evaluation_report_path(1), bad_report)

        with self.assertRaises(orchestrator.HarnessError):
            orchestrator.validate_evaluation_report(1, "http://localhost:3000")

    def test_status_includes_sync_snapshot(self) -> None:
        self.write_json(orchestrator.spec_path(), self.valid_spec())
        self.write_json(orchestrator.sprint_eval_path(1), self.valid_sprint_eval())
        self.write_json(orchestrator.evaluation_report_path(1), self.valid_report(status="PASS"))

        fake_sync = {
            "git_repo": True,
            "branch": "codex/test",
            "head_sha": "abc1234",
            "worktree_dirty": True,
            "upstream": {"configured": True, "ref": "origin/codex/test", "ahead": 1, "behind": 0},
            "origin": {
                "present": True,
                "url": "https://github.com/example/repo.git",
                "github_like": True,
                "repo_slug": "example/repo",
            },
            "local_write": {"git_dir_exists": True, "git_dir_writable": False},
            "readiness": {
                "push_ready_local": False,
                "pr_ready_local": False,
                "reasons": [".git directory is not writable by the current process"],
            },
            "diagnostics": {
                "warnings": [],
                "network_used": False,
                "git_fetch_used": False,
                "github_api_used": False,
            },
        }

        with patch.object(orchestrator, "_git_sync_status", return_value=fake_sync), patch(
            "sys.stdout",
            new_callable=StringIO,
        ) as stdout:
            orchestrator.cmd_status()

        payload = json.loads(stdout.getvalue())
        self.assertIn("sync", payload)
        self.assertEqual(payload["sync"]["branch"], "codex/test")
        self.assertFalse(payload["sync"]["readiness"]["push_ready_local"])


class AutodevHarnessTests(OrchestratorCodexTestCase):
    def test_autodev_passes_on_first_iteration(self) -> None:
        call_counts = {"planner": 0, "generator": 0, "evaluator": 0}

        def fake_run_codex(prompt: str, **_: object) -> CodexRunResult:
            if "planner skill" in prompt:
                call_counts["planner"] += 1
                self.write_json(orchestrator.spec_path(), self.valid_spec())
            elif "generator skill" in prompt:
                call_counts["generator"] += 1
                orchestrator.BUILD_DIR.mkdir(parents=True, exist_ok=True)
                (orchestrator.BUILD_DIR / "package.json").write_text('{"name":"trip-app"}', encoding="utf-8")
                self.write_json(orchestrator.sprint_eval_path(1), self.valid_sprint_eval())
            elif "evaluator skill" in prompt:
                call_counts["evaluator"] += 1
                self.write_json(orchestrator.evaluation_report_path(1), self.valid_report(status="PASS"))
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
                replan=False,
            )

        self.assertEqual(exit_code, 0)
        self.assertEqual(call_counts, {"planner": 1, "generator": 1, "evaluator": 1})
        stop_dev_server.assert_called_once()

    def test_autodev_retries_with_source_bug_ids_and_survives_pass_overwrite(self) -> None:
        evaluator_calls = 0
        generator_calls = 0
        generator_prompts: list[str] = []

        def fake_run_codex(prompt: str, **_: object) -> CodexRunResult:
            nonlocal evaluator_calls, generator_calls

            if "planner skill" in prompt:
                self.write_json(orchestrator.spec_path(), self.valid_spec())
            elif "generator skill" in prompt:
                generator_calls += 1
                generator_prompts.append(prompt)
                orchestrator.BUILD_DIR.mkdir(parents=True, exist_ok=True)
                (orchestrator.BUILD_DIR / "package.json").write_text('{"name":"trip-app"}', encoding="utf-8")
                if generator_calls == 1:
                    payload = self.valid_sprint_eval()
                else:
                    payload = self.valid_sprint_eval(
                        source_bug_ids=["B1"],
                        addressed_bug_ids=["B1"],
                        unresolved_bug_ids=[],
                    )
                self.write_json(orchestrator.sprint_eval_path(1), payload)
            elif "evaluator skill" in prompt:
                evaluator_calls += 1
                status = "FAIL" if evaluator_calls == 1 else "PASS"
                report = self.valid_report(status=status, bug_ids=["B1"])
                self.write_json(orchestrator.evaluation_report_path(1), report)
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
                replan=False,
            )

        self.assertEqual(exit_code, 0)
        self.assertEqual(len(generator_prompts), 2)
        self.assertIn("Do not change specs/spec.json.", generator_prompts[1])
        self.assertIn("source_bug_ids", generator_prompts[1])
        final_sprint_eval = json.loads(orchestrator.sprint_eval_path(1).read_text(encoding="utf-8"))
        final_report = json.loads(orchestrator.evaluation_report_path(1).read_text(encoding="utf-8"))
        self.assertEqual(final_sprint_eval["source_bug_ids"], ["B1"])
        self.assertEqual(final_sprint_eval["addressed_bug_ids"], ["B1"])
        self.assertEqual(final_report["status"], "PASS")
        self.assertEqual(final_report["bugs"], [])

    def test_autodev_records_failure_when_app_never_starts(self) -> None:
        evaluator_calls = 0
        stop_dev_server = Mock()

        def fake_run_codex(prompt: str, **_: object) -> CodexRunResult:
            nonlocal evaluator_calls

            if "planner skill" in prompt:
                self.write_json(orchestrator.spec_path(), self.valid_spec())
            elif "generator skill" in prompt:
                orchestrator.BUILD_DIR.mkdir(parents=True, exist_ok=True)
                (orchestrator.BUILD_DIR / "package.json").write_text('{"name":"trip-app"}', encoding="utf-8")
                self.write_json(orchestrator.sprint_eval_path(1), self.valid_sprint_eval())
            elif "evaluator skill" in prompt:
                evaluator_calls += 1
                self.write_json(orchestrator.evaluation_report_path(1), self.valid_report(status="FAIL", bug_ids=["B1"]))
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
                replan=False,
            )

        self.assertEqual(exit_code, 1)
        self.assertEqual(evaluator_calls, 1)
        stop_dev_server.assert_called_once()

    def test_autodev_stops_on_invalid_evaluation_json(self) -> None:
        def fake_run_codex(prompt: str, **_: object) -> CodexRunResult:
            if "planner skill" in prompt:
                self.write_json(orchestrator.spec_path(), self.valid_spec())
            elif "generator skill" in prompt:
                orchestrator.BUILD_DIR.mkdir(parents=True, exist_ok=True)
                (orchestrator.BUILD_DIR / "package.json").write_text('{"name":"trip-app"}', encoding="utf-8")
                self.write_json(orchestrator.sprint_eval_path(1), self.valid_sprint_eval())
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
                    replan=False,
                )


if __name__ == "__main__":
    unittest.main()
