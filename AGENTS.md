# Travel App — Codex Project Guide

## Overview
This repository contains two things:
- `build/`: a generated Next.js travel-planning web app
- `agents/`: a Python pipeline that plans, generates, and evaluates the app

The intended flow is:
1. planner -> writes `specs/spec.json`
2. generator -> writes app code into `build/` and self-evaluation into `sprints/`
3. evaluator -> tests the sprint and writes a report into `evaluations/`

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

## Evaluator rules
- Read `specs/spec.json` and `sprints/sprint_N_eval.json` before testing.
- Prefer Playwright MCP if it is configured in Codex.
- If Playwright MCP is not available, fall back to the smallest honest local validation path and note the limitation in the report.
- Follow acceptance criteria and demo steps as closely as possible.
- Write `evaluations/sprint_N_report.json`.

## Local commands
From repo root:
- `python agents/orchestrator.py plan "Create a travel planning app"`
- `python agents/orchestrator.py generate 1`
- `python agents/orchestrator.py evaluate 1 http://localhost:3000`
- `python agents/orchestrator.py status`

From `build/`:
- `npm install`
- `npm run dev`
