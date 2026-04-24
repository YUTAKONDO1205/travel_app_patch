# Travel App — Codex Project Guide

## Overview
This repository contains two things:
- `build/`: a generated Next.js travel-planning web app
- `agents/`: a Python pipeline that plans, generates, and evaluates the app

The intended flow is:
1. planner -> writes `specs/spec.json`
2. generator -> writes app code into `build/` and self-evaluation into `sprints/`
3. evaluator -> tests the sprint and writes a report into `evaluations/`

These are distinct harness roles:
- planner defines what to build
- generator decides how to implement the sprint
- evaluator decides whether the sprint passes

## Source of truth
- Product scope: `specs/spec.json`
- Generated app: `build/`
- Generator self-evals: `sprints/`
- Evaluator reports: `evaluations/`

## Repository layout
- `agents/orchestrator.py` : original CLI entrypoint
- `agents/orchestrator_codex.py` : Codex-based CLI entrypoint
- `agents/codex_runner.py` : helper that calls `codex exec`
- `agents/planner.py` : original planner implementation
- `agents/generator.py` : original generator implementation
- `agents/evaluator.py` : original evaluator implementation
- `build/app/page.tsx` : main app screen

## Working rules
- Read existing files before editing code.
- Keep changes minimal and consistent with the current repository structure.
- Respect the current directory contracts.
- Do not rename core output directories.
- Do not invent extra architecture unless the task requires it.
- When implementing, prefer extending over rewriting.
- Before finishing, run the smallest relevant validation command.
- If a command fails, report the failure honestly.

## Output contracts
- planner writes or overwrites `specs/spec.json`
- generator updates `build/` and writes `sprints/sprint_N_eval.json`
- evaluator writes `evaluations/sprint_N_report.json`
- generator self-evals should copy the evaluator bug ids they are responding to into `source_bug_ids` and classify them with `addressed_bug_ids` and `unresolved_bug_ids`
- evaluator FAIL reports should use structured `bugs` entries with stable `bug_id` values

## Planner rules
- Define WHAT to build, not low-level implementation details.
- Produce a browser-demoable plan.
- Acceptance criteria must be concrete enough for testing.
- Save the spec to `specs/spec.json`.

## Generator rules
- Read `specs/spec.json` before writing code.
- Write production-quality code only.
- No TODOs, placeholder text, or stub functions unless explicitly requested.
- Sprint 1 should create the project skeleton if missing.
- Sprint N > 1 should extend the app without breaking existing behavior.
- Keep the app runnable locally from `build/`.
- Update `build/README.md` when setup or run steps change.
- Write `sprints/sprint_N_eval.json` after implementation.
- When retrying after evaluator feedback, copy every referenced bug id into `source_bug_ids` and classify each one as addressed or unresolved in the self-eval.

## Evaluator rules
- Read `specs/spec.json` and `sprints/sprint_N_eval.json` before testing.
- Prefer Playwright MCP if it is configured in Codex.
- If Playwright MCP is not available, fall back to the smallest honest local validation path and note the limitation in the report.
- Follow acceptance criteria and demo steps as closely as possible.
- Write `evaluations/sprint_N_report.json`.
- When reporting concrete bugs, use structured entries with stable `bug_id` values for that sprint.

## Local commands
From repo root:
- `python agents/orchestrator.py plan "Create a travel planning app"`
- `python agents/orchestrator.py generate 1`
- `python agents/orchestrator.py evaluate 1 http://localhost:3000`
- `python agents/orchestrator.py status`
- `python agents/orchestrator_codex.py status`
- `python agents/orchestrator_codex.py autodev "Create a travel planning app" --sprint 1 --max-iterations 3`
- `python agents/orchestrator_codex.py autodev "Create a travel planning app" --sprint 1 --max-iterations 3 --replan`

From `build/`:
- `npm install`
- `npm run dev`
