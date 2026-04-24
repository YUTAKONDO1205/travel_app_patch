# Codex Harness Roles

This repository uses a three-role local Codex harness:

1. `Planner`
   Expands a short product request into `specs/spec.json`.
   Focuses on what to build, acceptance criteria, and demoable scope.
   Avoids locking in low-level implementation details unless the user explicitly requires them.
   The spec is expected to include a feature list, top-level acceptance criteria, and a sprint roadmap.

2. `Generator`
   Implements one sprint at a time from `specs/spec.json`.
   Updates the runnable app in `build/`.
   Writes an honest self-evaluation to `sprints/sprint_N_eval.json` after each sprint.
   Copies the evaluator bug ids it is responding to into `source_bug_ids`, then tracks them with `addressed_bug_ids` and `unresolved_bug_ids`.

3. `Evaluator`
   Verifies the sprint against the spec and the generator handoff.
   Prefers Playwright MCP when available and falls back honestly when it is not.
   Writes a strict `PASS` or `FAIL` report to `evaluations/sprint_N_report.json`.
   Each report should cover every sprint acceptance criterion exactly once with explicit PASS/FAIL evidence.
   When a sprint fails, writes structured `bugs` entries with stable `bug_id` values.

## Local Loop

`python agents/orchestrator_codex.py autodev "<description>" --sprint 1 --max-iterations 3`

The current `autodev` loop is:

1. Planner writes `specs/spec.json` only when no spec exists yet, or when `--replan` is passed
2. Generator updates `build/` and `sprints/`
3. Harness runs `npm install` in `build/` when `package.json` exists
4. Harness starts `npm run dev`
5. Evaluator writes `evaluations/`
6. On `FAIL`, the latest evaluation report is fed back into the next generator run without re-planning
7. Generator copies the latest evaluator bug ids into `source_bug_ids`, then classifies them as addressed or unresolved in its next self-eval

## Status Command

`python agents/orchestrator_codex.py status`

The status output is agent-centric and reports:

- pipeline readiness
- read/write contracts for planner, generator, and evaluator
- whether the latest spec, sprint self-eval, and evaluation report are still structurally valid
- summary metadata such as latest sprint number, check counts, and evaluation status
- bug linkage between the generator source bug set and the current evaluator report
- local git sync readiness and push blockers
- planner/generator/evaluator role summaries
- whether each skill contract artifact exists
- the latest sprint self-evaluation and evaluation report
- the latest evaluation status
