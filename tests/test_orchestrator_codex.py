from __future__ import annotations

import importlib
import json
import os
import shutil
import subprocess
import unittest
import uuid
from io import StringIO
from pathlib import Path
from unittest.mock import Mock, patch

from agents.codex_runner import CodexRunResult


orchestrator = importlib.import_module("agents.orchestrator_codex")


def make_codex_result(stdout: str = "ok") -> CodexRunResult:
    return CodexRunResult(command=("codex", "exec"), stdout=stdout, stderr="", returncode=0)


def make_git_result(*args: str, stdout: str = "", stderr: str = "", returncode: int = 0) -> subprocess.CompletedProcess[str]:
    return subprocess.CompletedProcess(args=("git", *args), returncode=returncode, stdout=stdout, stderr=stderr)


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
            "branch": "codex/test",
            "upstream": "origin/codex/test",
            "head_sha": "abc1234",
            "mode": "github_api_required",
            "local_git_writable": False,
            "blocker": "github_api_credentials_missing",
            "pending_changes_count": 3,
            "pending_changes_preview": ["README.md", "agents/README.md", "agents/orchestrator_codex.py"],
            "can_sync_without_git_index": False,
            "git_repo": True,
            "origin": {
                "present": True,
                "url": "https://github.com/example/repo.git",
                "github_like": True,
                "repo_slug": "example/repo",
            },
            "required_env_names": ["GITHUB_TOKEN", "GH_TOKEN"],
            "manual_instructions": ["Export GITHUB_TOKEN and retry sync."],
            "upstream_detail": {"configured": True, "ahead": 1, "behind": 0},
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
        self.assertEqual(payload["branch"], "codex/test")
        self.assertEqual(payload["upstream"], "origin/codex/test")
        self.assertEqual(payload["head_sha"], "abc1234")
        self.assertEqual(payload["sync"]["branch"], "codex/test")
        self.assertEqual(payload["sync"]["mode"], "github_api_required")
        self.assertFalse(payload["sync"]["local_git_writable"])
        self.assertEqual(payload["sync"]["blocker"], "github_api_credentials_missing")
        self.assertEqual(payload["sync"]["pending_changes_count"], 3)
        self.assertFalse(payload["sync"]["can_sync_without_git_index"])

    def test_cmd_plan_raises_when_planner_does_not_write_valid_spec(self) -> None:
        with patch.object(orchestrator, "run_plan", return_value=make_codex_result()):
            with self.assertRaises(orchestrator.HarnessError):
                orchestrator.cmd_plan("Build a travel planner")

    def test_cmd_evaluate_raises_when_report_mismatches_invocation(self) -> None:
        self.write_json(orchestrator.spec_path(), self.valid_spec())
        self.write_json(orchestrator.sprint_eval_path(1), self.valid_sprint_eval())
        self.write_json(
            orchestrator.evaluation_report_path(1),
            self.valid_report(status="PASS", target_url="http://localhost:4000"),
        )

        with patch.object(orchestrator, "run_evaluate", return_value=make_codex_result()):
            with self.assertRaises(orchestrator.HarnessError):
                orchestrator.cmd_evaluate(1, "http://localhost:3000")


class SyncAutomationTests(OrchestratorCodexTestCase):
    def fake_git_side_effect(
        self,
        *,
        add_probe: subprocess.CompletedProcess[str],
        push_probe: subprocess.CompletedProcess[str] | None = None,
        ahead_behind_stdout: str = "0 0\n",
        status_stdout: str = " M README.md\n M agents/README.md\n M agents/orchestrator_codex.py\n",
    ):
        def side_effect(*args: str):
            command = tuple(args)
            mapping = {
                ("rev-parse", "--is-inside-work-tree"): make_git_result(*args, stdout="true\n"),
                ("branch", "--show-current"): make_git_result(*args, stdout="codex/test\n"),
                ("rev-parse", "--short", "HEAD"): make_git_result(*args, stdout="abc1234\n"),
                ("status", "--porcelain", "--untracked-files=normal"): make_git_result(*args, stdout=status_stdout),
                ("rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"): make_git_result(
                    *args, stdout="origin/codex/test\n"
                ),
                ("rev-list", "--left-right", "--count", "HEAD...@{u}"): make_git_result(*args, stdout=ahead_behind_stdout),
                ("remote", "get-url", "origin"): make_git_result(
                    *args, stdout="https://github.com/example/repo.git\n"
                ),
                ("add", "-A", "--dry-run"): add_probe,
                ("push", "--dry-run", "origin", "HEAD:refs/heads/codex/test"): push_probe or make_git_result(*args),
            }
            return mapping.get(command, make_git_result(*args))

        return side_effect

    def test_resolve_github_sync_context_reads_token_from_sync_env_file(self) -> None:
        env_dir = self.root / ".env.sync.local"
        env_dir.mkdir(parents=True, exist_ok=True)
        (env_dir / ".env.sync.local.txt").write_text(
            "GITHUB_TOKEN=file-token\nGITHUB_OWNER=example\nGITHUB_REPO=repo\nGITHUB_SYNC_BRANCH=codex/test\n",
            encoding="utf-8",
        )

        with patch.dict(os.environ, {}, clear=True):
            context = orchestrator._resolve_github_sync_context(
                "codex/test",
                {"repo_slug": "example/repo"},
            )

        self.assertEqual(context["token_env_name"], "GITHUB_TOKEN")
        self.assertEqual(context["token"], "file-token")
        self.assertEqual(context["owner"], "example")
        self.assertEqual(context["repo"], "repo")
        self.assertEqual(context["branch"], "codex/test")
        self.assertTrue(context["can_sync_without_git_index"])
        self.assertTrue(str(context["env_file_path"]).endswith(".env.sync.local.txt"))

    def test_git_sync_status_uses_sync_env_file_for_github_api_fallback(self) -> None:
        env_dir = self.root / ".env.sync.local"
        env_dir.mkdir(parents=True, exist_ok=True)
        (env_dir / ".env.sync.local.txt").write_text(
            "file-token\n",
            encoding="utf-8",
        )
        add_probe = make_git_result(
            "add",
            "-A",
            "--dry-run",
            stderr="fatal: Unable to create '.git/index.lock': Permission denied",
            returncode=1,
        )
        with patch.object(orchestrator, "_run_git_command", side_effect=self.fake_git_side_effect(add_probe=add_probe)), patch.dict(
            os.environ,
            {},
            clear=True,
        ):
            sync = orchestrator._git_sync_status()

        self.assertEqual(sync["mode"], "github_api_required")
        self.assertEqual(sync["blocker"], "local_git_index_lock_permission_denied")
        self.assertTrue(sync["can_sync_without_git_index"])
        self.assertEqual(sync["required_env_names"], [])

    def test_git_sync_status_uses_local_git_mode_when_writable(self) -> None:
        add_probe = make_git_result("add", "-A", "--dry-run", stdout="")
        with patch.object(orchestrator, "_run_git_command", side_effect=self.fake_git_side_effect(add_probe=add_probe)), patch.dict(
            os.environ,
            {},
            clear=True,
        ):
            sync = orchestrator._git_sync_status()

        self.assertEqual(sync["mode"], "local_git")
        self.assertTrue(sync["local_git_writable"])

    def test_git_sync_status_switches_to_github_api_required_on_index_lock_denied(self) -> None:
        add_probe = make_git_result(
            "add",
            "-A",
            "--dry-run",
            stderr="fatal: Unable to create '.git/index.lock': Permission denied",
            returncode=1,
        )
        with patch.object(orchestrator, "_run_git_command", side_effect=self.fake_git_side_effect(add_probe=add_probe)), patch.dict(
            os.environ,
            {},
            clear=True,
        ):
            sync = orchestrator._git_sync_status()

        self.assertEqual(sync["mode"], "github_api_required")
        self.assertFalse(sync["local_git_writable"])

    def test_git_sync_status_reports_pending_change_count_and_preview(self) -> None:
        add_probe = make_git_result("add", "-A", "--dry-run", stdout="")
        status_stdout = " M README.md\n M agents/README.md\n M agents/orchestrator_codex.py\n"
        with patch.object(
            orchestrator,
            "_run_git_command",
            side_effect=self.fake_git_side_effect(add_probe=add_probe, status_stdout=status_stdout),
        ), patch.dict(os.environ, {}, clear=True):
            sync = orchestrator._git_sync_status()

        self.assertEqual(sync["pending_changes_count"], 3)
        self.assertEqual(
            sync["pending_changes_preview"],
            ["README.md", "agents/README.md", "agents/orchestrator_codex.py"],
        )

    def test_git_sync_status_marks_missing_github_api_credentials(self) -> None:
        add_probe = make_git_result(
            "add",
            "-A",
            "--dry-run",
            stderr="fatal: Unable to create '.git/index.lock': Permission denied",
            returncode=1,
        )
        with patch.object(orchestrator, "_run_git_command", side_effect=self.fake_git_side_effect(add_probe=add_probe)), patch.dict(
            os.environ,
            {},
            clear=True,
        ):
            sync = orchestrator._git_sync_status()

        self.assertEqual(sync["blocker"], "github_api_credentials_missing")
        self.assertFalse(sync["can_sync_without_git_index"])
        self.assertIn("GITHUB_TOKEN", sync["required_env_names"])

    def test_git_sync_status_prefers_no_pending_changes_over_credentials_blocker(self) -> None:
        add_probe = make_git_result(
            "add",
            "-A",
            "--dry-run",
            stderr="fatal: Unable to create '.git/index.lock': Permission denied",
            returncode=1,
        )
        with patch.object(
            orchestrator,
            "_run_git_command",
            side_effect=self.fake_git_side_effect(add_probe=add_probe, status_stdout=""),
        ), patch.dict(os.environ, {}, clear=True):
            sync = orchestrator._git_sync_status()

        self.assertEqual(sync["pending_changes_count"], 0)
        self.assertEqual(sync["blocker"], "no_pending_changes")
        self.assertEqual(sync["mode"], "github_api_required")
        self.assertFalse(sync["can_sync_without_git_index"])

    def test_git_sync_status_marks_local_git_https_credentials_missing(self) -> None:
        add_probe = make_git_result("add", "-A", "--dry-run", stdout="")
        push_probe = make_git_result(
            "push",
            "--dry-run",
            "origin",
            "HEAD:refs/heads/codex/test",
            stderr="fatal: unable to access 'https://github.com/example/repo.git/': schannel: AcquireCredentialsHandle failed: SEC_E_NO_CREDENTIALS (0x8009030E)",
            returncode=1,
        )
        with patch.object(
            orchestrator,
            "_run_git_command",
            side_effect=self.fake_git_side_effect(add_probe=add_probe, push_probe=push_probe),
        ), patch.dict(os.environ, {}, clear=True):
            sync = orchestrator._git_sync_status()

        self.assertEqual(sync["mode"], "github_api_required")
        self.assertTrue(sync["local_git_writable"])
        self.assertFalse(sync["local_git_pushable"])
        self.assertEqual(sync["blocker"], "local_git_https_credentials_missing")
        self.assertFalse(sync["can_sync_without_git_index"])
        self.assertTrue(sync["diagnostics"]["network_used"])

    def test_git_sync_status_marks_unpushed_commits_when_worktree_is_clean(self) -> None:
        add_probe = make_git_result("add", "-A", "--dry-run", stdout="")
        with patch.object(
            orchestrator,
            "_run_git_command",
            side_effect=self.fake_git_side_effect(
                add_probe=add_probe,
                status_stdout="",
                ahead_behind_stdout="2 0\n",
            ),
        ), patch.dict(os.environ, {}, clear=True):
            sync = orchestrator._git_sync_status()

        self.assertEqual(sync["pending_changes_count"], 0)
        self.assertEqual(sync["unpushed_commits_count"], 2)
        self.assertEqual(sync["blocker"], "unpushed_commits_pending")
        self.assertEqual(sync["mode"], "local_git")
        self.assertTrue(sync["local_git_pushable"])

    def test_sync_changes_dry_run_does_not_call_commit_push_or_api(self) -> None:
        fake_status = {
            "branch": "codex/test",
            "upstream": "origin/codex/test",
            "head_sha": "abc1234",
            "mode": "local_git",
            "local_git_writable": True,
            "local_git_pushable": True,
            "blocker": None,
            "pending_changes_count": 3,
            "pending_changes_preview": ["README.md", "agents/README.md", "agents/orchestrator_codex.py"],
            "unpushed_commits_count": 0,
            "can_sync_without_git_index": True,
            "manual_instructions": [],
        }
        run_git = Mock()
        github_commit = Mock()
        github_pr = Mock()
        with patch.object(orchestrator, "_git_sync_status", return_value=fake_status), patch.object(
            orchestrator, "_run_git_command", run_git
        ), patch.object(
            orchestrator, "_sync_with_github_direct_commit", github_commit
        ), patch.object(
            orchestrator, "_sync_with_github_pr", github_pr
        ):
            result = orchestrator.sync_changes("Test sync", dry_run=True)

        self.assertEqual(result["outcome"], "dry_run")
        self.assertEqual(result["performed_via"], "local_git")
        run_git.assert_not_called()
        github_commit.assert_not_called()
        github_pr.assert_not_called()

    def test_sync_changes_dry_run_shows_push_for_unpushed_commits(self) -> None:
        fake_status = {
            "branch": "codex/test",
            "upstream": "origin/codex/test",
            "head_sha": "abc1234",
            "mode": "local_git",
            "local_git_writable": True,
            "local_git_pushable": True,
            "blocker": "unpushed_commits_pending",
            "pending_changes_count": 0,
            "pending_changes_preview": [],
            "unpushed_commits_count": 2,
            "can_sync_without_git_index": True,
            "manual_instructions": [],
        }
        run_git = Mock()
        with patch.object(orchestrator, "_git_sync_status", return_value=fake_status), patch.object(
            orchestrator, "_run_git_command", run_git
        ):
            result = orchestrator.sync_changes("Publish ahead commits", dry_run=True)

        self.assertEqual(result["outcome"], "dry_run")
        self.assertEqual(result["performed_via"], "local_git")
        self.assertEqual(result["planned_commands"], ["git push"])
        run_git.assert_not_called()

    def test_sync_changes_blocks_when_push_lacks_https_credentials_after_commit(self) -> None:
        fake_status = {
            "branch": "codex/test",
            "upstream": "origin/codex/test",
            "head_sha": "abc1234",
            "mode": "local_git",
            "local_git_writable": True,
            "local_git_pushable": True,
            "blocker": None,
            "pending_changes_count": 2,
            "pending_changes_preview": ["agents/orchestrator_codex.py", "tests/test_orchestrator_codex.py"],
            "unpushed_commits_count": 0,
            "can_sync_without_git_index": False,
            "manual_instructions": [],
        }
        run_git = Mock(
            side_effect=[
                make_git_result("add", "-A", stdout=""),
                make_git_result("commit", "-m", "Publish", stdout="[codex/test def5678] Publish\n"),
                make_git_result("rev-parse", "--short", "HEAD", stdout="def5678\n"),
                make_git_result(
                    "push",
                    stderr="fatal: unable to access 'https://github.com/example/repo.git/': schannel: AcquireCredentialsHandle failed: SEC_E_NO_CREDENTIALS (0x8009030E)",
                    returncode=1,
                ),
            ]
        )
        with patch.object(orchestrator, "_git_sync_status", return_value=fake_status), patch.object(
            orchestrator, "_run_git_command", run_git
        ):
            result = orchestrator.sync_changes("Publish", dry_run=False)

        self.assertEqual(result["outcome"], "blocked")
        self.assertEqual(result["mode"], "github_api_required")
        self.assertEqual(result["blocker"], "local_git_https_credentials_missing")
        self.assertEqual(result["performed_via"], "local_git")
        self.assertTrue(result["commit_created"])
        self.assertEqual(result["head_sha"], "def5678")

    def test_github_api_dry_run_does_not_perform_api_mutations(self) -> None:
        sync_status = {
            "branch": "codex/test",
            "origin": {
                "present": True,
                "url": "https://github.com/example/repo.git",
                "github_like": True,
                "repo_slug": "example/repo",
            },
            "manual_instructions": [],
        }
        github_context = {
            "token_env_name": "GITHUB_TOKEN",
            "token": "token",
            "owner": "example",
            "repo": "repo",
            "branch": "codex/test",
            "base_branch": "main",
            "can_sync_without_git_index": True,
            "missing_env_names": [],
        }
        read_pending = Mock(return_value=([{"path": "README.md", "change": "update"}], []))
        get_head_sha = Mock()
        get_tree_sha = Mock()
        create_tree = Mock()
        create_commit = Mock()
        update_ref = Mock()
        with patch.object(orchestrator, "_resolve_github_sync_context", return_value=github_context), patch.object(
            orchestrator, "_read_pending_changes", read_pending
        ), patch.object(
            orchestrator, "_github_get_head_sha", get_head_sha
        ), patch.object(
            orchestrator, "_github_get_tree_sha", get_tree_sha
        ), patch.object(
            orchestrator, "_github_create_tree", create_tree
        ), patch.object(
            orchestrator, "_github_create_commit", create_commit
        ), patch.object(
            orchestrator, "_github_update_ref", update_ref
        ):
            result = orchestrator._sync_with_github_direct_commit(sync_status, message="API dry run", dry_run=True)

        self.assertIsNone(result["blocker"])
        self.assertEqual(result["planned_change_count"], 1)
        read_pending.assert_called_once()
        get_head_sha.assert_not_called()
        get_tree_sha.assert_not_called()
        create_tree.assert_not_called()
        create_commit.assert_not_called()
        update_ref.assert_not_called()

    def test_github_api_pr_dry_run_does_not_perform_api_mutations(self) -> None:
        sync_status = {
            "branch": "codex/test",
            "origin": {
                "present": True,
                "url": "https://github.com/example/repo.git",
                "github_like": True,
                "repo_slug": "example/repo",
            },
            "manual_instructions": [],
        }
        github_context = {
            "token_env_name": "GITHUB_TOKEN",
            "token": "token",
            "owner": "example",
            "repo": "repo",
            "branch": "codex/test",
            "base_branch": "main",
            "can_sync_without_git_index": True,
            "missing_env_names": [],
        }
        read_pending = Mock(return_value=([{"path": "README.md", "change": "update"}], []))
        get_repo_metadata = Mock()
        get_head_sha = Mock()
        create_ref = Mock()
        get_tree_sha = Mock()
        create_tree = Mock()
        create_commit = Mock()
        update_ref = Mock()
        create_pr = Mock()
        with patch.object(orchestrator, "_resolve_github_sync_context", return_value=github_context), patch.object(
            orchestrator, "_read_pending_changes", read_pending
        ), patch.object(
            orchestrator, "_github_get_repo_metadata", get_repo_metadata
        ), patch.object(
            orchestrator, "_github_get_head_sha", get_head_sha
        ), patch.object(
            orchestrator, "_github_create_ref", create_ref
        ), patch.object(
            orchestrator, "_github_get_tree_sha", get_tree_sha
        ), patch.object(
            orchestrator, "_github_create_tree", create_tree
        ), patch.object(
            orchestrator, "_github_create_commit", create_commit
        ), patch.object(
            orchestrator, "_github_update_ref", update_ref
        ), patch.object(
            orchestrator, "_github_create_pull_request", create_pr
        ):
            result = orchestrator._sync_with_github_pr(sync_status, message="API PR dry run", dry_run=True)

        self.assertIsNone(result["blocker"])
        self.assertEqual(result["planned_change_count"], 1)
        self.assertTrue(result["planned_pr_branch"].startswith("codex/test-codex-sync-"))
        read_pending.assert_called_once()
        get_repo_metadata.assert_not_called()
        get_head_sha.assert_not_called()
        create_ref.assert_not_called()
        get_tree_sha.assert_not_called()
        create_tree.assert_not_called()
        create_commit.assert_not_called()
        update_ref.assert_not_called()
        create_pr.assert_not_called()

    def test_sync_changes_falls_back_to_pr_when_direct_commit_fails(self) -> None:
        fake_status = {
            "branch": "codex/test",
            "upstream": "origin/codex/test",
            "head_sha": "abc1234",
            "mode": "github_api_required",
            "local_git_writable": False,
            "blocker": "local_git_index_lock_permission_denied",
            "pending_changes_count": 2,
            "pending_changes_preview": ["agents/orchestrator_codex.py", "tests/test_orchestrator_codex.py"],
            "can_sync_without_git_index": True,
            "manual_instructions": [],
        }
        direct_commit = Mock(return_value={"mode": "github_api", "blocker": "github_api_direct_commit_failed"})
        pr_sync = Mock(
            return_value={
                "mode": "github_api",
                "blocker": None,
                "performed_via": "github_api_pr",
                "pr_url": "https://github.com/example/repo/pull/1",
            }
        )
        with patch.object(orchestrator, "_git_sync_status", return_value=fake_status), patch.object(
            orchestrator, "_sync_with_github_direct_commit", direct_commit
        ), patch.object(
            orchestrator, "_sync_with_github_pr", pr_sync
        ):
            result = orchestrator.sync_changes("Fallback to PR", dry_run=False)

        self.assertEqual(result["outcome"], "synced")
        self.assertEqual(result["performed_via"], "github_api_pr")
        self.assertEqual(result["pr_url"], "https://github.com/example/repo/pull/1")
        direct_commit.assert_called_once()
        pr_sync.assert_called_once()

    def test_cmd_sync_raises_on_blocked_result(self) -> None:
        blocked_result = {
            "branch": "codex/test",
            "upstream": "origin/codex/test",
            "head_sha": "abc1234",
            "mode": "github_api_required",
            "local_git_writable": False,
            "blocker": "manual_sync_required",
            "pending_changes_count": 2,
            "pending_changes_preview": ["agents/orchestrator_codex.py", "tests/test_orchestrator_codex.py"],
            "can_sync_without_git_index": False,
            "dry_run": False,
            "performed_via": None,
            "manual_instructions": ["Create the commit manually."],
            "outcome": "blocked",
        }
        with patch.object(orchestrator, "sync_changes", return_value=blocked_result), patch(
            "sys.stdout",
            new_callable=StringIO,
        ) as stdout:
            with self.assertRaises(orchestrator.HarnessError):
                orchestrator.cmd_sync("Blocked sync", dry_run=False)

        payload = json.loads(stdout.getvalue())
        self.assertEqual(payload["blocker"], "manual_sync_required")
        self.assertEqual(payload["outcome"], "blocked")

    def test_cmd_sync_dry_run_does_not_raise_on_blocked_result(self) -> None:
        blocked_result = {
            "branch": "codex/test",
            "upstream": "origin/codex/test",
            "head_sha": "abc1234",
            "mode": "github_api_required",
            "local_git_writable": False,
            "blocker": "github_api_credentials_missing",
            "pending_changes_count": 2,
            "pending_changes_preview": ["agents/orchestrator_codex.py", "tests/test_orchestrator_codex.py"],
            "can_sync_without_git_index": False,
            "dry_run": True,
            "performed_via": "github_api_direct_commit",
            "manual_instructions": ["Set GITHUB_TOKEN or GH_TOKEN."],
            "outcome": "blocked",
        }
        with patch.object(orchestrator, "sync_changes", return_value=blocked_result), patch(
            "sys.stdout",
            new_callable=StringIO,
        ) as stdout:
            orchestrator.cmd_sync("Blocked sync dry run", dry_run=True)

        payload = json.loads(stdout.getvalue())
        self.assertEqual(payload["blocker"], "github_api_credentials_missing")
        self.assertEqual(payload["outcome"], "blocked")


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
                auto_sync=False,
            )

        self.assertEqual(exit_code, 0)
        self.assertEqual(call_counts, {"planner": 1, "generator": 1, "evaluator": 1})
        stop_dev_server.assert_called_once()

    def test_autodev_auto_syncs_after_pass_when_worktree_starts_clean(self) -> None:
        def fake_run_codex(prompt: str, **_: object) -> CodexRunResult:
            if "planner skill" in prompt:
                self.write_json(orchestrator.spec_path(), self.valid_spec())
            elif "generator skill" in prompt:
                orchestrator.BUILD_DIR.mkdir(parents=True, exist_ok=True)
                (orchestrator.BUILD_DIR / "package.json").write_text('{"name":"trip-app"}', encoding="utf-8")
                self.write_json(orchestrator.sprint_eval_path(1), self.valid_sprint_eval())
            elif "evaluator skill" in prompt:
                self.write_json(orchestrator.evaluation_report_path(1), self.valid_report(status="PASS"))
            return make_codex_result()

        sync_changes = Mock(return_value={"outcome": "synced", "performed_via": "github_api"})
        with patch.object(orchestrator, "run_codex", side_effect=fake_run_codex), patch.object(
            orchestrator, "install_build_dependencies", return_value=True
        ), patch.object(
            orchestrator, "start_dev_server", return_value=None
        ), patch.object(
            orchestrator, "wait_for_url", return_value=True
        ), patch.object(
            orchestrator, "stop_dev_server", Mock()
        ), patch.object(
            orchestrator, "_read_pending_changes", return_value=([], [])
        ), patch.object(
            orchestrator, "sync_changes", sync_changes
        ):
            exit_code = orchestrator.cmd_autodev(
                description="Build a web app that organizes travel options from user inputs.",
                sprint=1,
                max_iterations=3,
                url="http://localhost:3000",
                startup_timeout=1,
                replan=False,
                auto_sync=True,
            )

        self.assertEqual(exit_code, 0)
        sync_changes.assert_called_once_with("autodev: sprint 1 attempt 1 PASS", dry_run=False)

    def test_autodev_skips_auto_sync_when_worktree_started_dirty(self) -> None:
        def fake_run_codex(prompt: str, **_: object) -> CodexRunResult:
            if "planner skill" in prompt:
                self.write_json(orchestrator.spec_path(), self.valid_spec())
            elif "generator skill" in prompt:
                orchestrator.BUILD_DIR.mkdir(parents=True, exist_ok=True)
                (orchestrator.BUILD_DIR / "package.json").write_text('{"name":"trip-app"}', encoding="utf-8")
                self.write_json(orchestrator.sprint_eval_path(1), self.valid_sprint_eval())
            elif "evaluator skill" in prompt:
                self.write_json(orchestrator.evaluation_report_path(1), self.valid_report(status="PASS"))
            return make_codex_result()

        sync_changes = Mock()
        with patch.object(orchestrator, "run_codex", side_effect=fake_run_codex), patch.object(
            orchestrator, "install_build_dependencies", return_value=True
        ), patch.object(
            orchestrator, "start_dev_server", return_value=None
        ), patch.object(
            orchestrator, "wait_for_url", return_value=True
        ), patch.object(
            orchestrator, "stop_dev_server", Mock()
        ), patch.object(
            orchestrator, "_read_pending_changes", return_value=([{"path": "README.md", "change": "update"}], [])
        ), patch.object(
            orchestrator, "sync_changes", sync_changes
        ):
            exit_code = orchestrator.cmd_autodev(
                description="Build a web app that organizes travel options from user inputs.",
                sprint=1,
                max_iterations=3,
                url="http://localhost:3000",
                startup_timeout=1,
                replan=False,
                auto_sync=True,
            )

        self.assertEqual(exit_code, 0)
        sync_changes.assert_not_called()

    def test_autodev_reports_push_only_follow_up_when_auto_sync_commit_cannot_push(self) -> None:
        def fake_run_codex(prompt: str, **_: object) -> CodexRunResult:
            if "planner skill" in prompt:
                self.write_json(orchestrator.spec_path(), self.valid_spec())
            elif "generator skill" in prompt:
                orchestrator.BUILD_DIR.mkdir(parents=True, exist_ok=True)
                (orchestrator.BUILD_DIR / "package.json").write_text('{"name":"trip-app"}', encoding="utf-8")
                self.write_json(orchestrator.sprint_eval_path(1), self.valid_sprint_eval())
            elif "evaluator skill" in prompt:
                self.write_json(orchestrator.evaluation_report_path(1), self.valid_report(status="PASS"))
            return make_codex_result()

        sync_changes = Mock(
            return_value={
                "outcome": "blocked",
                "performed_via": "local_git",
                "blocker": "local_git_https_credentials_missing",
                "commit_created": True,
                "head_sha": "def5678",
            }
        )
        with patch.object(orchestrator, "run_codex", side_effect=fake_run_codex), patch.object(
            orchestrator, "install_build_dependencies", return_value=True
        ), patch.object(
            orchestrator, "start_dev_server", return_value=None
        ), patch.object(
            orchestrator, "wait_for_url", return_value=True
        ), patch.object(
            orchestrator, "stop_dev_server", Mock()
        ), patch.object(
            orchestrator, "_read_pending_changes", return_value=([], [])
        ), patch.object(
            orchestrator, "sync_changes", sync_changes
        ), patch("sys.stderr", new_callable=StringIO) as stderr:
            exit_code = orchestrator.cmd_autodev(
                description="Build a web app that organizes travel options from user inputs.",
                sprint=1,
                max_iterations=3,
                url="http://localhost:3000",
                startup_timeout=1,
                replan=False,
                auto_sync=True,
            )

        self.assertEqual(exit_code, 0)
        self.assertIn("created local commit def5678 but could not push it", stderr.getvalue())

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
                auto_sync=False,
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
                auto_sync=False,
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
                    auto_sync=False,
                )


if __name__ == "__main__":
    unittest.main()
